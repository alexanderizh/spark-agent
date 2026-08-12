-- Migration 074: make Room Ledger projection identity discussion-scoped.
-- 072/073 databases used room + logical key for versions/current uniqueness,
-- which prevented later discussions in the same room from reusing a key.

CREATE TABLE room_ledger_records_discussion_scope (
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
  supersedes TEXT REFERENCES room_ledger_records_discussion_scope(id),
  reason TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1))
);

INSERT INTO room_ledger_records_discussion_scope
  (id, room_id, discussion_id, logical_key, value_json, status, authority, confidence,
   source_refs_json, version, created_by, created_at, updated_by, updated_at, expires_at,
   supersedes, reason, is_current)
SELECT id, room_id, discussion_id, logical_key, value_json, status, authority, confidence,
       source_refs_json, version, created_by, created_at, updated_by, updated_at, expires_at,
       supersedes, reason, is_current
FROM room_ledger_records;

DROP TABLE room_ledger_records;
ALTER TABLE room_ledger_records_discussion_scope RENAME TO room_ledger_records;

CREATE UNIQUE INDEX idx_room_ledger_version_discussion
  ON room_ledger_records(room_id, discussion_id, logical_key, version)
  WHERE discussion_id IS NOT NULL;
CREATE UNIQUE INDEX idx_room_ledger_version_legacy
  ON room_ledger_records(room_id, logical_key, version)
  WHERE discussion_id IS NULL;
CREATE UNIQUE INDEX idx_room_ledger_current
  ON room_ledger_records(room_id, discussion_id, logical_key)
  WHERE is_current = 1 AND discussion_id IS NOT NULL;
CREATE UNIQUE INDEX idx_room_ledger_current_legacy
  ON room_ledger_records(room_id, logical_key)
  WHERE is_current = 1 AND discussion_id IS NULL;
CREATE INDEX idx_room_ledger_context
  ON room_ledger_records(room_id, discussion_id, status, is_current);

ALTER TABLE room_ledger_events ADD COLUMN discussion_id TEXT;
UPDATE room_ledger_events
SET discussion_id = json_extract(record_json, '$.discussionId');
DROP INDEX IF EXISTS idx_room_ledger_events_room;
CREATE INDEX idx_room_ledger_events_room
  ON room_ledger_events(room_id, discussion_id, logical_key, created_at);
