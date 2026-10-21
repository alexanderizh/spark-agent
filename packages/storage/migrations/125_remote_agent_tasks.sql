CREATE TABLE IF NOT EXISTS remote_agent_tasks (
  account_user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  source_session_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  remote_session_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'dispatching',
      'queued',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'rejected',
      'cancel_requested',
      'cancelled'
    )
  ),
  transport_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
    transport_state IN ('unknown', 'reachable', 'unreachable')
  ),
  pending_approval_id TEXT,
  result_summary TEXT,
  error_code TEXT CHECK (
    error_code IS NULL OR error_code IN (
      'DEVICE_UNREACHABLE',
      'REMOTE_AUTH_REQUIRED',
      'REMOTE_TARGET_NOT_FOUND',
      'TASK_ID_CONFLICT',
      'REMOTE_REQUEST_TIMEOUT',
      'REMOTE_EXECUTION_FAILED',
      'REMOTE_CANCEL_REJECTED',
      'UNKNOWN'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(account_user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_agent_tasks_source_created
  ON remote_agent_tasks(account_user_id, source_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remote_agent_tasks_target_status
  ON remote_agent_tasks(account_user_id, target_device_id, status, updated_at DESC);
