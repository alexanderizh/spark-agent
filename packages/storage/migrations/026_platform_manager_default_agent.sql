-- Migration 026: Make platform-manager the only built-in default agent.
--
-- This repairs databases that already ran migration 023 before the platform
-- manager became the default built-in agent.

DELETE FROM agents
WHERE id = 'code-agent'
  AND (
    built_in = 1
    OR json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.role') = 'coding'
  );

DELETE FROM agents
WHERE built_in = 1
  AND id <> 'platform-manager-agent';

INSERT OR IGNORE INTO agents (
  id, name, description, built_in, enabled, is_default,
  agent_adapter, permission_mode, reasoning_effort,
  prompt, skill_ids_json, metadata_json
) VALUES (
  'platform-manager-agent',
  '平台管理',
  '管理 Spark Agent 平台的 Skills、MCP 服务器、Providers、Workflows、Agents、Settings 和看板任务。',
  1, 1, 1,
  'claude-sdk', 'claude-ask', 'medium',
  '你是 Spark Agent 的平台管理助手。你负责管理平台中的各项配置和功能。

工作原则：
- 使用平台管理 skill 来完成用户的平台管理需求。
- 需要搜索资料时优先使用 multi-search-engine；需要浏览网页或本地页面时使用 browser-use。
- 需要发现、安装或创建能力扩展时使用 find-skills。
- 响应简洁，先给结论再展开。
- 涉及删除操作时，先确认再执行。
- 不臆造配置信息，缺失即明确询问。',
  '["builtin:platform-manager","builtin:multi-search-engine","builtin:browser-use","builtin:find-skills"]',
  '{"role":"platform-manager","system":true,"avatar":{"kind":"builtin","id":"platform-manager"}}'
);

UPDATE sessions
SET agent_id = 'platform-manager-agent'
WHERE agent_id IS NULL
  OR agent_id = ''
  OR agent_id = 'code-agent';

UPDATE agents SET is_default = 0 WHERE id <> 'platform-manager-agent';

UPDATE agents
SET
  name = '平台管理',
  description = '管理 Spark Agent 平台的 Skills、MCP 服务器、Providers、Workflows、Agents、Settings 和看板任务。',
  built_in = 1,
  enabled = 1,
  is_default = 1,
  agent_adapter = 'claude-sdk',
  permission_mode = 'claude-ask',
  reasoning_effort = 'medium',
  skill_ids_json = '["builtin:platform-manager","builtin:multi-search-engine","builtin:browser-use","builtin:find-skills"]',
  metadata_json = json_set(
    COALESCE(NULLIF(metadata_json, ''), '{}'),
    '$.role', 'platform-manager',
    '$.system', json('true'),
    '$.avatar', json_object('kind', 'builtin', 'id', 'platform-manager')
  )
WHERE id = 'platform-manager-agent';
