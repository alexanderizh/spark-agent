-- Migration 041: 给内置「全栈开发标准流程」补齐节点提示词
--
-- 028 当初 seed 这个 workflow 时，6 个 kind:"agent" 节点的 config 全是空对象 {}——
-- 节点本身不承载任何指引，纯粹是装饰性的阶段占位符。
--
-- 修复方式（与 023 号迁移「简化内置 Agent」的方向保持一致，见讨论）：
--  - 不引入专家分工 Agent、不把节点改成 kind:"subagent" 做真派发——
--    维持「全栈编码 Agent」一人走完全部 6 个阶段」的设计；
--  - 只给每个节点补上 role + prompt，让 guided 模式下拼进系统提示词的
--    [Workflow Execution Plan] 真正带上每阶段的具体指引，而不是空壳。
--
-- 幂等策略：只有当 graph_json 仍然和 028 当初写入的原始值完全一致（即用户从未在
-- WorkflowView 里编辑过这个内置工作流，哪怕只是拖动过节点位置）时才替换；
-- 一旦不一致，说明用户已经二次定制过，跳过、不覆盖。新装库 028→041 在同一批迁移里
-- 连续执行，041 命中的就是 028 刚写入的原始值，正常生效。

UPDATE workflows
SET graph_json = '{"nodes":[{"id":"n1","kind":"agent","title":"需求理解","x":-515,"y":-348,"config":{"role":"需求分析","prompt":"用自己的话复述用户目标与验收标准；边界或需求不清楚时用 AskUserQuestion 一次性问清，不要挤牙膏式反复追问。"}},{"id":"n2","kind":"agent","title":"影响分析","x":-241,"y":-239,"config":{"role":"影响评估","prompt":"定位改动会涉及的文件/模块，评估上下游依赖；识别 HIGH/CRITICAL 风险时显式告知用户，必要时暂停等待确认。"}},{"id":"n3","kind":"agent","title":"方案设计","x":29,"y":-118,"config":{"role":"方案设计","prompt":"给出推荐方案，复杂或有争议的改动用 EnterPlanMode 走完整评审；简单改动直接说明思路即可，不要为小改动走重流程。"}},{"id":"n4","kind":"agent","title":"编码实现","x":300,"y":-15,"config":{"role":"编码实现","prompt":"遵循目标仓库现状的约定与风格；优先编辑已有文件而非新建；不引入未被要求的抽象，不写解释 WHAT 的注释。"}},{"id":"n5","kind":"agent","title":"测试修复","x":572,"y":95,"config":{"role":"测试与修复","prompt":"跑类型检查/单测/lint；失败就回到编码实现步骤修复，不跳过、不糊弄、不假装通过。"}},{"id":"n6","kind":"agent","title":"验证交付","x":856,"y":194,"config":{"role":"验证交付","prompt":"交付前复核改动范围与影响面；前端/UI 改动尽量在浏览器里实测；无法实测时明确告知用户，不谎报\"已验证\"。"}}],"edges":[{"id":"n1-n2","from":"n1","to":"n2"},{"id":"n2-n3","from":"n2","to":"n3"},{"id":"n3-n4","from":"n3","to":"n4"},{"id":"n4-n5","from":"n4","to":"n5"},{"id":"n5-n6","from":"n5","to":"n6"}]}'
WHERE id = 'f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c'
  AND graph_json = '{"nodes":[{"id":"n1","kind":"agent","title":"需求理解","x":-515,"y":-348,"config":{}},{"id":"n2","kind":"agent","title":"影响分析","x":-241,"y":-239,"config":{}},{"id":"n3","kind":"agent","title":"方案设计","x":29,"y":-118,"config":{}},{"id":"n4","kind":"agent","title":"编码实现","x":300,"y":-15,"config":{}},{"id":"n5","kind":"agent","title":"测试修复","x":572,"y":95,"config":{}},{"id":"n6","kind":"agent","title":"验证交付","x":856,"y":194,"config":{}}],"edges":[{"id":"n1-n2","from":"n1","to":"n2"},{"id":"n2-n3","from":"n2","to":"n3"},{"id":"n3-n4","from":"n3","to":"n4"},{"id":"n4-n5","from":"n4","to":"n5"},{"id":"n5-n6","from":"n5","to":"n6"}]}';
