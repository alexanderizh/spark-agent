-- Migration 024: Scheduled Tasks — 定时任务系统
--
-- 新增 scheduled_tasks 表（定时任务定义）
-- 新增 task_executions 表（执行记录）
-- 扩展 sessions 表增加 source / task_id / execution_id 字段

-- ─── scheduled_tasks ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,

  -- Trigger
  trigger_type TEXT NOT NULL DEFAULT 'interval',  -- 'interval' | 'cron' | 'once'
  interval_seconds INTEGER,                        -- for interval type
  cron_expression TEXT,                            -- for cron type
  run_at TEXT,                                     -- ISO datetime for once type
  timezone TEXT DEFAULT 'system',

  -- Time constraints
  start_at TEXT,                                   -- ISO datetime
  end_at TEXT,                                     -- ISO datetime
  max_executions INTEGER DEFAULT 0,                -- 0 = unlimited

  -- Execution config
  agent_id TEXT,
  team_id TEXT,
  model_id TEXT,
  workspace_id TEXT,
  prompt_template TEXT NOT NULL,
  permission_mode TEXT DEFAULT 'ask',
  permission_profile_id TEXT,
  timeout_seconds INTEGER DEFAULT 300,

  -- Retry policy
  max_retries INTEGER DEFAULT 0,
  retry_delay_seconds INTEGER DEFAULT 60,
  retry_backoff TEXT DEFAULT 'fixed',              -- 'fixed' | 'linear' | 'exponential'

  -- Notifications (JSON)
  notifications TEXT DEFAULT '[]',

  -- Concurrency
  concurrency_policy TEXT DEFAULT 'skip',          -- 'skip' | 'queue' | 'cancel'

  -- Metadata
  tags TEXT DEFAULT '[]',                          -- JSON array of strings
  history_retention_days INTEGER DEFAULT 30,

  -- Runtime state
  status TEXT DEFAULT 'idle',                      -- 'idle' | 'running' | 'disabled' | 'error'
  execution_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  next_run_at TEXT,
  last_error TEXT,
  current_execution_id TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── task_executions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  session_id TEXT,

  -- Timing
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER,

  -- Status
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

  -- Result
  output TEXT,
  error TEXT,
  token_usage TEXT,                        -- JSON: {prompt, completion, total}

  -- Retry tracking
  retry_attempt INTEGER DEFAULT 0,
  parent_execution_id TEXT REFERENCES task_executions(id),

  -- Trigger info
  trigger_type TEXT,                       -- 'scheduled' | 'manual' | 'retry'

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for task_executions
CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_executions_status ON task_executions(status);
CREATE INDEX IF NOT EXISTS idx_task_executions_started_at ON task_executions(started_at);

-- Indexes for scheduled_tasks
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run_at ON scheduled_tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);

-- ─── sessions 表扩展 ────────────────────────────────────────────────────────

-- 仅在列不存在时添加（幂等安全）
ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE sessions ADD COLUMN task_id TEXT;
ALTER TABLE sessions ADD COLUMN execution_id TEXT;
