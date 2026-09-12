-- SparkWork 自定义生命周期 Hooks V2（观察型 MVP）。
-- 四张表：hook_definitions（定义）/ hook_bindings（作用域绑定）/ hook_events（持久化 outbox）
--        / hook_runs（运行审计与调度队列）。
-- additive migration：全部新建表，另为统一工具审计补两列 Hook 归因，不修改既有业务表。

CREATE TABLE IF NOT EXISTS hook_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_name TEXT NOT NULL,
  condition_json TEXT,
  action_json TEXT NOT NULL,
  input_mapping_json TEXT NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  retry_policy_json TEXT NOT NULL DEFAULT '{"mode":"unsafe","maxAttempts":3,"backoffMs":1000}',
  concurrency_policy TEXT NOT NULL DEFAULT 'serial_per_session'
    CHECK (concurrency_policy IN ('serial_per_session', 'parallel')),
  revision INTEGER NOT NULL DEFAULT 1,
  execution_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hook_definitions_event_enabled
  ON hook_definitions(event_name, enabled);

CREATE TABLE IF NOT EXISTS hook_bindings (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL REFERENCES hook_definitions(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL
    CHECK (scope_kind IN ('application', 'workspace', 'agent', 'session')),
  -- application 作用域统一存空串，保证 (hook_id, scope_kind, scope_id) 唯一约束可靠。
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'needs_review', 'disabled')),
  trusted_execution_hash TEXT,
  authorized_effect TEXT,
  authorized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hook_id, scope_kind, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_hook_bindings_scope
  ON hook_bindings(scope_kind, scope_id);

CREATE TABLE IF NOT EXISTS hook_events (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  agent_id TEXT,
  primary_workspace_id TEXT,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolving', 'resolved', 'failed')),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_hook_events_status_available
  ON hook_events(status, available_at);
CREATE INDEX IF NOT EXISTS idx_hook_events_session
  ON hook_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS hook_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  hook_id TEXT NOT NULL,
  hook_revision INTEGER NOT NULL,
  binding_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  definition_snapshot_json TEXT NOT NULL,
  binding_snapshot_json TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  mapped_input_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'succeeded', 'failed', 'skipped', 'blocked', 'cancelled', 'outcome_unknown'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  input_summary_json TEXT,
  output_summary_json TEXT,
  correlation_id TEXT,
  invocation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- 同一事件 + 同一 Hook 只允许一条运行记录（跨 revision 也不自动重跑）。
  UNIQUE (event_id, hook_id)
);

CREATE INDEX IF NOT EXISTS idx_hook_runs_status_available
  ON hook_runs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_hook_runs_serial_order
  ON hook_runs(hook_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_runs_session
  ON hook_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_runs_hook
  ON hook_runs(hook_id, created_at);

-- Hook 来源的统一工具调用归因（invocation_source='hook' 时写入）。
ALTER TABLE tool_invocations ADD COLUMN hook_id TEXT;
ALTER TABLE tool_invocations ADD COLUMN hook_run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tool_invocations_hook
  ON tool_invocations(hook_id, started_at);
