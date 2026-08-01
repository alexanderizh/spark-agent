# 工作台会话大图自适应压缩 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对工作台会话中超过 4 MiB 的图片做限时自适应压缩，并在任何错误或超时时记录日志、回退原图且继续发送。

**Architecture:** 在主进程新增独立 `SessionImageOptimizer`，用 Sharp 完成元数据读取、三轮编码、并发/总时长预算和临时缓存；通过批量 typed IPC 暴露给 Composer。Renderer 在发送前调用纯函数辅助层替换本轮图片路径，IPC 或单图处理失败时保留原始附件。

**Tech Stack:** Electron main process、TypeScript、Sharp 0.35.3、typed IPC/Zod、React Composer、Vitest。

---

## 文件结构

- Create `apps/desktop/src/main/services/SessionImageOptimizer.ts`：压缩策略、并发与超时、缓存、日志和清理。
- Create `apps/desktop/src/main/services/SessionImageOptimizer.test.ts`：阈值、格式、错误回退、超时、并发及原图不变测试。
- Create `apps/desktop/src/main/ipc/registerSessionImageOptimizerIpc.ts`：批量 IPC 注册与服务装配。
- Modify `apps/desktop/src/main/ipc/index.ts`：在统一入口注册新 IPC。
- Modify `packages/protocol/src/ipc/index.ts`：请求、响应和 channel 类型。
- Modify `packages/protocol/src/schemas/index.ts`：请求 schema 与 registry。
- Create `apps/desktop/src/renderer/design/services/session-image-attachments.ts`：附件替换及聚合统计纯函数。
- Create `apps/desktop/src/renderer/design/services/session-image-attachments.test.ts`：成功、部分回退和 IPC 整体失败测试。
- Modify `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`：发送前调用优化 IPC并显示聚合提示。
- Modify `apps/desktop/package.json`、`pnpm-lock.yaml`：把已传递存在的 Sharp 声明为直接依赖。
- Modify `docs/superpowers/specs/2026-08-01-session-image-compression-design.md`：落地后更新状态与最终实现差异。

### Task 1: 建立协议契约

**Files:**

- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`

- [ ] **Step 1: 添加请求与响应类型**

在 `FilePrepareImagePreviewResponse` 后定义：

```ts
export type SessionImageOptimizationStatus = 'original' | 'optimized' | 'fallback'
export type SessionImageOptimizationReason =
  | 'below_threshold'
  | 'animated'
  | 'unsupported'
  | 'timeout'
  | 'decode_error'
  | 'encode_error'
  | 'write_error'
  | 'batch_timeout'

export interface FilePrepareSessionImagesRequest {
  sourcePaths: string[]
}

export interface SessionImageOptimizationResult {
  sourcePath: string
  outputPath: string
  status: SessionImageOptimizationStatus
  inputBytes: number
  outputBytes: number
  durationMs: number
  reason?: SessionImageOptimizationReason
}

export interface FilePrepareSessionImagesResponse {
  results: SessionImageOptimizationResult[]
}
```

- [ ] **Step 2: 添加 schema 与 channel map**

```ts
export const FilePrepareSessionImagesRequestSchema = z.object({
  sourcePaths: z.array(z.string().min(1).max(4000)).max(20),
})
```

把 `'file:prepare-session-images'` 加到 `IpcSchemaRegistry` 和 `IpcChannelMap`。

- [ ] **Step 3: 运行协议类型检查**

Run: `pnpm --filter @spark/protocol typecheck`

Expected: PASS，无 TypeScript 错误。

### Task 2: 用测试定义压缩服务行为

**Files:**

- Create: `apps/desktop/src/main/services/SessionImageOptimizer.test.ts`
- Create: `apps/desktop/src/main/services/SessionImageOptimizer.ts`

- [ ] **Step 1: 写失败测试与依赖接口**

测试通过依赖注入替换时钟、文件系统、日志和 Sharp factory，至少覆盖：

```ts
it('returns the original path without loading Sharp at or below 4 MiB')
it('optimizes an oversized JPEG below the target without changing the source')
it('keeps PNG output lossless and preserves alpha')
it('falls back to the source and logs when Sharp times out')
it('falls back independently when one image fails')
it('never runs more than two image pipelines concurrently')
it('stops starting work after the eight-second batch budget')
it('reuses a valid cached optimized image')
```

创建服务导出骨架，让测试以“方法未实现/断言不符”失败：

```ts
export const SESSION_IMAGE_THRESHOLD_BYTES = 4 * 1024 * 1024
export const SESSION_IMAGE_TARGET_BYTES = Math.floor(3.8 * 1024 * 1024)

