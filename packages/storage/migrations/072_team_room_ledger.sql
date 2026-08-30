-- Migration 072: versioned Team Outcome Room ledger
-- The event log is append-only; room_ledger_records is the rebuildable projection.

CREATE TABLE IF NOT EXISTS room_ledger_records (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  discussion_id TEXT,
  logical_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','active','rejected','superseded','invalid','expired','deleted','conflict')),
  authority TEXT NOT NULL CHECK(authority IN ('user-confirmed','system-observed','agent-inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  source_refs_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  supersedes TEXT REFERENCES room_ledger_records(id),
  reason TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  UNIQUE(room_id, logical_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_ledger_current
  ON room_ledger_records(room_id, logical_key) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_room_ledger_context
  ON room_ledger_records(room_id, discussion_id, status, is_current);

CREATE TABLE IF NOT EXISTS room_ledger_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK(operation IN ('create','replace','correct','invalidate','tombstone','confirm','reject','expire','restore')),
  record_id TEXT NOT NULL REFERENCES room_ledger_records(id),
  previous_record_id TEXT,
  record_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_ledger_events_room
  ON room_ledger_events(room_id, logical_key, created_at);
