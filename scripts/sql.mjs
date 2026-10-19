export const quote = (value) =>
  value == null
    ? "NULL"
    : `'${String(value).replace(/'/g, "''").replace(/\0/g, "'||char(0)||'")}'`;

export function messageStatements(sessionId, message) {
  // D1 caps SQL statement size. Split large messages without changing their content.
  const chunks = [];
  const characters = Array.from(message.content);
  for (let i = 0; i < characters.length; i += 8000)
    chunks.push(characters.slice(i, i + 8000).join(""));
  if (!chunks.length) chunks.push("");
  const statements = [
    `INSERT OR IGNORE INTO messages(id,session_id,ord,role,timestamp,content,parent_id) VALUES(${[message.id, sessionId, message.order, message.role, message.timestamp, chunks[0], message.parent_id].map(quote).join(",")});`,
  ];
  let bytes = Buffer.byteLength(chunks[0]);
  for (const chunk of chunks.slice(1)) {
    // The byte guard makes retries safe when the complete message already exists.
    statements.push(
      `UPDATE messages SET content=content||${quote(chunk)} WHERE session_id=${quote(sessionId)} AND ord=${quote(message.order)} AND length(CAST(content AS BLOB))=${bytes};`,
    );
    bytes += Buffer.byteLength(chunk);
  }
  return statements.join("\n") + "\n";
}
