# Canvas Agent Capability Orchestration Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布 Agent 动态发现当前节点能力并按照影视推荐流程规划工作，默认优先创建可检查的画布操作节点。

**Architecture:** 在独立纯逻辑模块中聚合现有流水线目录、通用生成菜单和节点状态，向 `canvas.tools.ts` 暴露两个只读工具。Agent 上下文、内置 Prompt 和 Canvas Skill 只负责规定调用顺序，不再手写推断当前节点能力。

**Tech Stack:** TypeScript、React、Vitest、Electron renderer MCP bridge、SQLite migrations

---

### Task 1: 动态节点能力目录

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentCapabilities.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentCapabilities.test.ts`

- [x] 先写失败测试，断言剧本节点包含分镜/角色/场景动作，场景节点包含场景图与全景建议，图片节点包含标注/宫格切分，UI 专属动作带 `requires_user_interaction`。
- [x] 运行 `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasAgentCapabilities.test.ts`，确认因模块缺失失败。
- [x] 实现动作聚合与适用性判断，复用 `getOpsForNode` 和通用生成菜单目录。
- [x] 重跑测试，确认通过。

### Task 2: 影视制作计划器

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentProductionPlan.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentProductionPlan.test.ts`

- [x] 先写失败测试，覆盖空项目、已有剧本待做资产、已有分镜待做关键帧/视频三种状态。
- [x] 运行目标测试，确认因模块缺失失败。
- [x] 实现阶段检查、阻塞项、推荐步骤和标准短剧流程输出。
- [x] 重跑测试，确认通过。

### Task 3: 暴露 Agent 只读工具

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas-tool-host.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.test.ts`

- [x] 先扩展 schema 测试，要求存在 `canvas_get_available_actions` 和 `canvas_get_production_plan`。
- [x] 运行测试并确认失败原因是工具缺失。
- [x] 接入两个新工具，并登记为只读工具。
- [x] 重跑工具测试和新模块测试。

### Task 4: 强化 Agent 上下文与推荐流程

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasAgentContextBuilder.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentContextBuilder.test.ts`
- Modify: `apps/desktop/resources/skills/canvas-studio/SKILL.md`
- Create: `packages/storage/migrations/054_canvas_assistant_capability_orchestration.sql`
- Modify: `packages/storage/src/database.test.ts`

- [x] 先写失败测试，要求节点引用上下文包含 `pipelineRole`、生产状态和动态动作查询提示。
- [x] 先写数据库迁移测试，要求内置画布助手 Prompt 包含动态动作和制作计划工具名。
- [x] 运行目标测试并确认失败。
- [x] 更新上下文、Skill 版本和内置 Prompt 迁移，明确“宽泛任务先计划、节点任务先查动作、默认不立即运行”。
- [x] 运行迁移验证和上下文测试；数据库单测因本机 `better-sqlite3` ABI 125/127 不匹配无法执行，生产构建中的迁移静态校验已通过。

### Task 5: 回归验证

**Files:**
- Verify only

- [x] 运行画布相关定向测试。
- [x] 运行 `pnpm --filter @spark/desktop typecheck`。
- [x] 运行 `pnpm --filter @spark/desktop lint`。
- [x] 运行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @spark/desktop build`。
- [x] 使用 `git diff --check` 和 `git diff --stat` 核对变更范围；GitNexus 不可用时以此替代 detect_changes。
