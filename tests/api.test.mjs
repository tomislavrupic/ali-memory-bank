import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHandler } from "../server/worker.mjs";

test("archive API searches, counts, paginates and reconstructs without unrelated results", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(
    "session-1",
    "QATC beginnings",
    1700000000,
    null,
    '["QATC","ALi"]',
    2,
    1,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(
    "session-2",
    "Other conversation",
    1710000000,
    null,
    "[]",
    1,
    0,
  );
  db.prepare(
    "INSERT INTO messages(id,session_id,ord,role,content) VALUES(?,?,?,?,?)",
  ).run(
    "m1",
    "session-1",
    0,
    "user",
    "QATC and ALi: preserve the original thought.",
  );
  db.prepare(
    "INSERT INTO messages(id,session_id,ord,role,content,parent_id) VALUES(?,?,?,?,?,?)",
  ).run("m2", "session-1", 1, "assistant", "Find the source context.", "m1");
  db.prepare(
    "INSERT INTO messages(id,session_id,ord,role,content) VALUES(?,?,?,?,?)",
  ).run("m3", "session-2", 0, "user", "A different discussion.");
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  const DB = {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...values) {
          params = values;
          return stmt;
        },
        async first(column) {
          const row = db.prepare(sql).get(...params);
          return column ? row?.[column] : row;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
      };
      return stmt;
    },
  };
  const handler = createHandler(async () => ({ email: "test@example.com" }));
  const read = async (path) => {
    const r = await handler(new Request("https://api.example.com" + path), {
      APP_URL: "https://example.github.io/ali-memory-bank/",
      DB,
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  assert.equal((await read("/api/stats")).messages, 3);
  assert.equal((await read("/api/search?q=QATC%20ALi&core=1")).total, 1);
  assert.equal((await read("/api/search?q=nonexistent")).total, 0);
  assert.equal((await read("/api/search?core=1")).total, 1);
  assert.equal(
    (await read("/api/search?limit=1&offset=1")).results[0].id,
    "session-1",
  );
  assert.equal(
    (await read("/api/search?q=QATC&sort=oldest")).results[0].messageOrder,
    0,
  );
  assert.equal(
    (await read("/api/sessions/session-1?start=1")).messages[0].parent_id,
    "m1",
  );
  assert.equal((await read("/api/topics")).topics.length, 2);
  db.close();
});
