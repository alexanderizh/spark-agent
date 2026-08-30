CREATE TABLE IF NOT EXISTS permission_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permission_decisions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id TEXT,
  workspace_ids_json TEXT,
  action TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permission_decisions_lookup
  ON permission_decisions(scope, project_id, action, tool_name, updated_at);
