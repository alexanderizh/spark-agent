-- Migration 111: 执行连续性子系统（execution continuity）
--
-- 长程任务断点继续（docs/spark-work开发相关/plans/2026-09-10-长程任务断点继续与执行连续性重构方案.md §6）。
-- 六张核心表 + 恢复计划表：
--   execution_runs            可恢复根任务/子任务 + 租约（lease owner/epoch/expires）
--   execution_steps           稳定步骤（UNIQUE(run_id, stable_key, attempt)）
--   execution_checkpoints     版本化逻辑 Checkpoint 信封
--   execution_effects         工具副作用 write-ahead 执行信封
--   execution_waits           持久 HITL 等待（问题/权限/计划审批）
--   execution_outbox          durable outbox（状态变化先落库，不依赖 Renderer 在线）
--   execution_recovery_plans  版本化恢复计划（同 Run+checkpoint+env 只允许一个有效计划）
--
-- 状态机守卫由仓储层（UPDATE ... WHERE status IN (...)）保证，不在 SQL 层枚举全部转换。

CREATE TABLE execution_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  root_turn_id TEXT,
  parent_run_id TEXT,
  parent_step_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  requested_recovery_mode TEXT NOT NULL DEFAULT 'auto',
  capability_ceiling INTEGER NOT NULL DEFAULT 1,
  current_guaranteed_level INTEGER NOT NULL DEFAULT 1,
  input_ref TEXT NOT NULL DEFAULT '',
  runtime_kind TEXT NOT NULL,
  runtime_binding_json TEXT,
  definition_fingerprint TEXT NOT NULL DEFAULT '',
  latest_checkpoint_id TEXT,
  latest_recovery_plan_id TEXT,
  lease_owner TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  interruption_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_runs_status_kind ON execution_runs(status, kind);
CREATE INDEX idx_execution_runs_session ON execution_runs(session_id, updated_at);
CREATE INDEX idx_execution_runs_active_lease ON execution_runs(status, lease_expires_at);

CREATE TABLE execution_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  parent_step_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  attempt INTEGER NOT NULL DEFAULT 1,
  input_hash TEXT,
  result_ref TEXT,
  replay_policy TEXT,
  started_at TEXT,
  committed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, stable_key, attempt)
);

CREATE INDEX idx_execution_steps_run_status ON execution_steps(run_id, status);

CREATE TABLE execution_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  reason TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, sequence)
);

CREATE INDEX idx_execution_checkpoints_run ON execution_checkpoints(run_id, sequence DESC);

CREATE TABLE execution_effects (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  idempotency_key TEXT,
  replay_policy TEXT NOT NULL DEFAULT 'confirm',
  phase TEXT NOT NULL DEFAULT 'prepared',
  external_receipt_ref TEXT,
  result_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES execution_steps(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_effects_run_phase ON execution_effects(run_id, phase);
CREATE INDEX idx_execution_effects_step ON execution_effects(step_id);
CREATE INDEX idx_execution_effects_tool ON execution_effects(tool_name);

CREATE TABLE execution_waits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  request_json TEXT,
  answer_json TEXT,
  deadline_at TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
);

-- 幂等弹卡：同 (run_id, step_id, type) 同时至多一个 open 等待；
-- 关闭后的下一次同类等待允许新开一行（保留审计历史）。
CREATE UNIQUE INDEX idx_execution_waits_open_unique
  ON execution_waits(run_id, step_id, type) WHERE status = 'open';

CREATE INDEX idx_execution_waits_open ON execution_waits(run_id, status);

CREATE TABLE execution_outbox (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_outbox_pending ON execution_outbox(published_at, created_at);

CREATE TABLE execution_recovery_plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  checkpoint_id TEXT,
  environment_fingerprint TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_recovery_plans_run
  ON execution_recovery_plans(run_id, status, created_at);
