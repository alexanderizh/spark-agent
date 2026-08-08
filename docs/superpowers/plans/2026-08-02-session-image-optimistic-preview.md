# 工作台会话消息即时回显与图片预览 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-08

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户发送普通消息或带附件的消息后立即显示用户气泡与执行状态；后台真实 `user_message` 事件到达后按 `turnId` 去重接管，排队消息显示队列状态，提交失败保留气泡并显示错误与重试入口。图片消息继续在后台压缩，且优先复用已生成的本地预览。

**Architecture:** Composer 在准备附件和发送请求前发布 renderer-only 乐观用户消息，先显示 `submitting`；发送接口返回后用 `turnId` 标记为 `accepted` 或 `queued`。提交异常转为 `failed`，不撤回消息，保留错误详情与现有重试/重发入口。独立的乐观消息模块按 `sessionId` 隔离记录，ChatStream 将尚未被真实 `user_message` 确认的记录追加到显示列表；真实事件按 `turnId` 到达后接管显示并清理乐观记录。队列快照同步所有状态，显式移除/编辑仅在后端确认取消后移除对应气泡；团队模式的 `mentionAgentId` 同步保留在乐观消息中。

**Tech Stack:** React 19、TypeScript、Electron typed IPC、Vitest；不新增依赖。

---

## 文件结构

- Create `apps/desktop/src/renderer/design/views/chat/optimistic-user-messages.ts`：乐观消息数据结构、发送生命周期、提交/排队/失败/取消状态及与真实消息的纯函数对账。
- Create `apps/desktop/src/renderer/design/views/chat/optimistic-user-messages.test.ts`：普通文本即时显示、会话隔离、`turnId` 接管、队列同步、失败保留与显式取消测试。
- Create `apps/desktop/src/renderer/design/views/chat/message-image-preview.ts`：选择即时预览 URL 并判断是否需要预览 IPC。
- Create `apps/desktop/src/renderer/design/views/chat/message-image-preview.test.ts`：原图预览优先级和本地路径回退测试。
- Modify `apps/desktop/src/renderer/design/views/chat/ChatComposerTypes.ts`：消息附件增加 renderer-only 的可选预览字段。
- Modify `apps/desktop/src/renderer/design/services/event-mapper.ts`：UI 消息附件类型允许 renderer-only 预览字段。
- Modify `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`：在普通消息和转发命令的 Agent 提交路径调用乐观消息生命周期回调，并同步队列快照与显式取消。
- Modify `apps/desktop/src/renderer/design/views/ChatView.tsx`：持有共享乐观状态，接入主会话、侧聊和 ChatStream 显示对账，同时渲染发送/排队/失败状态。
- Modify `docs/superpowers/specs/2026-08-01-session-image-compression-design.md`：记录即时预览架构、失败回退和验收项。

### Task 1: 用纯函数定义乐观消息对账

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/optimistic-user-messages.test.ts`
- Create: `apps/desktop/src/renderer/design/views/chat/optimistic-user-messages.ts`

- [x] **Step 1: 写失败测试**

覆盖创建时保留 `previewUrl`、提交后写入 `turnId`、真实消息同 `turnId` 时隐藏、不同会话隔离、撤销删除、多个待发送记录保持创建顺序。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/optimistic-user-messages.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 实现最小状态转换函数**

定义 `OptimisticUserMessage`、`beginOptimisticUserMessage`、`commitOptimisticUserMessage`、`cancelOptimisticUserMessage` 和 `mergeOptimisticUserMessages`。合并时只追加目标会话中尚无相同 `turnId` 真实用户消息的记录，不修改事件构建器中的持久化消息数组。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/optimistic-user-messages.test.ts`

Expected: PASS。

### Task 2: 用测试定义图片预览优先级

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/message-image-preview.test.ts`
- Create: `apps/desktop/src/renderer/design/views/chat/message-image-preview.ts`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatComposerTypes.ts`
- Modify: `apps/desktop/src/renderer/design/services/event-mapper.ts`

- [x] **Step 1: 写失败测试**

