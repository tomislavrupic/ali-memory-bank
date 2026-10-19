import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { messageStatements } from "../scripts/sql.mjs";
test("large original messages import without truncation and remain unchanged on retry", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  const content = "QATC 'quotes' 🌍 sjećanje\0".repeat(12000);
  const sql = messageStatements("session-1", {
    id: "m1",
    order: 0,
    role: "user",
    timestamp: null,
    content,
  });
  assert.ok(sql.split("\n").every((line) => Buffer.byteLength(line) < 100000));
  const stored = () =>
    Buffer.from(
      db.prepare("SELECT CAST(content AS BLOB) AS bytes FROM messages").get()
        .bytes,
    ).toString("utf8");
  db.exec(sql);
  assert.equal(stored(), content);
  db.exec(sql);
  assert.equal(stored(), content);
  assert.equal(db.prepare("SELECT count(*) AS n FROM messages").get().n, 1);
  db.close();
});
