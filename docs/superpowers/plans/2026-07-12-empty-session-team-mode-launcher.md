# Empty Session Team Mode Launcher Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在空会话左上角增加精修的“单 Agent / 团队”启动模式栏，并让团队选择、无团队引导和底部 Agent 显隐复用现有会话级团队逻辑。

**Architecture:** 新增独立 `EmptySessionModeLauncher` 负责团队列表加载、分段控件和团队选择 UI；`ComposerV2` 继续持有模式切换与运行时同步行为，只把已有回调传给启动栏。团队管理导航通过独立事件常量打开 Agents 视图的 Teams Tab，避免组件直接依赖全局导航内部结构。

**Tech Stack:** React 19、TypeScript、Less、Lobe UI/antd Dropdown、Vitest、GitNexus。

---

### Task 1: 团队启动选择规则

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/emptySessionTeamMode.ts`
- Test: `apps/desktop/src/renderer/design/views/chat/emptySessionTeamMode.test.ts`

- [x] **Step 1: 写失败测试**

覆盖最近团队有效时优先、失效时回退首个启用团队、无团队返回 `null`。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/emptySessionTeamMode.test.ts`

- [x] **Step 3: 实现纯函数**

导出 `selectInitialTeam(teams, preferredTeamId)`，只选择 `enabled !== false` 且 Host 可用的团队候选。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/emptySessionTeamMode.test.ts`

### Task 2: 空会话启动模式组件

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/EmptySessionModeLauncher.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/EmptySessionModeLauncher.less`
- Test: `apps/desktop/src/renderer/design/views/chat/EmptySessionModeLauncher.test.tsx`

- [x] **Step 1: 写组件行为测试**

验证单 Agent 默认态、团队态显示选择器、无团队显示创建入口、团队切换回调、加载失败可重试。

- [x] **Step 2: 实现精修 UI**

使用 `role="radiogroup"` 的双段控件；团队态用 antd Dropdown 承载团队列表并启用视口自动纠偏。无团队时显示“创建第一个团队”，窄窗口通过 CSS 隐藏外部管理入口。

- [x] **Step 3: 运行组件测试**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/EmptySessionModeLauncher.test.tsx`

### Task 3: 团队管理导航

**Files:**

- Create: `apps/desktop/src/renderer/design/teamNavigation.ts`
- Modify: `apps/desktop/src/renderer/design/views/AgentsView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [x] **Step 1: 增加 Teams Tab 目标事件**

定义事件名和 storage key；`AgentsView` 初始化及事件监听时切换至 `teams` Tab。

- [x] **Step 2: 增加 ChatView 导航回调**

先写入目标 Tab，再切换到 `agents` 视图，保证 AgentsView 挂载后直接展示团队管理。

- [x] **Step 3: 验证导航测试或类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

### Task 4: 接入 Composer 并调整 Agent 显隐

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [x] **Step 1: 在空会话渲染启动栏**

仅当 `isNewSessionComposer` 为真时渲染；历史会话和已有消息会话不显示。

- [x] **Step 2: 复用现有切换回调**

团队开启、关闭、应用团队均调用当前 `onChangeTeamConfig` 与 `applyAgentRuntime` 链路，不复制持久化逻辑。

- [x] **Step 3: 调整底部 Agent 选择器**

空会话团队模式隐藏 AgentPicker；单 Agent 模式显示。非空会话保持现状，避免历史界面变化。

- [x] **Step 4: 无团队时阻止发送**

团队模式但未选中有效 `teamId` 时，发送按钮不可用并展示就地原因；切回单 Agent 后立即恢复。

### Task 5: 文档、回归与索引

**Files:**

- Modify: `docs/superpowers/specs/2026-07-12-empty-session-team-mode-launcher-design.md`
- Modify: `docs/agents-workflows.md`

- [x] **Step 1: 更新设计状态与用户文档**

实现完成后将设计文档更新为 `已落地`，刷新日期，并将团队模式入口说明从 Agent 菜单更新为空会话启动栏。

- [x] **Step 2: 运行目标测试和构建**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/emptySessionTeamMode.test.ts src/renderer/design/views/chat/EmptySessionModeLauncher.test.tsx`

Run: `pnpm --filter @spark/desktop build`

- [x] **Step 3: 运行 GitNexus 变更检测和更新索引**

Run: `node .gitnexus/run.cjs detect-changes --scope unstaged`

Run: `node .gitnexus/run.cjs analyze`
