-- Migration 005: Add project/session lifecycle metadata
ALTER TABLE workspaces ADD COLUMN pinned_at TEXT;
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;

ALTER TABLE sessions ADD COLUMN pinned_at TEXT;
ALTER TABLE sessions ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_workspaces_lifecycle
  ON workspaces(archived_at, pinned_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle
  ON sessions(archived_at, pinned_at, updated_at);
