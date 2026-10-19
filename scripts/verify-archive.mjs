import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { quote } from "./sql.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  process.argv[2] ||
    path.join(root, "../ali-genesis/memory/traces/chatgpt_export"),
);
const records = [];
let sessions = 0,
  bytes = 0;
for (const file of (await readdir(source))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const s = JSON.parse(await readFile(path.join(source, file), "utf8"));
  sessions++;
  for (const m of s.messages) {
    bytes += Buffer.byteLength(m.content);
    records.push({ session: s.id, ord: m.order, content: m.content });
  }
}
const remote = (sql) =>
  JSON.parse(
    execFileSync(
      path.join(root, "node_modules/.bin/wrangler"),
      [
        "d1",
        "execute",
        "ali-memory-bank",
        "--remote",
        "--command",
        sql,
        "--json",
      ],
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).toString(),
  )[0].results;
const totals = remote(
  "SELECT (SELECT count(*) FROM sessions) sessions, count(*) messages, sum(length(CAST(content AS BLOB))) bytes FROM messages",
)[0];
assert.deepEqual(totals, { sessions, messages: records.length, bytes });
const samples = [
  ...records
    .toSorted(
      (a, b) => Buffer.byteLength(b.content) - Buffer.byteLength(a.content),
    )
    .slice(0, 5),
  ...Array.from(
    { length: 10 },
    (_, i) => records[Math.floor((i * (records.length - 1)) / 9)],
  ),
];
const digest = (text) => createHash("sha256").update(text).digest("hex");
for (const sample of samples) {
  const row = remote(
    `SELECT content FROM messages WHERE session_id=${quote(sample.session)} AND ord=${sample.ord}`,
  )[0];
  assert.equal(
    digest(row.content),
    digest(sample.content),
    "Original content checksum differs",
  );
}
console.log(
  JSON.stringify({
    verified: true,
    ...totals,
    originalMessageChecksums: samples.length,
  }),
);
