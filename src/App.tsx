import {
  useEffect,
  useRef,
  useState,
  useDeferredValue,
  type FormEvent,
} from "react";
import {
  API,
  get,
  download,
  type Hit,
  type Identity,
  type SearchResult,
  type Slice,
  type Stats,
  type Topic,
} from "./api";

const format = (n: number) => n.toLocaleString();
function date(value: number | string | null, long = false) {
  if (!value) return "Undated";
  const d = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(d.getTime())
    ? "Undated"
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: long ? "long" : "short",
        year: "numeric",
      });
}
const topicSeeds = [
  "QATC",
  "ALi",
  "HAT",
  "HAOS",
  "Source Cube",
  "Abzu",
  "ULUF",
];

export default function App() {
  const [token, setToken] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [mode, setMode] = useState<"search" | "timeline" | "topics">("search");
  const [core, setCore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [slice, setSlice] = useState<Slice | null>(null);
  const [selected, setSelected] = useState<Hit | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const popup = useRef<Window | null>(null);
  const loginState = useRef("");
  const readRequest = useRef(0);
  const authRequest = useRef(0);
  const [inMessage, setInMessage] = useState("");

  async function acceptLogin(value: string) {
    const current = ++authRequest.current;
    try {
      const who = await get<Identity>("/api/me", value);
      if (current !== authRequest.current) return;
      setToken(value);
      setIdentity(who);
      setError("");
    } catch (e) {
      if (current === authRequest.current)
        setError(String((e as Error).message));
    } finally {
      if (current === authRequest.current) setSigningIn(false);
    }
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== API ||
        event.source !== popup.current ||
        event.data?.type !== "ali-memory-login" ||
        event.data?.state !== loginState.current ||
        typeof event.data.token !== "string"
      )
        return;
      sessionStorage.removeItem("ali-login-state");
      loginState.current = "";
      void acceptLogin(event.data.token);
    }
    window.addEventListener("message", receive);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const returned = fragment.get("token");
    if (returned) {
      history.replaceState(null, "", location.pathname + location.search);
      const expected = sessionStorage.getItem("ali-login-state");
      sessionStorage.removeItem("ali-login-state");
      if (expected && fragment.get("state") === expected)
        void acceptLogin(returned);
      else
        setError(
          "The sign-in request did not match this browser. Please try again.",
        );
    }
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    Promise.all([
      get<Stats>("/api/stats", token, abort.signal),
      get<{ topics: Topic[] }>("/api/topics", token, abort.signal),
    ])
      .then(([s, t]) => {
        setStats(s);
        setTopics(t.topics);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [token]);

  useEffect(() => {
    if (!token || mode === "topics") return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: deferredQuery,
        sort: mode === "timeline" ? "oldest" : "relevance",
        core: core ? "1" : "0",
        offset: String(offset),
      });
      get<SearchResult>("/api/search?" + params, token, abort.signal)
        .then(setResults)
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [token, deferredQuery, mode, core, offset]);

  useEffect(() => {
    if (!identity) return;
    const wait = Math.max(0, identity.expiresAt * 1000 - Date.now());
    const timer = setTimeout(() => {
      signOut();
      setError("Your session expired. Please sign in again.");
    }, wait);
    return () => clearTimeout(timer);
  }, [identity]);

  function signIn(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setSigningIn(true);
    const state = crypto.randomUUID();
    loginState.current = state;
    sessionStorage.setItem("ali-login-state", state);
    const url = API + "/auth/complete?state=" + encodeURIComponent(state);
    popup.current = window.open(
      url,
      "ali-memory-login",
      "popup,width=560,height=740",
    );
    if (!popup.current) location.assign(url);
  }
  function signOut() {
    ++authRequest.current;
    ++readRequest.current;
    popup.current?.close();
    popup.current = null;
    loginState.current = "";
    sessionStorage.removeItem("ali-login-state");
    setToken("");
    setIdentity(null);
    setResults(null);
    setSlice(null);
    setStats(null);
    setTopics([]);
    setSelected(null);
    setQuery("");
    setError("");
    setSigningIn(false);
  }
  function search(value: string) {
    setQuery(value);
    setOffset(0);
    setSlice(null);
    setSelected(null);
    setError("");
  }
  async function open(hit: Hit, start = Math.max(0, hit.messageOrder - 4)) {
    const current = ++readRequest.current;
    setSelected(hit);
    setSlice(null);
    setReading(true);
    setError("");
    setInMessage("");
    try {
      const loaded = await get<Slice>(
        `/api/sessions/${hit.id}?start=${start}`,
        token,
      );
      if (current === readRequest.current) setSlice(loaded);
    } catch (e) {
      if (current === readRequest.current) setError((e as Error).message);
    } finally {
      if (current === readRequest.current) setReading(false);
    }
  }
  async function exportSession() {
    if (!slice) return;
    try {
      const all = await get<Slice>(
        `/api/sessions/${slice.session.id}?start=0&limit=5000`,
        token,
      );
      if (all.session.message_count > all.messages.length)
        throw new Error(
          "This conversation exceeds the export limit; use the original trace archive.",
        );
      const text = [
        `# ${all.session.title}`,
        `Session: ${all.session.id}`,
        `Created: ${date(all.session.created_at, true)}`,
        ...all.messages.map(
          (m) =>
            `## ${m.role} / ${m.ord}\n\nTrace: chatgpt_export/${all.session.id}#${m.ord}:${m.ord}\nMessage: ${m.id}\nParent: ${m.parent_id || "none"}\nDate: ${m.timestamp || "undated"}\n\n${m.content}`,
        ),
      ].join("\n\n");
      download(`${all.session.id}.md`, text);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!identity)
    return (
      <main className="login-page">
        <header className="login-top">
          <a href={location.pathname} className="brand">
            ALi <span>/</span> MEMORY BANK
          </a>
          <span className="small-label">PRIVATE ARCHIVE</span>
        </header>
        <section className="login-layout">
          <div className="login-story">
            <div className="eyebrow">
              <i /> AN INDEX OF THE EARLY YEARS
            </div>
            <h1>
              Where the
              <br />
              ideas <em>began.</em>
            </h1>
            <p>
              Your early QATC and ALi conversations.
              <br />
              Preserved in their own words, ready to find again.
            </p>
            <div className="archive-lines" aria-hidden="true">
              {["QATC", "ALi", "HAT", "Source Cube", "Abzu Rota"].map(
                (t, i) => (
                  <div key={t}>
                    <span>0{i + 1}</span>
                    <strong>{t}</strong>
                    <b>↗</b>
                  </div>
                ),
              )}
            </div>
            <div className="login-footnote">
              ORIGINAL WORDS <span>·</span> ORIGINAL CONTEXT <span>·</span> YOUR
              MEMORY
            </div>
          </div>
          <div className="login-card">
            <span className="vault-symbol" aria-hidden="true">
              ▤
            </span>
            <div className="eyebrow">WELCOME BACK</div>
            <h2>Open your memory bank.</h2>
            <p>
              Sign in with your Cloudflare account to search and read your
              private archive.
            </p>
            <form onSubmit={signIn}>
              <button className="button primary login-button" type="submit">
                {signingIn
                  ? "Continue sign-in with Cloudflare"
                  : "Sign in with Cloudflare"}{" "}
                <span>↗</span>
              </button>
            </form>
            {signingIn && (
              <p role="status" className="fineprint">
                Complete sign-in in the window that opened. You can click again
                if it was closed.
              </p>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <div className="login-security">
              <i /> Access is restricted to your account.
            </div>
            <div className="card-rule" />
            <p className="fineprint">
              Conversations are held in your private Cloudflare database. This
              website loads them only after you sign in.
            </p>
          </div>
        </section>
        <footer className="login-bottom">
          <span>ALi / EARLY MEMORY</span>
          <span>A place to return to.</span>
        </footer>
      </main>
    );

  const hits = results?.results || [];
  const total = results?.total || 0;
  return (
    <main className="archive-app">
      <header className="app-header">
        <a className="brand" href={location.pathname}>
          ALi <span>/</span> MEMORY BANK
        </a>
        <div className="account">
          <span className="online-dot" />
          <span>{identity.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="eyebrow">YOUR ARCHIVE</div>
          <nav aria-label="Archive views">
            {(["search", "timeline", "topics"] as const).map((item, i) => (
              <button
                key={item}
                className={mode === item ? "active" : ""}
                onClick={() => {
                  setMode(item);
                  setOffset(0);
                  setSlice(null);
                  ++readRequest.current;
                }}
              >
                <span>{["⌕", "↳", "⊞"][i]}</span>
                {item === "search"
                  ? "Search archive"
                  : item === "timeline"
                    ? "Timeline"
                    : "Topics"}
              </button>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <div className="eyebrow">COLLECTION</div>
          <label className="scope">
            <input
              type="checkbox"
              checked={core}
              onChange={(e) => {
                setCore(e.target.checked);
                setOffset(0);
                setSlice(null);
              }}
            />{" "}
            QATC / ALi and related
          </label>
          <p className="fineprint">
            Turn off to browse every archived conversation.
          </p>
          <div className="sidebar-topics">
            {topicSeeds.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setMode("search");
                  search(t);
                }}
              >
                {t}
                <span>↗</span>
              </button>
            ))}
          </div>
          <div className="sidebar-stats">
            <strong>{stats ? format(stats.sessions) : "—"}</strong>
            <span>conversations preserved</span>
            <strong>{stats ? format(stats.messages) : "—"}</strong>
            <span>original messages</span>
            <p>
              {stats
                ? `${date(stats.earliest)} — ${date(stats.latest)}`
                : "Reading archive..."}
            </p>
          </div>
          <div className="sidebar-bottom">
            <i /> Private · Cloudflare Access
          </div>
        </aside>
        <section className="archive-content">
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {mode === "topics" ? (
            <>
              <div className="view-title">
                <div className="eyebrow">FIND A THREAD</div>
                <h1>Topics in the archive.</h1>
                <p>Choose a topic to search the original messages.</p>
              </div>
              <div className="topics-grid">
                {topics.map((t, i) => (
                  <button
                    key={t.topic}
                    onClick={() => {
                      setMode("search");
                      search(t.topic);
                    }}
                  >
                    <span className="topic-no">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h2>{t.topic}</h2>
                    <span>
                      {format(t.count)} conversations <b>↗</b>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="view-title">
                <div className="eyebrow">
                  {mode === "timeline"
                    ? "IN ORDER OF FIRST CONVERSATION"
                    : "FOLLOW A MEMORY"}
                </div>
                <h1>
                  {mode === "timeline"
                    ? "How it unfolded."
                    : "Find the original thought."}
                </h1>
              </div>
              <div className="search-bar">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search original messages"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  placeholder="Search a phrase, idea, or memory..."
                />
                {query && (
                  <button aria-label="Clear search" onClick={() => search("")}>
                    ×
                  </button>
                )}
                <kbd>TEXT SEARCH</kbd>
              </div>
              <div className="results-toolbar">
                <span role="status">
                  {loading
                    ? "Searching original messages..."
                    : `${format(total)} ${query.trim() ? "matching messages" : "conversations"}`}
                </span>
                <span>
                  {core ? "QATC / ALi collection" : "Full archive"} ·{" "}
                  {mode === "timeline"
                    ? "Oldest first"
                    : query
                      ? "Relevance"
                      : "Newest first"}
                </span>
              </div>
              <div className={`reader-layout ${selected ? "with-reader" : ""}`}>
                <section className="results" aria-label="Search results">
                  {!loading && !hits.length && (
                    <div className="empty">
                      <h2>No matching memories.</h2>
                      <p>Try fewer words or turn off the collection filter.</p>
                    </div>
                  )}
                  {hits.map((hit) => (
                    <button
                      className={`hit ${selected?.id === hit.id && selected.messageOrder === hit.messageOrder ? "selected" : ""}`}
                      key={`${hit.id}:${hit.messageOrder}`}
                      onClick={() => void open(hit)}
                    >
                      <div className="hit-meta">
                        <span>{date(hit.created_at)}</span>
                        <span>
                          {hit.role === "session"
                            ? `${format(hit.message_count)} messages`
                            : `${hit.role} · #${hit.messageOrder}`}
                        </span>
                      </div>
                      <h2>{hit.title}</h2>
                      <p>
                        {hit.excerpt ||
                          "Open the conversation to read the original messages."}
                      </p>
                      <div className="hit-topics">
                        {hit.topics.slice(0, 4).map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                        <b>Read source ↗</b>
                      </div>
                    </button>
                  ))}
                  <div className="pagination">
                    <button
                      disabled={loading || offset === 0}
                      onClick={() => {
                        setOffset(Math.max(0, offset - 30));
                        setSlice(null);
                      }}
                    >
                      ← Previous
                    </button>
                    <span>
                      {total
                        ? `${offset + 1}–${Math.min(offset + 30, total)} of ${format(total)}`
                        : "0 results"}
                    </span>
                    <button
                      disabled={loading || offset + 30 >= total}
                      onClick={() => {
                        setOffset(offset + 30);
                        setSlice(null);
                      }}
                    >
                      Next →
                    </button>
                  </div>
                </section>
                {selected && (
                  <aside className="reader" aria-label="Original conversation">
                    <div className="reader-toolbar">
                      <span className="eyebrow">ORIGINAL CONVERSATION</span>
                      <button
                        aria-label="Close conversation"
                        onClick={() => {
                          ++readRequest.current;
                          setSelected(null);
                          setSlice(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <h2>{selected.title}</h2>
                    <div className="reader-subtitle">
                      {date(selected.created_at, true)} ·{" "}
                      {format(selected.message_count)} messages
                    </div>
                    {reading ? (
                      <p role="status">Opening source...</p>
                    ) : (
                      slice && (
                        <>
                          <div className="reader-actions">
                            <button onClick={() => void exportSession()}>
                              Download conversation
                            </button>
                            <button
                              onClick={() =>
                                download(
                                  `${slice.session.id}-context.json`,
                                  JSON.stringify(slice, null, 2),
                                  "application/json",
                                )
                              }
                            >
                              Save this context
                            </button>
                          </div>
                          <input
                            className="within-search"
                            aria-label="Filter visible messages"
                            value={inMessage}
                            onChange={(e) => setInMessage(e.target.value)}
                            placeholder="Filter this visible context..."
                          />
                          <div className="context-nav">
                            <button
                              disabled={slice.start === 0}
                              onClick={() =>
                                void open(
                                  selected,
                                  Math.max(0, slice.start - 60),
                                )
                              }
                            >
                              ← Earlier
                            </button>
                            <span>From message #{slice.start}</span>
                            <button
                              disabled={
                                !slice.messages.length ||
                                slice.messages[slice.messages.length - 1].ord >=
                                  slice.session.message_count - 1
                              }
                              onClick={() =>
                                void open(
                                  selected,
                                  (slice.messages[slice.messages.length - 1]
                                    ?.ord || 0) + 1,
                                )
                              }
                            >
                              Later →
                            </button>
                          </div>
                          {slice.messages
                            .filter(
                              (m) =>
                                !inMessage ||
                                m.content
                                  .toLocaleLowerCase()
                                  .includes(inMessage.toLocaleLowerCase()),
                            )
                            .map((m) => (
                              <article
                                key={m.ord}
                                className={`message ${m.role} ${m.ord === selected.messageOrder ? "anchor" : ""}`}
                              >
                                <header>
                                  <strong>
                                    {m.role === "user"
                                      ? "You"
                                      : m.role === "assistant"
                                        ? "Assistant"
                                        : m.role}
                                  </strong>
                                  <span>
                                    #{m.ord} · {date(m.timestamp)}
                                  </span>
                                </header>
                                <p>{m.content}</p>
                                <details>
                                  <summary>Source reference</summary>
                                  <code>
                                    chatgpt_export/{slice.session.id}#{m.ord}:
                                    {m.ord}
                                  </code>
                                  <code>Message: {m.id}</code>
                                  {m.parent_id && (
                                    <code>Parent: {m.parent_id}</code>
                                  )}
                                </details>
                              </article>
                            ))}
                          <div className="context-nav">
                            <button
                              disabled={slice.start === 0}
                              onClick={() =>
                                void open(
                                  selected,
                                  Math.max(0, slice.start - 60),
                                )
                              }
                            >
                              ← Earlier
                            </button>
                            <button
                              disabled={
                                !slice.messages.length ||
                                slice.messages[slice.messages.length - 1].ord >=
                                  slice.session.message_count - 1
                              }
                              onClick={() =>
                                void open(
                                  selected,
                                  (slice.messages[slice.messages.length - 1]
                                    ?.ord || 0) + 1,
                                )
                              }
                            >
                              Later →
                            </button>
                          </div>
                        </>
                      )
                    )}
                  </aside>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
