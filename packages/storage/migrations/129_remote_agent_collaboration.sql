CREATE TABLE IF NOT EXISTS remote_agent_collaboration_links (
  account_user_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  remote_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('opening', 'ready', 'unreachable')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, link_id),
  UNIQUE (account_user_id, remote_session_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_collaboration_source
  ON remote_agent_collaboration_links(account_user_id, source_session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_collaboration_operations (
  account_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  turn_id TEXT,
  delivery_turn_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('submitting', 'queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled', 'uncertain')
  ),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    delivery_state IN ('pending', 'submitted', 'suppressed', 'failed')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, operation_id),
  FOREIGN KEY (account_user_id, link_id)
    REFERENCES remote_agent_collaboration_links(account_user_id, link_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_collaboration_operations_link
  ON remote_agent_collaboration_operations(account_user_id, link_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_agent_collaboration_artifacts (
  account_user_id TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  link_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
  remote_path TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, artifact_ref),
  FOREIGN KEY (account_user_id, link_id)
    REFERENCES remote_agent_collaboration_links(account_user_id, link_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_collaboration_artifacts_link
  ON remote_agent_collaboration_artifacts(account_user_id, link_id, direction, created_at DESC);
