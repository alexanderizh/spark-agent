-- Context Governor: file pin/exclude preferences per workspace
-- Allows users to explicitly pin important files or exclude irrelevant ones from context discovery.

CREATE TABLE IF NOT EXISTS context_preferences (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pin', 'exclude')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_context_preferences_workspace
  ON context_preferences(workspace_id, action, enabled);
