-- Migration 018: Add session metadata JSON
--
-- Team Mode persists per-session configuration under sessions.metadata_json.team.
-- Older databases created before Team Mode do not have this column, so sending the
-- first team turn can fail with "no such column: metadata_json".

ALTER TABLE sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
