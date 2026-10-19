import { createRemoteJWKSet, jwtVerify } from "jose";
import { boundedInteger, searchExpression } from "./search.mjs";

const keySets = new Map();
export async function verifyIdentity(request, env, resolver) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL)
    throw new Error("Access is not configured");
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /i, "") ||
    request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Sign in required");
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keySets.has(issuer))
    keySets.set(
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    );
  const { payload } = await jwtVerify(token, resolver || keySets.get(issuer), {
    issuer,
    audience: env.ACCESS_AUD,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "email", "sub"],
  });
  if (
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()
  )
    throw new Error("Account not allowed");
  return { email: payload.email, token, expiresAt: payload.exp };
}

const headers = (origin, allowed) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Origin",
  ...(origin === allowed
    ? {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      }
    : {}),
});
const json = (value, status, cors) =>
  new Response(JSON.stringify(value), { status, headers: cors });

function loginBridge(identity, env, state) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const target = new URL(env.APP_URL).origin;
  const data = JSON.stringify({
    type: "ali-memory-login",
    token: identity.token,
    state,
  }).replaceAll("<", "\\u003c");
  const home = JSON.stringify(env.APP_URL);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ALi / Signed in</title><style>body{background:#111917;color:#e6eee8;font:18px Georgia;padding:10vh 12vw}p{color:#a9b7ae}a{color:#c4e1cf}</style><h1>You are signed in.</h1><p>Returning to your memory bank...</p><script nonce="${nonce}">const data=${data};const home=${home};if(window.opener){window.opener.postMessage(data,${JSON.stringify(target)});setTimeout(()=>window.close(),300);}else{location.replace(home+'#token='+encodeURIComponent(data.token)+'&state='+encodeURIComponent(data.state));}</script></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createHandler(identityVerifier = verifyIdentity) {
  return async function fetchHandler(request, env) {
    const url = new URL(request.url);
    const allowed = new URL(env.APP_URL).origin;
    const origin = request.headers.get("origin");
    const cors = headers(origin, allowed);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: origin === allowed ? 204 : 403,
        headers: cors,
      });
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405, cors);
    if (url.pathname === "/health")
      return json({ ok: true, service: "ali-memory-bank" }, 200, cors);
    if (origin && origin !== allowed)
      return json({ error: "Origin not allowed" }, 403, cors);
    let identity;
    try {
      identity = await identityVerifier(request, env);
    } catch {
      return json(
        { error: "Please sign in with your Cloudflare account." },
        401,
        cors,
      );
    }

    if (url.pathname === "/auth/complete") {
      const state = url.searchParams.get("state") || "";
      if (!/^[a-f0-9-]{36}$/.test(state))
        return json({ error: "Invalid login request" }, 400, cors);
      return loginBridge(identity, env, state);
    }
    try {
      if (url.pathname === "/api/me")
        return json(
          { email: identity.email, expiresAt: identity.expiresAt },
          200,
          cors,
        );
      if (url.pathname === "/api/stats") {
        const stats = await env.DB.prepare(
          "SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM messages) AS messages, (SELECT count(*) FROM sessions WHERE core=1) AS coreSessions, min(created_at) AS earliest, max(created_at) AS latest FROM sessions",
        ).first();
        return json(stats, 200, cors);
      }
      if (url.pathname === "/api/topics") {
        const { results } = await env.DB.prepare(
          "SELECT j.value AS topic, count(*) AS count FROM sessions, json_each(sessions.topics) j GROUP BY j.value ORDER BY count DESC, topic LIMIT 32",
        ).all();
        return json({ topics: results }, 200, cors);
      }
      if (url.pathname === "/api/search") {
        const query = (url.searchParams.get("q") || "").slice(0, 300);
        const expression = searchExpression(query);
        const limit = Math.max(
          1,
          boundedInteger(url.searchParams.get("limit"), 30, 100),
        );
        const offset = boundedInteger(
          url.searchParams.get("offset"),
          0,
          100000,
        );
        const chronological = url.searchParams.get("sort") === "oldest";
        const core =
          url.searchParams.get("core") === "1" ? " AND s.core=1" : "";
        let rows, total;
        if (expression) {
          const from = `FROM messages_fts JOIN messages m ON m.rowid=messages_fts.rowid JOIN sessions s ON s.id=m.session_id WHERE messages_fts MATCH ?${core}`;
          total = await env.DB.prepare(`SELECT count(*) AS total ${from}`)
            .bind(expression)
            .first("total");
          const order = chronological
            ? "s.created_at ASC, m.ord ASC"
            : "rank, s.created_at ASC, m.ord ASC";
          rows = await env.DB.prepare(
            `SELECT s.*, m.ord AS messageOrder, m.role, snippet(messages_fts,0,'','',' ... ',45) AS excerpt ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
          )
            .bind(expression, limit, offset)
            .all();
        } else if (query.trim()) {
          return json({ results: [], total: 0, offset, query }, 200, cors);
        } else {
          total = await env.DB.prepare(
            `SELECT count(*) FROM sessions s WHERE 1=1${core}`,
          ).first("count(*)");
          rows = await env.DB.prepare(
            `SELECT s.*, 0 AS messageOrder, 'session' AS role, (SELECT substr(content,1,320) FROM messages WHERE session_id=s.id AND role='user' ORDER BY ord LIMIT 1) AS excerpt FROM sessions s WHERE 1=1${core} ORDER BY s.created_at ${chronological ? "ASC" : "DESC"}, s.id LIMIT ? OFFSET ?`,
          )
            .bind(limit, offset)
            .all();
        }
        return json(
          {
            results: rows.results.map((row) => ({
              ...row,
              topics: JSON.parse(row.topics),
            })),
            total,
            offset,
            query,
          },
          200,
          cors,
        );
      }
      const match = /^\/api\/sessions\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (match) {
        const session = await env.DB.prepare(
          "SELECT * FROM sessions WHERE id=?",
        )
          .bind(match[1])
          .first();
        if (!session) return json({ error: "Session not found" }, 404, cors);
        const start = boundedInteger(url.searchParams.get("start"), 0, 1000000);
        const limit = Math.max(
          1,
          boundedInteger(url.searchParams.get("limit"), 60, 5000),
        );
        const { results } = await env.DB.prepare(
          "SELECT id,ord,role,timestamp,content,parent_id FROM messages WHERE session_id=? AND ord>=? ORDER BY ord LIMIT ?",
        )
          .bind(match[1], start, limit)
          .all();
        return json(
          {
            session: { ...session, topics: JSON.parse(session.topics) },
            messages: results,
            start,
          },
          200,
          cors,
        );
      }
      return json({ error: "Not found" }, 404, cors);
    } catch {
      return json(
        { error: "The archive could not be read. Please try again." },
        500,
        cors,
      );
    }
  };
}
export default { fetch: createHandler() };
