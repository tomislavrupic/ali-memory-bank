CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at REAL, updated_at REAL,
  topics TEXT NOT NULL, message_count INTEGER NOT NULL, core INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  rowid INTEGER PRIMARY KEY, id TEXT NOT NULL, session_id TEXT NOT NULL,
  ord INTEGER NOT NULL, role TEXT NOT NULL, timestamp TEXT, content TEXT NOT NULL,
  parent_id TEXT, UNIQUE(session_id, ord)
);
CREATE INDEX IF NOT EXISTS messages_session_order ON messages(session_id, ord);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
