CREATE TABLE IF NOT EXISTS remote_agent_executions (
  account_user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  source_session_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  remote_session_id TEXT,
  turn_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('reserved', 'session_created', 'submitting', 'submitted')
  ),
  dispatch_status TEXT CHECK (dispatch_status IS NULL OR dispatch_status IN ('queued', 'running')),
  attachment_paths_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_user_id, task_id),
  UNIQUE(account_user_id, remote_session_id),
  UNIQUE(account_user_id, turn_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_agent_executions_status_updated
  ON remote_agent_executions(account_user_id, status, updated_at DESC);
