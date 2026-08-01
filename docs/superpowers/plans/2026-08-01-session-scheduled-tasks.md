# 会话级计划任务实施计划

> 状态: 实施中 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有统一调度器增加会话作用域，让多个计划任务可以在绑定会话内持久化排队，并随会话删除、归档和恢复。

**Architecture:** 通过 migration 扩展 `scheduled_tasks`，由现有 `ScheduledTaskService` 继续负责所有调度计算。主进程执行器根据 `sessionId` 选择“提交到原会话”或“创建全局任务会话”，渲染端用独立的紧凑浮层管理当前会话任务。

**Tech Stack:** SQLite migrations、TypeScript、Vitest、Electron typed IPC、React 19、Ant Design/Lobe UI、Less。

---

## 文件结构

- 新建 `packages/storage/migrations/065_session_scheduled_tasks.sql`：会话作用域列、外键和索引。
- 修改 `packages/storage/src/repositories/scheduled-task.repository.ts`：字段映射、过滤和归档批量操作。
- 修改 `packages/storage/src/repositories/repositories.test.ts`：按会话查询与删除级联。
- 修改 `packages/protocol/src/ipc/index.ts`：会话任务 IPC 类型。
- 修改 `packages/agent-runtime/src/services/scheduled-task.service.ts`：作用域、启动跳过漏跑、归档恢复、执行分支参数。
- 修改 `packages/agent-runtime/src/services/scheduled-task.service.test.ts`：调度服务 RED/GREEN 行为。
- 修改 `apps/desktop/src/main/ipc/index.ts`：创建/列表字段、会话执行器和归档联动。
- 修改 `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`：跨侧栏与 ChatView 的浮层打开状态。
- 修改 `apps/desktop/src/renderer/design/SidebarSessionList.tsx`：会话菜单入口。
- 修改 `apps/desktop/src/renderer/design/views/chat/ChatTabbar.tsx`：顶栏入口和状态点。
- 新建 `apps/desktop/src/renderer/design/views/chat/SessionSchedulePanel.tsx`：会话任务列表和表单。
- 新建 `apps/desktop/src/renderer/design/views/chat/SessionSchedulePanel.less`：浮层响应式样式。
- 新建 `apps/desktop/src/renderer/design/views/chat/SessionSchedulePanel.test.tsx`：列表和保存交互。
- 修改 `apps/desktop/src/renderer/design/views/ChatView.tsx`：只负责挂载独立浮层，不继续增大会话主文件职责。

### Task 1：数据库和仓储

- [x] **Step 1：先写失败的仓储测试**

在 `repositories.test.ts` 建两个 session 和三个任务，断言：

```ts
expect(repo.listAll({ scope: 'session', sessionId: 'session-a' }).map((row) => row.id)).toEqual([
  'task-a',
])
db.raw.prepare('DELETE FROM sessions WHERE id = ?').run('session-a')
expect(repo.get('task-a')).toBeNull()
expect(repo.get('global-task')).not.toBeNull()
```

- [x] **Step 2：运行 RED**

运行：`pnpm --filter @spark/storage test:unit -- repositories.test.ts`

预期：因 `scope/session_id` 不存在或过滤器不接受字段而失败。

- [x] **Step 3：增加 migration 和仓储字段**

迁移核心内容：

```sql
ALTER TABLE scheduled_tasks ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';
ALTER TABLE scheduled_tasks ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE scheduled_tasks ADD COLUMN paused_by_archive INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_session_id ON scheduled_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_scope_due
  ON scheduled_tasks(scope, enabled, next_run_at);
```

仓储补齐 `create/update/listAll` 映射，并增加：

```ts
pauseEnabledBySession(sessionId: string): number
listArchivePausedBySession(sessionId: string): ScheduledTaskRow[]
markRestoredFromArchive(id: string, nextRunAt: string | null): void
listOverdueSessionTasks(nowSql: string): ScheduledTaskRow[]
```

- [x] **Step 4：运行 GREEN**

运行：`pnpm --filter @spark/storage test:unit -- repositories.test.ts database.test.ts`

预期：相关 storage 测试全部通过。

### Task 2：协议与服务作用域

- [x] **Step 1：先写失败的服务测试**

在 `scheduled-task.service.test.ts` 断言会话字段映射和过滤透传：

```ts
const task = service.createTask(makeCreateParams({ scope: 'session', session_id: 'sess-1' }))
expect(task).toMatchObject({ scope: 'session', sessionId: 'sess-1' })
expect(service.listTasks({ scope: 'session', sessionId: 'sess-1' })).toHaveLength(1)
```