断言 `previewUrl` 优先于 `previewPath` 和发送路径；已有 URL 时 `needsPreparedPreview=false`；没有预览字段的普通本地路径仍请求 `file:prepare-image-preview`。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/message-image-preview.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 实现预览解析并扩展 renderer 类型**

`MessageAttachment` 和 `UIMessage.attachments` 增加 `previewUrl?: string`、`previewPath?: string`；预览解析返回 `{ initialSrc, sourcePath, needsPreparedPreview }`，组件仅在确有必要时调用预览 IPC。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/message-image-preview.test.ts`

Expected: PASS。

### Task 3: 接入 Composer 与 ChatStream

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [x] **Step 1: 添加乐观消息生命周期回调**

Composer 在目标 `sessionId` 已确定且图片附件非空时同步调用 begin；`sendTurn` 返回后用 `res.turnId` commit；任何后续异常都 cancel。回调携带原始 Composer 附件，压缩后的附件只传入 `sendTurn`。

- [x] **Step 2: 在 ChatView 持有并分发乐观状态**

主会话与侧聊 Composer 共用 hook 动作；两个 ChatStream 各自只合并与自身 `sessionId` 一致的乐观消息。真实事件按 `turnId` 到达后由合并函数抑制对应记录。

- [x] **Step 3: 让图片组件优先即时预览**

`UserMessageImageAttachment` 使用 Task 2 的解析函数初始化与响应附件变化；已有 `previewUrl` 时不调用预览准备 IPC。

- [x] **Step 4: 运行目标测试与类型检查**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/optimistic-user-messages.test.ts src/renderer/design/views/chat/message-image-preview.test.ts src/renderer/design/services/session-image-attachments.test.ts`

Expected: PASS。

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

### Task 4: 回归、审查与交付

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-session-image-compression-design.md`
- Modify: `docs/superpowers/plans/2026-08-02-session-image-optimistic-preview.md`

- [x] **Step 1: 运行 Composer、ChatStream 和压缩回归测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/optimistic-user-messages.test.ts src/renderer/design/views/chat/message-image-preview.test.ts src/renderer/design/services/session-image-attachments.test.ts src/main/services/SessionImageOptimizer.test.ts src/renderer/tests/composer-drag-drop.test.ts`

Expected: PASS。

- [x] **Step 2: 运行静态检查和生产构建**

Run: `pnpm --filter @spark/desktop typecheck && pnpm --filter @spark/desktop lint && pnpm --filter @spark/desktop build`

Expected: 全部退出码 0。

- [x] **Step 3: 执行五维与前端专项审查**

按正确性、可读性、架构、安全和性能检查任务 diff，特别核对竞态、重复气泡、对象 URL 生命周期、额外重渲染和发送失败恢复；修复所有 Critical/Important 问题后重跑验证。

- [x] **Step 4: 更新文档与索引**

把设计和计划状态改为 `已落地`、刷新日期，运行 `npx gitnexus analyze`；若工具不可用，记录降级并以 `rg` 调用点、测试和 `git diff` 完成范围核对。

## 扩展：普通消息即时回显与队列状态

### 状态语义

- `submitting`：用户已按下发送，附件准备或 `session:submit-turn` 尚未返回；显示“正在提交…”和执行中占位。
- `accepted`：后端已接单并返回 `turnId`；等待真实事件时继续显示执行中占位。
- `queued`：后端返回 `started: false`，或权威队列快照确认该 `turnId` 在队列中；显示“已加入队列”，不把排队误报为当前执行。
- `failed`：提交链路异常；保留用户气泡、错误详情和重试入口，不自动撤回。

### 场景兼容性

- 团队模式：乐观消息携带与实际请求一致的 `mentionAgentId`，等待占位显示被 @ 的成员，真实事件仍按 `turnId` 去重。
- 多任务队列：队列快照只更新同会话中匹配的乐观消息；移除/编辑在后端确认 `cancelled` 后才移除气泡，立即执行会将队列状态转为执行状态。
- 侧聊：与主会话共享生命周期，但按 `sessionId` 过滤，因此不会串消息或串队列状态。
- Slash 命令：服务端直接处理的命令仍由已有事件流渲染，转发给 Agent 的命令复用普通消息生命周期。
