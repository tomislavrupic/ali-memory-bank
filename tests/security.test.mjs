import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { createHandler, verifyIdentity } from "../server/worker.mjs";
import { searchExpression } from "../server/search.mjs";
const env = {
  APP_URL: "https://example.github.io/ali-memory-bank/",
  ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  ACCESS_AUD: "memory-bank",
  OWNER_EMAIL: "owner@example.com",
};
const { privateKey, publicKey } = await generateKeyPair("RS256");
const makeToken = async (options = {}) =>
  new SignJWT({ email: options.email || env.OWNER_EMAIL })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("owner")
    .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`)
    .setAudience(options.aud || env.ACCESS_AUD)
    .setExpirationTime(options.exp || "1h")
    .sign(privateKey);

test("private routes reject missing and forged tokens before touching the archive", async () => {
  const handler = createHandler();
  for (const path of [
    "/api/stats",
    "/api/topics",
    "/api/search?q=QATC",
    "/api/sessions/123",
    "/auth/complete?state=123",
  ]) {
    for (const token of ["", "fake.token.signature"]) {
      const response = await handler(
        new Request(`https://api.example.com${path}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
        env,
      );
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
});
test("JWT validation binds signature, account, issuer, audience and expiry", async () => {
  const request = (token) =>
    new Request("https://api.example.com/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.equal(
    (await verifyIdentity(request(await makeToken()), env, publicKey)).email,
    env.OWNER_EMAIL,
  );
  for (const options of [
    { email: "other@example.com" },
    { aud: "another-app" },
    { exp: "1 second ago" },
  ]) {
    await assert.rejects(() =>
      makeToken(options).then((t) =>
        verifyIdentity(request(t), env, publicKey),
      ),
    );
  }
  const { publicKey: wrongKey } = await generateKeyPair("RS256");
  await assert.rejects(() =>
    makeToken().then((t) => verifyIdentity(request(t), env, wrongKey)),
  );
});
test("CORS allows only the configured website and rejects hostile preflights", async () => {
  const handler = createHandler();
  const response = await handler(
    new Request("https://api.example.com/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    }),
    env,
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const allowed = await handler(
    new Request("https://api.example.com/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://example.github.io" },
    }),
    env,
  );
  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://example.github.io",
  );
});
test("login bridge delivers credentials only to the fixed website origin", async () => {
  const handler = createHandler(async () => ({
    email: env.OWNER_EMAIL,
    token: "test-token",
    expiresAt: 123,
  }));
  const response = await handler(
    new Request(
      "https://api.example.com/auth/complete?state=00000000-0000-0000-0000-000000000000&redirect=https://attacker.example",
    ),
    env,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /https:\/\/example.github.io/);
  assert.doesNotMatch(html, /attacker.example/);
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});
test("search never treats punctuation as FTS operators or SQL", () => {
  assert.equal(searchExpression("QATC ALi"), '"QATC" AND "ALi"');
  assert.equal(searchExpression('" OR 1=1; --'), '"OR" AND "1"');
  assert.equal(searchExpression("***"), "");
  assert.equal(searchExpression("sjećanje"), '"sjećanje"');
});
