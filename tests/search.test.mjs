import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { searchExpression } from "../server/search.mjs";
test("full text requires the requested terms and recovers the original source", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(
    "session-1",
    "QATC beginnings",
    1700000000,
    null,
    '["QATC"]',
    2,
    1,
  );
  const insert = db.prepare(
    "INSERT INTO messages(id,session_id,ord,role,content) VALUES(?,?,?,?,?)",
  );
  insert.run(
    "m1",
    "session-1",
    0,
    "user",
    "QATC and ALi: preserve the original thought.",
  );
  insert.run(
    "m2",
    "session-1",
    1,
    "assistant",
    "A related topic about memory.",
  );
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  const search = (q) =>
    db
      .prepare(
        "SELECT m.* FROM messages_fts f JOIN messages m ON f.rowid=m.rowid WHERE messages_fts MATCH ?",
      )
      .all(searchExpression(q));
  assert.equal(search("QATC ALi").length, 1);
  assert.equal(search("nonexistent").length, 0);
  assert.equal(
    search("original thought")[0].content,
    "QATC and ALi: preserve the original thought.",
  );
  assert.equal(search("QATC thought")[0].ord, 0);
  db.close();
});
