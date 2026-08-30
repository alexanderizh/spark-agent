-- Migration 021: Long-lived Agent Teams (team definitions)
--
-- 在 agent_teams 表中保存可复用的「长期团队」配置：Host + Members + 嵌套参数
-- + 团队专属提示词。会话仍以 sessions.metadata.team 为权威运行时配置；当会话
-- 从某个长期团队应用而来时，metadata.team.teamId 指向 agent_teams.id。
-- 「临时团队」不在此表，只存在于 session metadata，用户可在 Inspector
-- 一键「保存为长期团队」把它落盘到此表。
--
-- built_in=1 的团队不可删除（仅可编辑配置），与 agents 的策略一致。

CREATE TABLE IF NOT EXISTS agent_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  host_agent_id TEXT NOT NULL,
  member_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  max_depth INTEGER NOT NULL DEFAULT 1,
  allow_nesting INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_teams_enabled_updated
  ON agent_teams(enabled, updated_at);

-- 内置示范团队 1：全栈协作组（开发主导，配合编码 + 测试 + 文档）
INSERT OR IGNORE INTO agent_teams (
  id, name, description, built_in, enabled,
  host_agent_id, member_agent_ids_json, max_depth, allow_nesting,
  prompt, metadata_json
) VALUES (
  'team-fullstack',
  '全栈协作组',
  '由「开发」担任主持，按需调用编码 Agent 实现细节、测试 Agent 把控质量、文档助手沉淀产出；适合一次完整的「设计 → 实现 → 验证 → 文档」闭环。',
  1, 1,
  'dev-agent',
  '["code-agent","qa-agent","docs-agent"]',
  1, 0,
  '本团队的协作守则：\n- 接到用户需求先整理「目标 / 关键约束 / 不做什么」，再决定派工；\n- 实现细节优先派给编码 Agent；功能上线前派给测试 Agent 设计用例并验证；变更落地后派给文档助手沉淀使用说明 / 变更记录；\n- 每位成员各自给出独立答复后，由主持人在最后一句给出「下一步建议」（仅一句，不要复述成员内容）。',
  '{"role":"team","preset":"fullstack","system":true}'
),
-- 内置示范团队 2：产品发布组（产品主导，覆盖发布前后链路）
(
  'team-release',
  '产品发布组',
  '由「产品经理」担任主持，串联开发实现、文档披露、测试回归、运维上线四个角色，适合一次发布前后的串联协作。',
  1, 1,
  'pm-agent',
  '["dev-agent","docs-agent","qa-agent","devops-agent"]',
  1, 0,
  '本团队的协作守则：\n- 用户提需求后，先以「问题 / 用户价值 / 验收标准」三段澄清，再分派任务；\n- 涉及实现 → 派开发；涉及测试覆盖 → 派测试；涉及上线、监控、回滚 → 派运维；涉及对外说明 → 派文档；\n- 各成员独立产出后，主持人仅在以下情况再发声：(a) 用户要求综合多份产出形成发布清单；(b) 跨成员的依赖 / 冲突需要点出；其他情况静默结束 turn。',
  '{"role":"team","preset":"release","system":true}'
);
