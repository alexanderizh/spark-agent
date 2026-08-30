-- Migration 037: 给内置「全栈编码 Agent」挂载全部平台内置技能
--
-- 028 当初 seed 这个 Agent 时 skill_ids_json 是空的，导致安装后该 Agent 没有任何内置技能。
-- 本 migration 给已跑过 028 的老库做回填：把当前 apps/desktop/resources/skills 下全部
-- 14 个内置技能挂到该 Agent 上。
--
-- 约定（与 028 保持一致）：
--  - 仅当当前 skill_ids_json 为空（NULL / '' / '[]' / 数组长度为 0）时才写入，
--    不覆盖用户在 AgentsView 里已经二次定制过的技能列表；
--  - 新装库直接由 028 的 INSERT 写入全量列表，本 migration 命中 WHERE 条件不成立，是 no-op。

UPDATE agents
SET skill_ids_json = '["builtin:browser-use","builtin:canvas-studio","builtin:claude-api","builtin:commit","builtin:echarts","builtin:find-skills","builtin:frontend-design","builtin:multi-search-engine","builtin:platform-manager","builtin:react","builtin:skill-creator","builtin:spark-debug","builtin:spark-web-tool","builtin:ui-ux-pro-max"]'
WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND (
    skill_ids_json IS NULL
    OR skill_ids_json = ''
    OR skill_ids_json = '[]'
    OR json_array_length(COALESCE(NULLIF(skill_ids_json, ''), '[]')) = 0
  );
