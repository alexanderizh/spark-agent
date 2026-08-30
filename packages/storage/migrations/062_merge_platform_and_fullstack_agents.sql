-- 062_merge_platform_and_fullstack_agents.sql
-- 将内置「平台管理」与「全栈编码 Agent」合并为唯一的「Spark助手」。
-- 保留 platform-manager-agent 作为稳定 ID，迁移旧全栈 Agent 的运行引用后删除旧行；
-- 画布助手 canvas-assistant-agent 不在本次合并范围内。

-- 先合并两个 Agent 的列表型配置，避免丢失用户在旧内置 Agent 上追加的能力。
WITH merged_skills(value) AS (
  SELECT value
  FROM json_each(COALESCE((SELECT skill_ids_json FROM agents WHERE id = 'platform-manager-agent'), '[]'))
  UNION
  SELECT value
  FROM json_each(COALESCE((SELECT skill_ids_json FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'), '[]'))
),
merged_rules(value) AS (
  SELECT value
  FROM json_each(COALESCE((SELECT rule_ids_json FROM agents WHERE id = 'platform-manager-agent'), '[]'))
  UNION
  SELECT value
  FROM json_each(COALESCE((SELECT rule_ids_json FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'), '[]'))
),
merged_disabled_skills(value) AS (
  SELECT value
  FROM json_each(COALESCE((SELECT disabled_skill_ids_json FROM agents WHERE id = 'platform-manager-agent'), '[]'))
  UNION
  SELECT value
  FROM json_each(COALESCE((SELECT disabled_skill_ids_json FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'), '[]'))
),
merged_mcp(value) AS (
  SELECT value
  FROM json_each(COALESCE((SELECT mcp_server_ids_json FROM agents WHERE id = 'platform-manager-agent'), '[]'))
  UNION
  SELECT value
  FROM json_each(COALESCE((SELECT mcp_server_ids_json FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'), '[]'))
)
UPDATE agents
SET
  name = 'Spark助手',
  description = 'Spark Work 内置通用助手，统一承担平台管理、全栈开发、资料检索、内容生产与工作流执行。',
  built_in = 1,
  enabled = 1,
  is_default = CASE
    WHEN is_default = 1 OR EXISTS (
      SELECT 1 FROM agents
      WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3' AND is_default = 1
    ) THEN 1
    ELSE 0
  END,
  agent_adapter = 'claude-sdk',
  permission_mode = 'claude-auto-edits',
  reasoning_effort = 'high',
  prompt = '你是 Spark Work 的「Spark助手」，是用户默认使用的通用应用助手。你同时具备平台管理与全栈开发能力，应根据用户目标选择合适的工作方式，而不是要求用户切换 Agent。

能力路由：
- 平台管理：用户要管理 Skills、MCP、Providers、Workflows、Agents、Teams、Settings、Sessions 或看板任务时，使用 platform-manager skill 和 mcp__spark_platform__* 工具直接完成。
- 软件开发：用户要分析、实现、修复、重构或验证代码时，先理解仓库约束和现有实现，再完成影响分析、方案设计、编码、测试与交付。
- 能力扩展：需要搜索、浏览器、内容生产、前端设计、调试或其他专业能力时，从可用 Skill 目录按需加载完整说明，不要把所有 Skill 同时展开到上下文。

开发工作原则：
1. 先确认目标、边界和验收标准；简单任务直接执行，复杂或高风险任务先说明影响范围和方案。
2. 修改代码前阅读相关源码、项目规则和测试；遵循现有架构、目录和编码风格，不做无证据的重构。
3. 实现后运行与风险匹配的类型检查、测试或 lint；失败就修复，无法验证时明确说明。
4. 前端和 UI 改动尽量进行真实界面验证；不能实测时不要声称已验证。
5. 涉及删除数据、覆盖配置、生产环境、force push 或其他破坏性操作时，必须先确认。

平台管理原则：
- 不臆造平台状态，先调用查询工具确认现状。
- 用户明确要求创建或更新配置时直接执行；删除和不可逆操作先确认。
- 安装运行时或依赖时优先使用 Spark 自建制品与应用内置运行时，再考虑外部来源。

沟通要求：
- 先给结论或结果，再补充必要细节。
- 需要用户选择时一次问清关键选项，避免反复追问。
- 失败、缺少权限、工具不可用或上下文不足时如实说明，并给出可执行的下一步。',
  skill_ids_json = COALESCE((SELECT json_group_array(value) FROM merged_skills), '[]'),
  rule_ids_json = COALESCE((SELECT json_group_array(value) FROM merged_rules), '[]'),
  disabled_skill_ids_json = COALESCE((SELECT json_group_array(value) FROM merged_disabled_skills), '[]'),
  mcp_server_ids_json = COALESCE((SELECT json_group_array(value) FROM merged_mcp), '[]'),
  provider_profile_id = COALESCE(
    provider_profile_id,
    (SELECT provider_profile_id FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3')
  ),
  model_id = COALESCE(
    model_id,
    (SELECT model_id FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3')
  ),
  workflow_id = COALESCE(
    workflow_id,
    (SELECT workflow_id FROM agents WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3')
  ),
  metadata_json = json_set(
    COALESCE(NULLIF(metadata_json, ''), '{}'),
    '$.role', 'spark-assistant',
    '$.system', json('true'),
    '$.avatar', json_object('kind', 'builtin', 'id', 'platform-manager'),
    '$.mergedFrom', json_array('platform-manager-agent', '93785cf1-d570-4a2a-8919-108fbf7f39c3'),
    '$.mergedFullstackConfig', COALESCE((
      SELECT json_object(
        'prompt', prompt,
        'disabledSkillIds', json(COALESCE(NULLIF(disabled_skill_ids_json, ''), '[]')),
        'hookConfig', json(COALESCE(NULLIF(hook_config_json, ''), '{}')),
        'providerProfileId', provider_profile_id,
        'modelId', model_id,
        'workflowId', workflow_id,
        'metadata', json(COALESCE(NULLIF(metadata_json, ''), '{}'))
      )
      FROM agents
      WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
    ), json('{}'))
  ),
  updated_at = datetime('now')
WHERE id = 'platform-manager-agent';

-- 将所有仍会参与后续执行的直接引用切到稳定 ID。
UPDATE sessions
SET agent_id = 'platform-manager-agent'
WHERE agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE scheduled_tasks
SET agent_id = 'platform-manager-agent'
WHERE agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE agent_teams
SET host_agent_id = 'platform-manager-agent'
WHERE host_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE agent_teams
SET member_agent_ids_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT value
    FROM json_each(REPLACE(
      agent_teams.member_agent_ids_json,
      '93785cf1-d570-4a2a-8919-108fbf7f39c3',
      'platform-manager-agent'
    ))
  )
)
WHERE member_agent_ids_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE team_dispatches
SET host_agent_id = 'platform-manager-agent'
WHERE host_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE team_dispatches
SET member_agent_id = 'platform-manager-agent'
WHERE member_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE team_discussions
SET host_agent_id = 'platform-manager-agent'
WHERE host_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE team_thread_messages
SET sender_agent_id = 'platform-manager-agent'
WHERE sender_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE team_thread_messages
SET target_agent_id = 'platform-manager-agent'
WHERE target_agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE run_usage_summaries
SET agent_id = 'platform-manager-agent'
WHERE agent_id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

UPDATE rules
SET scope_ref = 'platform-manager-agent'
WHERE scope = 'agent' AND scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

-- 同名 Agent 记忆先加稳定后缀，避免切换 scope_ref 时触发唯一索引冲突。
UPDATE memory_entry
SET name = name || '（原全栈编码助手-' || substr(id, -6) || '）'
WHERE scope = 'agent'
  AND scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND EXISTS (
    SELECT 1
    FROM memory_entry AS target
    WHERE target.scope = 'agent'
      AND target.scope_ref = 'platform-manager-agent'
      AND target.name = memory_entry.name
      AND target.archived = 0
      AND target.invalid_at IS NULL
  );

UPDATE memory_entry
SET scope_ref = 'platform-manager-agent'
WHERE scope = 'agent' AND scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

-- 合并重复的记忆实体链接，再删除旧实体，避免实体唯一索引冲突。
INSERT OR IGNORE INTO memory_entity_link (memory_id, entity_id)
SELECT link.memory_id, target.id
FROM memory_entity AS source
JOIN memory_entity AS target
  ON target.scope = 'agent'
 AND target.scope_ref = 'platform-manager-agent'
 AND target.normalized_name = source.normalized_name
JOIN memory_entity_link AS link ON link.entity_id = source.id
WHERE source.scope = 'agent'
  AND source.scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

DELETE FROM memory_entity_link
WHERE entity_id IN (
  SELECT source.id
  FROM memory_entity AS source
  JOIN memory_entity AS target
    ON target.scope = 'agent'
   AND target.scope_ref = 'platform-manager-agent'
   AND target.normalized_name = source.normalized_name
  WHERE source.scope = 'agent'
    AND source.scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
);

DELETE FROM memory_entity
WHERE scope = 'agent'
  AND scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND EXISTS (
    SELECT 1
    FROM memory_entity AS target
    WHERE target.scope = 'agent'
      AND target.scope_ref = 'platform-manager-agent'
      AND target.normalized_name = memory_entity.normalized_name
  );

UPDATE memory_entity
SET scope_ref = 'platform-manager-agent'
WHERE scope = 'agent' AND scope_ref = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

-- JSON 快照和会话团队配置中可能嵌有 Agent ID；精确 UUID 替换不会误伤其他值。
UPDATE sessions
SET metadata_json = REPLACE(
  metadata_json,
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  'platform-manager-agent'
)
WHERE metadata_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE sessions
SET metadata_json = json_set(
  metadata_json,
  '$.team.memberAgentIds',
  json((
    SELECT json_group_array(value)
    FROM (
      SELECT DISTINCT value
      FROM json_each(sessions.metadata_json, '$.team.memberAgentIds')
    )
  ))
)
WHERE json_valid(metadata_json)
  AND json_type(metadata_json, '$.team.memberAgentIds') = 'array';

UPDATE workflows
SET graph_json = REPLACE(
  graph_json,
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  'platform-manager-agent'
)
WHERE graph_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE workflow_runs
SET
  graph_json = REPLACE(graph_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  state_json = REPLACE(state_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  executions_json = REPLACE(executions_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  atomic_executions_json = REPLACE(atomic_executions_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  failed_node_json = REPLACE(failed_node_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent')
WHERE graph_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR state_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR executions_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR atomic_executions_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR failed_node_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE canvas_snapshots
SET snapshot_json = REPLACE(
  snapshot_json,
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  'platform-manager-agent'
)
WHERE snapshot_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE canvas_workflows
SET package_json = REPLACE(
  package_json,
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  'platform-manager-agent'
)
WHERE package_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE canvas_workflow_versions
SET package_json = REPLACE(
  package_json,
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  'platform-manager-agent'
)
WHERE package_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE canvas_workflow_runs
SET
  inputs_json = REPLACE(inputs_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  exposed_params_json = REPLACE(exposed_params_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  outputs_json = REPLACE(outputs_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  error_json = REPLACE(error_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent')
WHERE inputs_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR exposed_params_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR outputs_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR error_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

UPDATE canvas_workflow_run_steps
SET
  depends_on_json = REPLACE(depends_on_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  input_json = REPLACE(input_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  output_json = REPLACE(output_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent'),
  error_json = REPLACE(error_json, '93785cf1-d570-4a2a-8919-108fbf7f39c3', 'platform-manager-agent')
WHERE depends_on_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR input_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR output_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%'
   OR error_json LIKE '%93785cf1-d570-4a2a-8919-108fbf7f39c3%';

-- Agent 级技能层是 JSON 数组；新旧助手同时有配置时做集合合并。
INSERT INTO app_settings (category, key, value, updated_at)
SELECT category, 'agent:platform-manager-agent', value, updated_at
FROM app_settings
WHERE key = 'agent:93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND category IN ('runtime.skills', 'runtime.skills.disabled')
ON CONFLICT(category, key) DO UPDATE SET
  value = (
    SELECT json_group_array(value)
    FROM (
      SELECT value FROM json_each(app_settings.value)
      UNION
      SELECT value FROM json_each(excluded.value)
    )
  ),
  updated_at = datetime('now');

-- Agent 级补充提示词保留两边内容，避免旧全栈助手的用户定制被静默丢弃。
INSERT INTO app_settings (category, key, value, updated_at)
SELECT category, 'agent:platform-manager-agent', value, updated_at
FROM app_settings
WHERE key = 'agent:93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND category = 'runtime.prompts'
ON CONFLICT(category, key) DO UPDATE SET
  value = json_object(
    'enabled', CASE
      WHEN json_extract(app_settings.value, '$.enabled') = 1
        OR json_extract(excluded.value, '$.enabled') = 1
      THEN json('true')
      ELSE json('false')
    END,
    'content', trim(
      COALESCE(json_extract(app_settings.value, '$.content'), '') ||
      CASE
        WHEN trim(COALESCE(json_extract(app_settings.value, '$.content'), '')) <> ''
          AND trim(COALESCE(json_extract(excluded.value, '$.content'), '')) <> ''
        THEN char(10) || char(10) || '[原全栈编码助手补充]' || char(10)
        ELSE ''
      END ||
      COALESCE(json_extract(excluded.value, '$.content'), '')
    )
  ),
  updated_at = datetime('now');

-- 其他未来可能出现的 Agent 级设置仅在目标不存在时搬迁。
INSERT OR IGNORE INTO app_settings (category, key, value, updated_at)
SELECT category, 'agent:platform-manager-agent', value, updated_at
FROM app_settings
WHERE key = 'agent:93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND category NOT IN ('runtime.skills', 'runtime.skills.disabled', 'runtime.prompts');

DELETE FROM app_settings
WHERE key = 'agent:93785cf1-d570-4a2a-8919-108fbf7f39c3';

DELETE FROM agents
WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';
