-- moneymcp D1 schema (Cloudflare SQLite).
-- Source of truth for the store shape; see stack.md.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  hash             TEXT PRIMARY KEY,   -- dedupe key: account|date|amount|identifier
  user_id          TEXT,               -- owner (FK -> users.id)
  source           TEXT,               -- institution: hapoalim | isracard | max | ...
  account          TEXT,               -- account number / card
  date             TEXT NOT NULL,      -- transaction date (ISO)
  processed_date   TEXT,               -- when it posted/settled
  description      TEXT,
  memo             TEXT,
  amount           REAL NOT NULL,      -- chargedAmount; negative = debit/outflow
  original_amount  REAL,               -- pre-FX amount (foreign txns)
  currency         TEXT,               -- original currency
  identifier       TEXT,               -- bank's own transaction id
  installment_num  INTEGER,            -- this installment #
  installment_total INTEGER,           -- total installments
  status           TEXT,               -- completed | pending
  type             TEXT,               -- normal | installments | ...
  category         TEXT,
  scraped_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_desc ON transactions(description);

-- Connected institutions per user (drives the dashboard "connected" state).
CREATE TABLE IF NOT EXISTS connections (
  user_id      TEXT NOT NULL,
  source       TEXT NOT NULL,
  account_type TEXT,                                -- bank | card
  status       TEXT NOT NULL DEFAULT 'connected',  -- connected | error
  last_sync_at TEXT,
  last_error   TEXT,
  PRIMARY KEY (user_id, source)
);

-- One row per (user, source) per scrape — gives per-account sync history.
CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  source      TEXT,                 -- which institution this sync covered
  status      TEXT NOT NULL,        -- running | done | error
  detail      TEXT,
  inserted    INTEGER,              -- transactions upserted in this sync
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_user ON sync_runs(user_id, id DESC);

-- Point-in-time account balance snapshots (a detail beyond transactions).
CREATE TABLE IF NOT EXISTS balances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  account     TEXT,
  balance     REAL,
  scraped_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bal ON balances(user_id, source, id DESC);