- [x] **Step 2：运行 RED**

运行：`pnpm --filter @spark/agent-runtime test:unit -- scheduled-task.service.test.ts`

预期：新字段和过滤类型不存在。

- [x] **Step 3：扩展协议和服务映射**

协议增加：

```ts
export type ScheduledTaskScope = 'global' | 'session'
// Item: scope, sessionId, pausedByArchive
// List: scope?, sessionId?
// Create: scope?, sessionId?
```

服务 `ScheduledTaskItem` 和 `toTaskItem` 映射相同字段；导出只遍历 `scope=global`。

- [x] **Step 4：运行 GREEN 和类型检查**

运行：

```bash
pnpm --filter @spark/agent-runtime test:unit -- scheduled-task.service.test.ts
pnpm --filter @spark/protocol typecheck
```

预期：测试与协议类型检查通过。

### Task 3：离线漏跑、归档与恢复

- [x] **Step 1：写三个失败测试**

覆盖：

```ts
it('moves overdue session intervals to a future next run without executing')
it('disables an overdue one-time session task on scheduler startup')
it('restores only tasks paused by session archival')
```

测试使用固定系统时间，断言 executor 未调用、全局 overdue 任务未被校正、手动暂停任务未恢复。

- [x] **Step 2：运行 RED**

运行：`pnpm --filter @spark/agent-runtime test:unit -- scheduled-task.service.test.ts`

预期：启动校正和归档方法不存在。

- [x] **Step 3：实现最小服务方法**

```ts
skipMissedSessionRuns(now = new Date()): void
setSessionArchived(sessionId: string, archived: boolean): void
```

`startScheduler()` 在启动 timer 前调用校正。恢复任务逐个调用 `calculateNextRunAt`，计算失败的任务保持禁用并记录错误。

- [x] **Step 4：运行 GREEN**

运行：`pnpm --filter @spark/agent-runtime test:unit -- scheduled-task.service.test.ts`

预期：新增与原有调度测试全部通过。

### Task 4：主进程执行分支和会话生命周期联动

- [x] **Step 1：写失败的执行器/IPC 测试**

提取可测试的执行分支或通过现有 IPC handler 测试断言：

```ts
expect(sessionService.submitTurn).toHaveBeenCalledWith({
  sessionId: 'sess-1',
  message: expect.stringContaining('[Scheduled Task Context]'),
})
expect(sessionService.createSession).not.toHaveBeenCalled()
```

归档测试断言 `session:update archived=true/false` 分别调用调度服务暂停/恢复。

- [x] **Step 2：运行 RED**

运行：`pnpm --filter @spark/desktop test:unit -- ipc-handlers.test.ts`

- [x] **Step 3：实现执行器分支**

`TaskExecutorFn` 增加 `sessionId`。会话任务路径：

```ts
const target = sessionRepo.get(params.sessionId)
if (target == null) throw new Error('Scheduled task session no longer exists')
if (target.archived_at != null) throw new Error('Scheduled task session is archived')
params.onSessionCreated?.(params.sessionId)
const result = await sessionService.submitTurn({
  sessionId: params.sessionId,
  message: params.promptTemplate,
})
return { sessionId: params.sessionId, output: `Turn ${result.turnId} queued` }
```

全局任务路径保持原逻辑。`session:update` 完成后调用 `setSessionArchived`。

- [x] **Step 4：运行 GREEN**

运行 desktop IPC 测试、agent-runtime 调度测试和 typecheck。

### Task 5：会话浮层组件（TDD）

- [x] **Step 1：先写组件失败测试**

测试 mock `window.spark.invoke`，覆盖：

```tsx
expect(invoke).toHaveBeenCalledWith('scheduled-task:list', {
  scope: 'session',
  sessionId: 'sess-1',
})
// 点击新增、填写名称/Prompt、保存
expect(invoke).toHaveBeenCalledWith(
  'scheduled-task:create',
  expect.objectContaining({
    scope: 'session',
    sessionId: 'sess-1',
    triggerType: 'interval',
  }),
)
```

再覆盖启停、立即运行和删除确认。

- [x] **Step 2：运行 RED**

运行：`pnpm --filter @spark/desktop test:unit -- SessionSchedulePanel.test.tsx`

预期：组件不存在。

- [x] **Step 3：实现组件和样式**

组件 props：

```ts
interface SessionSchedulePanelProps {
  open: boolean
  session: SessionSummary
  onClose: () => void
  onEnabledCountChange?: (count: number) => void
}
```

