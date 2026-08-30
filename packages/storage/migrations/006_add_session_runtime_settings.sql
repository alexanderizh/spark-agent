-- Migration 006: Add per-session runtime settings
ALTER TABLE sessions ADD COLUMN model_id TEXT;
ALTER TABLE sessions ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS idx_sessions_provider_model
  ON sessions(provider_profile_id, model_id);
