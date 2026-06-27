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

-- One row per scrape attempt, for freshness / get_scrape_status.
CREATE TABLE IF NOT EXISTS scrape_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  success      INTEGER,            -- 1 / 0
  inserted     INTEGER,            -- new rows upserted
  error        TEXT
);
