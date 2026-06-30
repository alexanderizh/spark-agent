-- Migration 040: Managed workflow runtime snapshots
--
-- workflow_run 是编排内核的运行态：记录一次 workflow 工具调用的图、目标、
-- 中间 state、worker/atomic 节点执行记录和已完成节点集合，用于审计与断点续跑。

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('working','completed','failed','canceled')),
  objective TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  executions_json TEXT NOT NULL DEFAULT '[]',
  atomic_executions_json TEXT NOT NULL DEFAULT '[]',
  completed_node_ids_json TEXT NOT NULL DEFAULT '[]',
  failed_node_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_session
  ON workflow_runs(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_resume
  ON workflow_runs(session_id, workflow_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_turn
  ON workflow_runs(turn_id);
