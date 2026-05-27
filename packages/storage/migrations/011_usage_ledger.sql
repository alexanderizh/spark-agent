-- P3-04: Usage Ledger
-- Records token usage per session turn for billing/analytics.
-- Each row represents a single API call's token consumption.

CREATE TABLE IF NOT EXISTS usage_ledger (
  id           TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id   TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0.0,
  request_timestamp     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Index for session-level queries
CREATE INDEX IF NOT EXISTS idx_usage_ledger_session
  ON usage_ledger (session_id);

-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_usage_ledger_timestamp
  ON usage_ledger (request_timestamp);

-- Index for provider/model grouping
CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider_model
  ON usage_ledger (provider_id, model_id);
