-- One-time secure input requests contain metadata only. Secret plaintext never
-- enters SQLite and is written directly to the system Keychain by the host.

CREATE TABLE tool_package_secure_requests (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN (
    'package', 'tool', 'project', 'agent', 'workflow', 'session'
  )),
  scope_id TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL CHECK (requested_by IN ('agent', 'user')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (package_id, version)
    REFERENCES tool_package_versions(package_id, version) ON DELETE CASCADE
);

CREATE INDEX idx_tool_package_secure_requests_pending
  ON tool_package_secure_requests(status, expires_at, created_at DESC);
