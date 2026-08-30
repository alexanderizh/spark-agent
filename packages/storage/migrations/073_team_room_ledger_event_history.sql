-- Migration 073: decouple authoritative ledger events from rebuildable records.
-- Existing 072 databases have an FK from event.record_id to the projection;
-- replay must be able to clear records while retaining the event history.

CREATE TABLE room_ledger_events_rebuild (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK(operation IN ('create','replace','correct','invalidate','tombstone','confirm','reject','expire','restore')),
  record_id TEXT NOT NULL,
  previous_record_id TEXT,
  record_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO room_ledger_events_rebuild
  (id, room_id, logical_key, op_id, operation, record_id, previous_record_id, record_json, actor_id, created_at)
SELECT id, room_id, logical_key, op_id, operation, record_id, previous_record_id, record_json, actor_id, created_at
FROM room_ledger_events;

DROP TABLE room_ledger_events;
ALTER TABLE room_ledger_events_rebuild RENAME TO room_ledger_events;

CREATE INDEX IF NOT EXISTS idx_room_ledger_events_room
  ON room_ledger_events(room_id, logical_key, created_at);
