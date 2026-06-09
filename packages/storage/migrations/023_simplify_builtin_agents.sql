-- Migration 023: Simplify built-in agents — only keep platform-manager
--
-- Remove all built-in agents except code-agent (which becomes non-built-in)
-- and add a single platform-manager agent with the platform-manager skill.
-- Also remove all built-in teams. Users configure their own agents and teams.

-- Remove built-in teams
DELETE FROM agent_teams WHERE built_in = 1;

-- Demote old built-in agents to user-level (so users can delete if wanted)
-- code-agent stays but is no longer built_in
UPDATE agents SET built_in = 0 WHERE id = 'code-agent' AND built_in = 1;

-- Remove other built-in agents entirely (they were seeded, users haven't customized them meaningfully)
DELETE FROM agents WHERE id IN (
  'docs-agent',
  'uiux-agent',
  'secretary-agent',
  'devops-agent',
  'pm-agent',
  'dev-agent',
  'qa-agent'
) AND built_in = 1;

-- Insert the platform-manager agent
INSERT OR IGNORE INTO agents (
  id, name, description, built_in, enabled,
  agent_adapter, permission_mode, reasoning_effort,
  prompt, skill_ids_json, metadata_json
) VALUES (
  'platform-manager-agent',
  '平台管理',
  '管理 Spark Agent 平台的 Skills、MCP 服务器、Providers、Workflows、Agents、Settings 和看板任务。',
  1, 1,
  'claude-sdk', 'claude-ask', 'medium',
  '你是 Spark Agent 的平台管理助手。你负责管理平台中的各项配置和功能。

工作原则：
- 使用平台管理 skill 来完成用户的平台管理需求。
- 响应简洁，先给结论再展开。
- 涉及删除操作时，先确认再执行。
- 不臆造配置信息，缺失即明确询问。',
  '["builtin:platform-manager"]',
  '{"role":"platform-manager","system":true}'
);
