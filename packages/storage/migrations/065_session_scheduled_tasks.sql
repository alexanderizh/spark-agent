-- Migration 065: bind scheduled tasks to an existing chat session.

ALTER TABLE scheduled_tasks
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'
  CHECK (scope IN ('global', 'session'));

ALTER TABLE scheduled_tasks
  ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE scheduled_tasks
  ADD COLUMN paused_by_archive INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_session_id
  ON scheduled_tasks(session_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_scope_due
  ON scheduled_tasks(scope, enabled, next_run_at);
