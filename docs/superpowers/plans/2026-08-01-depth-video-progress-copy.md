# 深度视频进度阶段文案实施计划

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让无限画布深度视频节点的运行文案明确区分资源下载与任务执行。

**Architecture:** 保持现有 IPC 进度事件、百分比映射和渲染逻辑不变，只在深度视频任务的消息生产端增加阶段前缀。扩展现有 IPC 单元测试，验证下载、解析、深度推理和编码四个阶段的完整消息。

**Tech Stack:** TypeScript、Electron IPC、Vitest

---

### Task 1: 区分下载与执行阶段文案

**Files:**
- Modify: `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.test.ts`
- Modify: `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts`
- Modify: `docs/superpowers/plans/2026-08-01-depth-video-progress-copy.md`

- [x] **Step 1: 写入失败测试**

让 runner 依次上报 `decoding`、`estimating_depth` 和 `encoding`，然后按阶段断言消息：

```ts
const runningMessages = Object.fromEntries(
  harness.events
    .filter((event) => event.payload.response.status === 'running')
    .map((event) => [event.payload.response.stage, event.payload.response.message]),
)
expect(runningMessages).toMatchObject({
  installing_model: '资源下载中：正在下载本地深度模型',
  decoding: '任务执行中：正在解析输入视频',
  estimating_depth: '任务执行中：正在逐帧生成深度',
  encoding: '任务执行中：正在编码深度视频',
})
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/ipc/registerCanvasDepthTaskIpc.test.ts`

Expected: FAIL，差异显示当前消息缺少“资源下载中：”或“任务执行中：”前缀。

- [x] **Step 3: 最小化修改生产文案**

下载回调使用：

```ts
message: '资源下载中：正在下载本地深度模型'
```

阶段映射使用：

```ts
function depthStageMessage(stage: DepthVideoProgress['stage']): string {
  if (stage === 'decoding') return '任务执行中：正在解析输入视频'
  if (stage === 'encoding') return '任务执行中：正在编码深度视频'
  return '任务执行中：正在逐帧生成深度'
}
```

- [x] **Step 4: 运行定向测试并确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/ipc/registerCanvasDepthTaskIpc.test.ts`

Expected: PASS，测试文件全部用例通过。

- [x] **Step 5: 运行静态检查与变更审查**

Run: `pnpm --filter @spark/desktop exec eslint src/main/ipc/registerCanvasDepthTaskIpc.ts src/main/ipc/registerCanvasDepthTaskIpc.test.ts`

Expected: PASS，无 lint 错误。

Run: `git diff --check && git diff --stat && git status --short`

Expected: 无空白错误，变更仅包含计划文档、IPC 实现和对应测试。

- [x] **Step 6: 更新计划状态并提交**

将本文档状态更新为 `已落地`，勾选全部步骤，然后提交：

```bash
git add apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts \
  apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.test.ts \
  docs/superpowers/plans/2026-08-01-depth-video-progress-copy.md
git commit -m "fix(canvas): distinguish depth task progress phases"
```
