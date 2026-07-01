-- Migration 028: Seed built-in 全栈编码 Agent + 全栈开发标准流程 workflow
--
-- 把"全栈编码 Agent"和"全栈开发标准流程"工作流作为安装包内置内容，
-- 让用户安装后无需手动创建即可使用；工作流不默认绑定到 Agent 上，由用户自行在
-- AgentsView 里按需绑定。
--
-- 实现策略：
--  - 使用稳定 ID + INSERT OR IGNORE，幂等可重复执行；
--  - 默认挂载全部 14 个平台内置技能（browser-use / canvas-studio / claude-api / commit /
--    echarts / find-skills / frontend-design / multi-search-engine / platform-manager /
--    react / skill-creator / spark-debug / spark-web-tool / ui-ux-pro-max）；
--  - 不覆盖用户已修改的 prompt / skill 配置（用户可在 AgentsView 里二次修改）；
--  - 不抢占 platform-manager-agent 的 is_default 状态；
--  - workflow 用 scope='system'、status='active' 出厂，保证在 Workflows 视图中可见，
--    但不写入 agent.workflow_id，避免默认绑定；
--  - 头像不写入硬编码 base64，让运行时根据名称生成默认头像。

-- 1) 先插入工作流（仅作为内置工作流出厂，agent.workflow_id 默认不引用它，见下方 2)）
INSERT OR IGNORE INTO workflows (
  id, scope, name, version, graph_json,
  description, status, tags_json, enabled,
  created_at, updated_at
) VALUES (
  'f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c',
  'system',
  '全栈开发标准流程',
  '1.0.0',
  '{"nodes":[{"id":"n1","kind":"agent","title":"需求理解","x":-515,"y":-348,"config":{}},{"id":"n2","kind":"agent","title":"影响分析","x":-241,"y":-239,"config":{}},{"id":"n3","kind":"agent","title":"方案设计","x":29,"y":-118,"config":{}},{"id":"n4","kind":"agent","title":"编码实现","x":300,"y":-15,"config":{}},{"id":"n5","kind":"agent","title":"测试修复","x":572,"y":95,"config":{}},{"id":"n6","kind":"agent","title":"验证交付","x":856,"y":194,"config":{}}],"edges":[{"id":"n1-n2","from":"n1","to":"n2"},{"id":"n2-n3","from":"n2","to":"n3"},{"id":"n3-n4","from":"n3","to":"n4"},{"id":"n4-n5","from":"n4","to":"n5"},{"id":"n5-n6","from":"n5","to":"n6"}]}',
  '通用全栈编码 Agent 默认执行流程：需求理解 → 影响分析 → 方案设计 → 编码实现 → 测试修复 → 验证交付',
  'active',
  '["coding","fullstack","sdlc"]',
  1,
  datetime('now'),
  datetime('now')
);

-- 2) 再插入 Agent，不默认绑定上面的内置工作流（workflow_id 留空，由用户自行绑定）
INSERT OR IGNORE INTO agents (
  id, name, description, built_in, enabled, is_default,
  agent_adapter, permission_mode, reasoning_effort,
  prompt, skill_ids_json, mcp_server_ids_json, rule_ids_json,
  hook_config_json, workflow_id, metadata_json
) VALUES (
  '93785cf1-d570-4a2a-8919-108fbf7f39c3',
  '全栈编码 Agent',
  '通用全栈编码 Agent。覆盖需求理解、影响分析、方案设计、编码实现、测试与交付全流程，不绑定特定技术栈，运行时遵循当前项目的约定与规则。',
  1, 1, 0,
  'claude-sdk', 'claude-auto-edits', 'high',
  '## 工作流程
1. **需求理解**：用自己的话复述用户目标与边界；模糊处用 AskUserQuestion 一次性问清，不挤牙膏。
2. **影响分析**：改动前评估影响范围与上下游依赖，识别 HIGH/CRITICAL 风险并显式提示用户、必要时暂停。
3. **方案设计**：给出推荐方案 + 1~2 个替代选项与权衡，让用户拍板；复杂改动走 EnterPlanMode。
4. **编码实现**：遵循目标仓库的现有约定与风格（样式系统、组件库、目录结构等以仓库现状为准）；优先编辑现有文件，不创建非必要新文件；不写无谓注释；不引入未被要求的抽象。
5. **测试修复**：跑类型检查/单测/lint，失败回到实现步骤，不糊弄。
6. **验证交付**：交付前复核改动范围与影响面；前端/UI 改动尽量在浏览器实测；不能实测就明说，不谎报"已验证"。

## 行为准则
- **安全**：不跑可能损坏系统/删数据/泄露密钥的命令；高风险操作（删除、force push、改 CI）先确认。
- **Git**：不 `--no-verify`，不 `--amend` 已发布提交，不 force push 到 master。
- **诚实**：失败就报失败，不谎报进度。
- **简洁**：回复短而有信息密度；不写多段总结；不在代码里写解释 WHAT 的注释。

## 何时拒绝/上报
- 仓库外的破坏性操作，先停下问用户。',
  '["builtin:browser-use","builtin:canvas-studio","builtin:claude-api","builtin:commit","builtin:echarts","builtin:find-skills","builtin:frontend-design","builtin:multi-search-engine","builtin:platform-manager","builtin:react","builtin:skill-creator","builtin:spark-debug","builtin:spark-web-tool","builtin:ui-ux-pro-max"]',
  '[]',
  '[]',
  '{"enabled":false,"nodes":{"permission_request":{"sound":true,"notification":true},"ask_user_question":{"sound":true,"notification":true},"session_end":{"sound":true,"notification":true},"session_fail":{"sound":true,"notification":true}}}',
  NULL,
  '{"role":"fullstack-coder","system":true}'
);

-- 3) 兼容已运行过旧版本（agent 已存在但 built_in=0）的开发库：把它升格为内置，
--    但保留用户对 prompt / skills / MCP / workflow_id 等的二次修改（不强制绑定工作流）。
UPDATE agents
SET
  built_in = 1,
  metadata_json = json_set(
    COALESCE(NULLIF(metadata_json, ''), '{}'),
    '$.role', 'fullstack-coder',
    '$.system', json('true')
  )
WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3';

-- 4) 同上：兼容已存在的旧工作流，确保 scope/status 正确，让它出现在 Workflows 视图中。
UPDATE workflows
SET
  scope = 'system',
  status = CASE WHEN status = 'archived' THEN 'active' ELSE status END,
  enabled = 1
WHERE id = 'f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c';
