import { readFile, readdir, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quote, messageStatements } from "./sql.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  process.argv[2] ||
    path.join(root, "../ali-genesis/memory/traces/chatgpt_export"),
);
const target = path.join(root, ".private/archive.sql");
await mkdir(path.dirname(target), { recursive: true });
const output = await open(target, "w", 0o600);
let sessions = 0,
  messages = 0,
  coreSessions = 0;
try {
  await output.write(
    await readFile(path.join(root, "server/schema.sql"), "utf8"),
  );
  for (const file of (await readdir(source))
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const session = JSON.parse(await readFile(path.join(source, file), "utf8"));
    if (!session.id || !Array.isArray(session.messages))
      throw new Error(`Invalid trace: ${file}`);
    const text = [
      session.title,
      ...session.messages.map((m) => m.content),
    ].join("\n");
    const canonical = [
      ["QATC", /\bQATC\b/i],
      ["ALi", /\bALi\b/],
      ["HAT", /\bHAT\b/],
      ["HAOS", /\bHAOS\b/i],
      ["Source Cube", /\bsource\s*cube\b/i],
      ["Abzu", /\babzu\b/i],
      ["ULUF", /\bULUF\b/i],
    ];
    const topics = canonical
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name);
    const core = topics.length ? 1 : 0;
    await output.write(
      `\nINSERT OR IGNORE INTO sessions VALUES(${[session.id, session.title, session.created_at, session.updated_at, JSON.stringify(topics), session.messages.length, core].map(quote).join(",")});\n`,
    );
    for (const message of session.messages) {
      await output.write(messageStatements(session.id, message));
      messages++;
    }
    sessions++;
    coreSessions += core;
  }
  await output.write(
    "INSERT INTO messages_fts(messages_fts) VALUES('rebuild');\nINSERT INTO messages_fts(messages_fts) VALUES('optimize');\n",
  );
} finally {
  await output.close();
}
console.log(JSON.stringify({ target, sessions, messages, coreSessions }));
