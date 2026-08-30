-- 058_canvas_workflows.sql
-- 无限画布工作流定义。与应用工作台 workflows / workflow_runs 完全隔离。

CREATE TABLE IF NOT EXISTS canvas_workflows (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL DEFAULT 0,
  project_id    TEXT,
  name          TEXT NOT NULL,
  description   TEXT,
  scope         TEXT NOT NULL CHECK (scope IN ('project', 'library', 'builtin')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  tags_json     TEXT NOT NULL DEFAULT '[]',
  package_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES canvas_projects (id) ON DELETE CASCADE,
  CHECK (
    (scope = 'project' AND project_id IS NOT NULL) OR
    (scope IN ('library', 'builtin') AND project_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_canvas_workflows_user_scope_status
  ON canvas_workflows (user_id, scope, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvas_workflows_project_status
  ON canvas_workflows (project_id, status, updated_at DESC);
