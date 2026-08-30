-- Migration 015: Agents management and workflow runtime metadata

ALTER TABLE sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'code-agent';

CREATE INDEX IF NOT EXISTS idx_sessions_agent_id
  ON sessions(agent_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  provider_profile_id TEXT,
  model_id TEXT,
  agent_adapter TEXT NOT NULL DEFAULT 'claude-sdk',
  permission_mode TEXT NOT NULL DEFAULT 'claude-ask',
  reasoning_effort TEXT NOT NULL DEFAULT 'medium',
  prompt TEXT NOT NULL DEFAULT '',
  rule_ids_json TEXT NOT NULL DEFAULT '[]',
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  disabled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
  hook_config_json TEXT NOT NULL DEFAULT '{}',
  workflow_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agents_enabled_updated
  ON agents(enabled, updated_at);

CREATE INDEX IF NOT EXISTS idx_agents_workflow_id
  ON agents(workflow_id);

ALTER TABLE workflows ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE workflows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE workflows ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE workflows ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_workflows_scope_status_updated
  ON workflows(scope, status, updated_at);

INSERT OR IGNORE INTO agents (
  id,
  name,
  description,
  built_in,
  enabled,
  agent_adapter,
  permission_mode,
  reasoning_effort,
  prompt,
  metadata_json
) VALUES (
  'code-agent',
  '编码 Agent',
  '系统内置编码智能体，保留当前默认执行体验。',
  1,
  1,
  'claude-sdk',
  'claude-ask',
  'medium',
  '你是 Spark Agent 的内置编码智能体。优先理解代码、最小化修改范围、运行必要验证，并清晰报告结果。',
  '{"role":"coding","system":true}'
);