export class SessionImageOptimizer {
  async optimizeBatch(sourcePaths: string[]): Promise<SessionImageOptimizationResult[]> {
    return sourcePaths.map((sourcePath) => ({
      sourcePath,
      outputPath: sourcePath,
      status: 'original',
      inputBytes: 0,
      outputBytes: 0,
      durationMs: 0,
    }))
  }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/SessionImageOptimizer.test.ts`

Expected: FAIL，报告大图未压缩、日志/超时/并发行为缺失。

- [ ] **Step 3: 实现最小可用压缩管线**

实现以下固定策略：

```ts
const ATTEMPTS = [
  { maxEdge: 3072, quality: 85 },
  { maxEdge: 2560, quality: 80 },
  { maxEdge: 2048, quality: 75 },
] as const
const PER_IMAGE_BUDGET_MS = 3_000
const BATCH_BUDGET_MS = 8_000
const MAX_CONCURRENT = 2
```

每个 pipeline 根据剩余时间调用 `.timeout({ seconds: Math.max(1, Math.ceil(remainingMs / 1000)) })`；JPEG 使用 `.jpeg({ quality, mozjpeg: true })`，PNG 使用 `.png({ compressionLevel: 9 })`，WebP 使用 `.webp({ quality })`。所有分支捕获异常并映射为 `fallback`，日志不包含完整路径。

- [ ] **Step 4: 运行服务测试确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/SessionImageOptimizer.test.ts`

Expected: PASS。

### Task 3: 注册批量 IPC 并声明 Sharp 直接依赖

**Files:**

- Create: `apps/desktop/src/main/ipc/registerSessionImageOptimizerIpc.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 创建 IPC 注册器**

```ts
export function registerSessionImageOptimizerIpc(): void {
  const optimizer = new SessionImageOptimizer({
    outputRoot: path.join(app.getPath('temp'), 'spark-agent-session-images'),
  })
  typedIpcHandle('file:prepare-session-images', async ({ sourcePaths }) => ({
    results: await optimizer.optimizeBatch(sourcePaths),
  }))
  void optimizer.cleanupExpiredFiles().catch(() => undefined)
}
```

`cleanupExpiredFiles` 内部自行记录警告，注册器不得因为清理失败中断启动。

- [ ] **Step 2: 在统一入口注册**

导入并在 `registerAllIpcHandlers()` 顶部服务注册区调用 `registerSessionImageOptimizerIpc()`。

- [ ] **Step 3: 声明已批准的直接依赖**

Run: `pnpm --filter @spark/desktop add sharp@0.35.3`

Expected: `apps/desktop/package.json` 出现精确版本 `sharp: "0.35.3"`；`pnpm-workspace.yaml` 通过安全 override 让 Transformers 复用同一修复版本，避免双份运行库。相对既有 0.34.5，macOS arm64 解包体积约增加 2～3 MiB。

- [ ] **Step 4: 运行主进程类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

### Task 4: 用纯函数定义 Renderer 回退行为

**Files:**

- Create: `apps/desktop/src/renderer/design/services/session-image-attachments.ts`
- Create: `apps/desktop/src/renderer/design/services/session-image-attachments.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：

```ts
it('replaces only successfully optimized image paths')
it('keeps image paths for original and fallback results')
it('keeps files and directories untouched')
it('returns original attachments when the IPC call rejects')
it('summarizes optimized and fallback counts and byte totals')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/services/session-image-attachments.test.ts`

Expected: FAIL，模块尚不存在或导出未实现。

- [ ] **Step 3: 实现附件准备函数**

```ts
export async function prepareSessionImageAttachments(
  attachments: ComposerAttachmentDraft[],
  invoke: (request: FilePrepareSessionImagesRequest) => Promise<FilePrepareSessionImagesResponse>,
): Promise<{ attachments: ComposerAttachmentDraft[]; summary: SessionImageOptimizationSummary }> {
  const imagePaths = attachments.filter((item) => item.type === 'image').map((item) => item.path)
  if (imagePaths.length === 0) return { attachments, summary: EMPTY_SUMMARY }
  try {
    const response = await invoke({ sourcePaths: imagePaths })
    return applySessionImageOptimizationResults(attachments, response.results)
  } catch {
    return { attachments, summary: { ...EMPTY_SUMMARY, fallbackCount: imagePaths.length } }
  }
}
```

映射时使用 `sourcePath` 查找结果，仅在 `status === 'optimized'` 时替换 `path`；同时让 `previewPath` 和 `previewUrl` 保持原图，避免 UI 因临时路径闪烁。

- [ ] **Step 4: 运行 Renderer helper 测试确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/services/session-image-attachments.test.ts`

Expected: PASS。

### Task 5: 接入 Composer 发送链路

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`

- [ ] **Step 1: 注入 typed IPC hook**

```ts
const { invoke: prepareSessionImages } = useIpcInvoke('file:prepare-session-images')
```

- [ ] **Step 2: 在普通消息和转发命令发送前统一准备附件**

在 `dispatchMessage` 内发送分支真正调用 `sendTurn` 前执行一次：

```ts
const prepared = await prepareSessionImageAttachments(turnAttachments, prepareSessionImages)
const requestAttachments = toSessionAttachments(prepared.attachments)
showSessionImageOptimizationSummary(prepared.summary, toast)
```

准备函数自身必须吞掉 IPC 失败并回退，Composer 外层现有 `catch` 只处理真正的消息发送错误。压缩后的附件仅用于本次请求；发送失败恢复输入框时仍使用 `turnAttachments` 原图。

- [ ] **Step 3: 运行相关测试和类型检查**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/services/session-image-attachments.test.ts src/renderer/tests/composer-drag-drop.test.ts`

Expected: PASS。

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

### Task 6: 性能、错误回退和交付审查

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-session-image-compression-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-session-image-compression.md`

- [ ] **Step 1: 运行完整针对性验证**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/main/services/SessionImageOptimizer.test.ts \
  src/renderer/design/services/session-image-attachments.test.ts \
  src/renderer/tests/composer-drag-drop.test.ts
pnpm --filter @spark/protocol typecheck
pnpm --filter @spark/desktop typecheck
git diff --check
```

Expected: 全部 PASS，`git diff --check` 无输出。

- [ ] **Step 2: 运行真实图片基准**

用临时生成或仓库测试 fixture 验证 4 MiB 以上 JPEG/PNG，记录输入/输出体积与耗时。确认普通 12～24 MP JPEG 在开发机上通常低于 2 秒，强制慢处理测试在 3 秒内回退；基准文件不得提交。

- [ ] **Step 3: 审查变更范围**

尝试运行 `npx gitnexus analyze` 更新索引并执行 detect changes；不可用时立即降级：

```bash
rg -n "prepare-session-images|SessionImageOptimizer|prepareSessionImageAttachments" apps/desktop packages/protocol
git diff --stat
git diff -- apps/desktop packages/protocol docs/superpowers
```

确认没有画布、媒体生成和非图片附件行为变化。

- [ ] **Step 4: 更新文档状态**

把设计文档和本计划状态更新为：

```text
> 状态: 已落地 | 最后核对: 2026-08-01
```

补充实际基准、测试命令、Sharp 依赖净增判断和任何与设计不同的实现细节。

- [ ] **Step 5: 最终提交**

```bash
git add apps/desktop packages/protocol pnpm-lock.yaml docs/superpowers
git commit -m "feat(chat): compress oversized session images"
```

Expected: 提交只包含会话图片压缩、协议、测试、依赖和对应文档。
