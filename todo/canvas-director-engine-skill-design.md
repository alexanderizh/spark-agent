# 画布导演引擎 Skill（director-engine）旧方案

> 状态: 已废弃 | 最后核对: 2026-07-14

## 废弃原因

旧方案把 `effectiveSkillIds` / `skill-config:update` 误判为“多个完整 Skill 正文默认注入”链路，并据此计划仅将 `REQUIRED_CANVAS_SKILL_ID` 从单值改为数组。

运行时复核后确认：

- `effectiveSkillIds` 负责会话可用技能目录，不等同于完整 `SKILL.md` 正文已进入 system context。
- 完整 Skill 正文当前仍由 `session:submit-turn.skillId` 单值链路解析并内联。
- 新 builtin Skill 还需要配套 `manifest.json` 显式声明稳定 id；仅新增 `SKILL.md` 可能按 `local:bundled:<hash>` 登记。

因此，旧方案不能满足“画布 Agent 默认同时注入 `canvas-studio` 与 `director-engine` 完整正文”的验收要求，请勿继续按原方案实施。

## 新计划入口

后续统一以 `todo/canvas-creative-engine-upgrade-plan.md` 为准：

- Phase 0：等待 Canvas UIUX V4 样式隔离与旧样式迁移完成后，重新核对源码和影响范围。
- Phase 1：新增 `SKILL.md + manifest.json`，并以向后兼容方式扩展 submit-turn/runtime composition 的多 Skill 正文注入协议。
- 后续 Phase：内置任务 Prompt Contract、提示词决策库、Agent 能力、Take Review、Surface Profile 与 UI 接入。
