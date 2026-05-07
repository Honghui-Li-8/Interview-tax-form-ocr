CREATE TABLE IF NOT EXISTS tax_documents (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  idempotency_key  TEXT     UNIQUE,
  filename         TEXT     NOT NULL,
  stored_path      TEXT     NOT NULL,
  mime_type        TEXT     NOT NULL,
  status           TEXT     NOT NULL DEFAULT 'pending',
  created_at       TEXT     NOT NULL DEFAULT (datetime('now'))
);
