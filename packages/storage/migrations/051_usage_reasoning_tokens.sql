-- Migration 051: Preserve reasoning output tokens in the usage ledger.

CREATE TABLE IF NOT EXISTS usage_ledger (
  id                    TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id            TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  model_id              TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL NOT NULL DEFAULT 0.0,
  request_timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE usage_ledger
  ADD COLUMN reasoning_output_tokens INTEGER NOT NULL DEFAULT 0;
