-- Migration 098: Session-scoped workflow bindings and run audit metadata
--
-- Bindings are intentionally separate from sessions.metadata_json.  A missing
-- row is the compatibility sentinel for the legacy Agent workflow path.

CREATE TABLE IF NOT EXISTS session_workflow_bindings (
  session_id TEXT PRIMARY KEY,
  binding_instance_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('inherit', 'override', 'disabled')),
  workflow_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE RESTRICT,
  CHECK (
    (mode = 'override' AND workflow_id IS NOT NULL) OR
    (mode IN ('inherit', 'disabled') AND workflow_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_session_workflow_bindings_workflow
  ON session_workflow_bindings(workflow_id);

ALTER TABLE workflow_runs ADD COLUMN workflow_binding_instance_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN workflow_graph_digest TEXT;
ALTER TABLE workflow_runs ADD COLUMN workflow_name_snapshot TEXT;
ALTER TABLE workflow_runs ADD COLUMN workflow_version_snapshot TEXT;
ALTER TABLE workflow_runs ADD COLUMN binding_source TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_binding_resume
  ON workflow_runs(session_id, workflow_binding_instance_id, status, updated_at);
