-- Migration 007: Add per-session agent runtime controls
ALTER TABLE sessions ADD COLUMN agent_adapter TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'codex-default';

CREATE INDEX IF NOT EXISTS idx_sessions_agent_runtime
  ON sessions(agent_adapter, permission_mode);