表单只包含会话级字段，不渲染 Agent/模型/工作区选择器。Less 使用现有 CSS 变量，桌面宽 400px，`max-width: 680px` 时覆盖内容区宽度。

- [x] **Step 4：运行 GREEN**

运行组件测试和 desktop typecheck。

### Task 6：两处入口和共享打开状态

- [x] **Step 1：写失败的入口测试**

侧栏测试断言菜单出现“计划任务”并触发 `openSessionSchedule(session.id)`；新增 `ChatTabbar` 测试断言时钟按钮切换浮层。

- [x] **Step 2：运行 RED**

运行：

```bash
pnpm --filter @spark/desktop test:unit -- SidebarSessionList.test.tsx ChatTabbar.test.tsx
```

- [x] **Step 3：实现入口**

`SessionSidebarContext` 增加：

```ts
sessionScheduleTargetId: SessionId | null
openSessionSchedule(sessionId: SessionId): void
closeSessionSchedule(): void
```

侧栏入口先激活目标会话再打开；`ChatView` 只导入并挂载新组件。`ChatTabbar` 增加 Clock 按钮和启用状态点，不向 7000+ 行的 `ChatView.tsx` 内新增表单实现。

- [x] **Step 4：运行 GREEN**

运行入口测试、组件测试和 desktop typecheck。

### Task 7：回归、文档状态和索引

- [x] **Step 1：运行定向测试**

```bash
pnpm --filter @spark/storage test:unit -- repositories.test.ts database.test.ts
pnpm --filter @spark/agent-runtime test:unit -- scheduled-task.service.test.ts
pnpm --filter @spark/desktop test:unit -- SessionSchedulePanel.test.tsx SidebarSessionList.test.tsx ChatTabbar.test.tsx
```

- [x] **Step 2：运行完整静态验证**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- [x] **Step 3：核对变更范围**

运行 `git diff --check`、`git status --short`、`git diff --stat` 和相关调用点 `rg`；确认全局任务导入导出、创建新会话和调度行为没有被会话分支改变。

- [x] **Step 4：刷新文档状态**

验证完成后把设计与计划文档状态更新为：

```text
> 状态: 已落地 | 最后核对: 2026-08-01
```

- [x] **Step 5：刷新 GitNexus 索引**

运行：`npx gitnexus analyze`

若 CLI 因数据库版本或环境问题失败，按项目降级规则记录原因，不阻塞交付。

本次不自动创建 Git commit，保留工作区变更供用户审阅。

### Task 8：修复深浅主题和空状态层级

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/SessionSchedulePanel.less`
- Modify: `apps/desktop/src/renderer/design/views/chat/SessionSchedulePanel.test.tsx`

- [ ] **Step 1：写失败的主题 token 回归测试**

读取 Less 文件并断言使用应用原生 token：

```ts
expect(styles).toContain('--schedule-panel: var(--panel)')
expect(styles).toContain('--schedule-text: var(--text)')
expect(styles).not.toContain('--color-bg-container')
expect(styles).not.toContain('--color-text-')
```

- [ ] **Step 2：运行 RED**

运行：

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/SessionSchedulePanel.test.tsx
```

预期：现有 Less 仍引用 `--color-bg-container` 和 `--color-text-*`，测试失败。

- [ ] **Step 3：替换主题 token 并重整视觉层级**

在 `.session-schedule-panel` 内建立局部语义变量，映射到 `--panel`、`--text`、`--border-strong`、`--primary` 等应用 token。面板、卡片、表单、空状态和按钮均从这些局部变量取色；空状态缩小高度并移除大面积虚线边框。

- [ ] **Step 4：运行 GREEN 与视觉验收**

运行组件测试和 Desktop 构建，并分别在 `html[data-theme='light']`、`html[data-theme='dark']` 下打开列表态与表单态，确认文字对比、边框、焦点环和遮罩清晰。

## 实施结果

- Storage 全量测试：20 个文件、231 个测试通过。
- 会话计划任务服务测试：10 个测试通过；桌面相关测试：6 个文件、29 个测试通过。
- Storage、Protocol、Agent Runtime、Desktop 类型检查通过；migration 65 静态校验和完整构建通过。
- 变更文件 ESLint 为 0 error；仓库全量 lint 仍受未改动的 `packages/protocol/src/media-config.ts` 既有 `no-fallthrough` 错误阻塞。
- 仓库全量测试中的既有 Canvas/Renderer 快照断言及附件快照测试仍失败；本功能相关套件均通过，失败文件不在本功能改动范围。
