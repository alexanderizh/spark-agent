-- Migration 001: Initial Schema
-- 创建 Spark Agent 核心表结构
-- 参考: docs/desktop-agent-development-guide.md §6.1

-- ─── 工作区 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  spark_config_path TEXT NOT NULL,
  agent_runtime_path TEXT NOT NULL,
  project_kind TEXT NOT NULL,
  relocated_from_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 会话 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_ids_json TEXT NOT NULL DEFAULT '[]',
  rule_bundle_id TEXT,
  permission_profile_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
  ON sessions(project_id, updated_at);

-- ─── Agent 事件流 ────────────────────────────────────────────────
-- 核心表：所有 Agent 事件（消息、工具调用、权限请求等）都写入此表
-- event_json 存储完整的事件 JSON（AgentEvent 的序列化形式）
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  turn_id TEXT,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_events_session_created
  ON agent_events(session_id, created_at);

-- ─── Provider 配置 ──────────────────────────────────────────────
-- config_json 中包含 provider 特定配置（API endpoint、参数等）
-- API Key 不在此表，通过 keychain_ref 引用系统 Keychain
CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Model 配置 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Provider 预设目录 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_catalog_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  compatibility TEXT NOT NULL,
  auth_schema_json TEXT NOT NULL DEFAULT '{}',
  default_config_json TEXT NOT NULL DEFAULT '{}',
  capability_probe_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 模型能力元数据 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_capabilities (
  id TEXT PRIMARY KEY,
  model_profile_id TEXT NOT NULL,
  modalities_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  context_window_tokens INTEGER,
  max_input_tokens INTEGER,
  max_output_tokens INTEGER,
  tokenizer TEXT NOT NULL DEFAULT 'cl100k',
  pricing_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  probed_at TEXT
);

-- ─── Usage 账本 ─────────────────────────────────────────────────
-- 每次 API 调用的 token 使用和成本记录
CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  run_id TEXT,
  turn_id TEXT,
  workflow_node_id TEXT,
  agent_id TEXT,
  provider_id TEXT NOT NULL,
  model_profile_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  media_usage_json TEXT,
  cost_json TEXT NOT NULL DEFAULT '{}',
  latency_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'api',
  raw_usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_session_created
  ON usage_ledger(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_model_created
  ON usage_ledger(model_profile_id, created_at);

-- ─── Run 使用汇总 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_usage_summaries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT,
  workflow_id TEXT,
  agent_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_json TEXT NOT NULL DEFAULT '{}',
  media_usage_json TEXT,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 媒体产物 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  thumbnail_uri TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  source_provider_id TEXT,
  source_model_profile_id TEXT,
  prompt_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 规则 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_ref TEXT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── MCP Servers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Skills ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  root_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 工作流 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  graph_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Slash 命令 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slash_commands (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  group_name TEXT NOT NULL,
  risk TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 资源采样 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_samples (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  process_label TEXT NOT NULL,
  cpu_percent REAL NOT NULL DEFAULT 0,
  memory_mb REAL NOT NULL DEFAULT 0,
  open_files INTEGER,
  child_processes INTEGER,
  sampled_at TEXT NOT NULL DEFAULT (datetime('now'))
);
