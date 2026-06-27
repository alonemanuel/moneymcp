-- moneymcp D1 schema (Cloudflare SQLite).
-- Source of truth for the store shape; see stack.md.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  hash         TEXT PRIMARY KEY,   -- dedupe key: account|date|amount|identifier
  user_id      TEXT,               -- owner (FK -> users.id)
  source       TEXT,               -- institution: hapoalim | isracard | max | ...
  account      TEXT,               -- account number / id
  date         TEXT NOT NULL,      -- ISO date (yyyy-mm-dd or full ISO)
  description  TEXT,
  memo         TEXT,
  amount       REAL NOT NULL,      -- chargedAmount; negative = debit/outflow
  currency     TEXT,
  status       TEXT,               -- completed | pending
  type         TEXT,               -- normal | installments | ...
  category     TEXT,
  scraped_at   TEXT NOT NULL       -- when this row was last written
);

CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_desc ON transactions(description);

-- Connected institutions per user (drives the dashboard "connected" state).
CREATE TABLE IF NOT EXISTS connections (
  user_id      TEXT NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'connected',  -- connected | error
  last_sync_at TEXT,
  last_error   TEXT,
  PRIMARY KEY (user_id, source)
);

-- One row per sync (per user), with live progress detail for the dashboard.
CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL,        -- running | done | error
  detail      TEXT,                 -- e.g. "hapoalim: 28 | isracard: 86"
  inserted    INTEGER,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_user ON sync_runs(user_id, id DESC);
