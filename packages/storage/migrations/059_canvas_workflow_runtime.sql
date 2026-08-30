-- 059_canvas_workflow_runtime.sql
-- 无限画布工作流不可变版本与运行态。不得写入应用工作台 workflow_runs。

CREATE TABLE IF NOT EXISTS canvas_workflow_versions (
  workflow_id   TEXT NOT NULL,
  version       INTEGER NOT NULL CHECK (version > 0),
  name          TEXT NOT NULL,
  package_json  TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (workflow_id, version),
  FOREIGN KEY (workflow_id) REFERENCES canvas_workflows (id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO canvas_workflow_versions (
  workflow_id, version, name, package_json, created_by_user_id, created_at
)
SELECT id, version, name, package_json, user_id, updated_at
FROM canvas_workflows;

CREATE TABLE IF NOT EXISTS canvas_workflow_runs (
  id                  TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL,
  workflow_version    INTEGER NOT NULL CHECK (workflow_version > 0),
  project_id          TEXT NOT NULL,
  user_id             INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  inputs_json         TEXT NOT NULL DEFAULT '{}',
  exposed_params_json TEXT NOT NULL DEFAULT '{}',
  outputs_json        TEXT NOT NULL DEFAULT '{}',
  error_json          TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TEXT NOT NULL,
  started_at          TEXT,
  finished_at         TEXT,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (workflow_id, workflow_version)
    REFERENCES canvas_workflow_versions (workflow_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES canvas_projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_workflow_runs_project_created
  ON canvas_workflow_runs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvas_workflow_runs_workflow_created
  ON canvas_workflow_runs (workflow_id, workflow_version, created_at DESC);

CREATE TABLE IF NOT EXISTS canvas_workflow_run_steps (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL,
  node_id             TEXT NOT NULL,
  step_index          INTEGER NOT NULL CHECK (step_index >= 0),
  status              TEXT NOT NULL DEFAULT 'blocked'
                        CHECK (status IN ('blocked', 'ready', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
  depends_on_json     TEXT NOT NULL DEFAULT '[]',
  task_id             TEXT,
  input_json          TEXT NOT NULL DEFAULT '{}',
  output_json         TEXT,
  error_json          TEXT,
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  started_at          TEXT,
  finished_at         TEXT,
  updated_at          TEXT NOT NULL,
  UNIQUE (run_id, node_id),
  FOREIGN KEY (run_id) REFERENCES canvas_workflow_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_workflow_run_steps_ready
  ON canvas_workflow_run_steps (run_id, status, step_index);
