# 图片反推与深度视频转换节点实施计划

> 状态: 已落地 | 最后核对: 2026-08-04

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为无限画布增加图片反推提示词节点与完全本地运行的深度视频转换节点，并把 Depth Anything V2 Small ONNX 模型发布到 Spark MinIO 制品仓库。

**Architecture:** 图片反推作为显式文本 vision 操作复用现有 `canvas:task:generate-text` 链路；深度视频转换作为新的本地媒体任务，经受管模型完整性服务、独立推理 worker 和 FFmpeg 解码/编码后写回普通视频资产，并按配置决定是否映射原音轨。模型采用版本化归档，使用 SHA-256 校验并从 MinIO 按需安装。

**Tech Stack:** TypeScript、Electron、React、Vitest、FFmpeg/ffprobe、Transformers.js、ONNX Runtime、Depth Anything V2 Small INT8、S3/MinIO SigV4。

---

## 文件结构

- `packages/protocol/src/media-config.ts`、`packages/protocol/src/schemas/index.ts`、`packages/protocol/src/ipc/index.ts`：新增操作、模型安装和本地深度任务 IPC 契约。
- `packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts`、`packages/agent-runtime/src/services/skill-registry/index.ts`：支持 `model` 制品类型和模型归档安装。
- `apps/desktop/src/renderer/design/views/canvas/canvasOperationKind.ts`：集中判断文本、云媒体和本地媒体操作。
- `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts`、`canvas.capabilities.ts`、`canvasNodeNaming.ts`、`canvasOperationPresets.ts`：注册节点与菜单语义。
- `apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.ts`、`canvasOperationSubmission.ts`：实施图片/视频输入约束和分流。
- `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`：根据操作类型展示 vision 配置或本地深度配置。
- `apps/desktop/src/main/services/DepthModelIntegrityService.ts`：发现、下载和验证本地深度模型。
- `apps/desktop/src/main/services/depth-video/depthMath.ts`：深度归一化、方向与时间平滑的纯函数。
- `apps/desktop/src/main/services/depth-video/DepthInferenceWorker.ts`：加载本地模型并处理单帧。
- `apps/desktop/src/main/services/depth-video/DepthVideoRunner.ts`：管理 FFmpeg、worker、背压、取消和临时文件。
- `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts`：注册模型状态、安装、运行和取消 IPC。
- `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`：创建本地任务、消费进度、落库并写回视频资产。
- `scripts/prepare-depth-model-artifact.mjs`、`scripts/publish-depth-model-to-minio.mjs`：构建、校验、备份并发布模型制品。
- `docs/` 与官网无限画布文档：同步菜单、依赖和离线行为。

### Task 1: 协议、菜单和统一操作分类

**Files:**
- Modify: `packages/protocol/src/media-config.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.capabilities.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeNaming.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationKind.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationKind.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('replaces the base text group with image prompt reverse and depth video', () => {
  expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
    'image', 'video', 'audio',
  ])
  expect(canvasBaseCreateOperations().map((item) => item.operation)).toEqual([
    'text_to_image', 'image_edit', 'image_compose', 'image_prompt_reverse',
    'text_to_video', 'image_to_video', 'video_edit', 'video_extend', 'video_depth_map',
    'text_to_audio', 'audio_transcribe',
  ])
})

it('classifies explicit image prompt and local depth operations', () => {
  expect(canvasOperationKind('image_prompt_reverse')).toBe('text')
  expect(canvasOperationKind('video_depth_map')).toBe('local_media')
  expect(canvasOperationKind('image_to_video')).toBe('cloud_media')
})
```

- [ ] **Step 2: 运行测试并确认因新操作缺失失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu.test.ts canvasOperationKind.test.ts`

Expected: FAIL，提示新 operation 或 helper 不存在。

- [ ] **Step 3: 添加最小协议和分类实现**

```ts
export type CanvasOperationExecutionKind = 'text' | 'cloud_media' | 'local_media'

export function canvasOperationKind(operation: CanvasOperationType): CanvasOperationExecutionKind {
  if (
    operation === 'text_generate' ||
    operation === 'text_rewrite' ||
    operation === 'prompt_optimize' ||
    operation === 'image_prompt_reverse'
  ) return 'text'
  if (operation === 'video_depth_map') return 'local_media'
  return 'cloud_media'
}
```

同时把 `image_prompt_reverse`、`video_depth_map` 加入 renderer/protocol union、schema、节点类型、capability、label、icon，并按失败测试调整基础菜单；`capabilityForOperation()` 对二者返回空数组。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu.test.ts canvasOperationKind.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/media-config.ts packages/protocol/src/schemas/index.ts apps/desktop/src/renderer/design/views/canvas/canvas.types.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts apps/desktop/src/renderer/design/views/canvas/canvas.capabilities.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeNaming.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationKind.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationKind.test.ts
git commit -m "feat(canvas): register image prompt and depth video operations"
```

### Task 2: 图片反推输入契约和 vision 文本执行

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasTaskDefaults.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('uses the fixed direct prompt for image prompt reverse', () => {
  expect(buildCanvasOperationPrompt('image_prompt_reverse', '')).toContain('只输出一段中文完整提示词')
})

it('requires exactly one image for image prompt reverse', () => {
  expect(validateCanvasTextTaskSubmission({
    operation: 'image_prompt_reverse', prompt: '', inputFiles: [],
  })).toThrowError('请连接一张输入图片')
})
```

再加入单图通过、多图失败、`prepareCanvasOperationSubmission()` 将其分到 `validateText` 的断言。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasOperationPresets.test.ts canvasTaskSubmissionValidation.test.ts canvasOperationSubmission.test.ts`

Expected: FAIL，提示缺少默认指令或错误进入媒体校验。

- [ ] **Step 3: 实现固定提示词和文本分流**

```ts
const IMAGE_PROMPT_REVERSE_PROMPT = [
  '分析输入图片并反推出可直接用于文生图或图生视频的一段中文完整提示词。',
  '覆盖主体、环境、构图、镜头、光影、色彩、材质与风格。',
  '只输出提示词，不输出分析过程、标题、Markdown 或额外解释。',
  '无法可靠判断的细节不要虚构为事实。',
].join('\n')
```

使用 `canvasOperationKind()` 替换提交、运行、重试和批量路径里的三操作硬编码；图片反推仍调用 `createTextTask()` 并携带现有 `inputFiles` vision 附件。

- [ ] **Step 4: 运行定向测试**

Run: `pnpm --filter @spark/desktop test:unit -- canvasOperationPresets.test.ts canvasTaskSubmissionValidation.test.ts canvasOperationSubmission.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts apps/desktop/src/renderer/design/views/canvas/canvasTaskDefaults.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.ts apps/desktop/src/renderer/design/views/canvas/canvas.api.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.test.ts apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.test.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.test.ts
git commit -m "feat(canvas): run image prompt reverse through vision text models"
```

### Task 3: 节点面板的专用交互

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('shows vision selection without a prompt editor for image prompt reverse', () => {
  const view = renderOperation('image_prompt_reverse')
  expect(view.getByText('图片理解模型')).toBeTruthy()
  expect(view.queryByLabelText('提示词')).toBeNull()
})

it('shows local depth controls without provider controls', () => {
  const view = renderOperation('video_depth_map')
  expect(view.getByText('生成深度视频转换')).toBeTruthy()
  expect(view.queryByText('Provider')).toBeNull()
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.tsx`

Expected: FAIL，当前面板仍使用通用字段。

- [ ] **Step 3: 添加显式 UI 分支**

```ts
const isImagePromptReverse = operation === 'image_prompt_reverse'
const isLocalDepthVideo = operation === 'video_depth_map'
const showPromptEditor = !isImagePromptReverse && !isLocalDepthVideo
const showProviderControls = !isLocalDepthVideo
```

深度节点主按钮根据模型状态显示“下载模型并运行”或“生成深度视频转换”，并提供“是否保留音频”开关；图片反推使用图片理解 Provider 筛选器。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.tsx`

Expected: PASS。

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.tsx
git commit -m "feat(canvas): add dedicated image prompt and depth task panels"
```

### Task 4: 通用模型制品安装与深度模型完整性

**Files:**
- Modify: `packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts`
- Modify: `packages/agent-runtime/src/services/skill-registry/index.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `apps/desktop/src/main/services/DepthModelIntegrityService.ts`
- Create: `apps/desktop/src/main/services/__tests__/DepthModelIntegrityService.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/skill-registry/artifact-manifest.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('accepts model artifacts and installs their archive', async () => {
  const artifact = { id: 'model.depth-anything-v2-small-int8-1.0.0', type: 'model' }
  expect(isInstallableModelArtifact(artifact)).toBe(true)
})

it('marks a verified local model ready', async () => {
  const service = createServiceWithFixture('depth-anything-v2-small-int8')
  await expect(service.inspect()).resolves.toMatchObject({ state: 'ready', version: '1.0.0' })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/agent-runtime test:unit -- artifact-manifest.test.ts && pnpm --filter @spark/desktop test:unit -- DepthModelIntegrityService.test.ts`

Expected: FAIL，`model` 类型和服务不存在。

- [ ] **Step 3: 实现模型安装边界**

```ts
export type SparkInstallArtifactType =
  | 'skill' | 'runtime' | 'python-wheelhouse' | 'npm-store'
  | 'archive' | 'binary' | 'voice' | 'model'

async installModelArtifact(artifactId: string, opts = {}) {
  return this.installManagedArchive(artifactId, 'model', this.modelDir, opts)
}
```

完整性服务只接受包含 `config.json`、`preprocessor_config.json`、`onnx/model_int8.onnx`、`LICENSE` 和 `model-package.json` 的归档，并对 package manifest 中的逐文件哈希复核。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter @spark/agent-runtime test:unit -- artifact-manifest.test.ts && pnpm --filter @spark/desktop test:unit -- DepthModelIntegrityService.test.ts`

Expected: PASS。

```bash
git add packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts packages/agent-runtime/src/services/skill-registry/index.ts packages/agent-runtime/src/index.ts packages/agent-runtime/src/__tests__/services/skill-registry/artifact-manifest.test.ts apps/desktop/src/main/services/DepthModelIntegrityService.ts apps/desktop/src/main/services/__tests__/DepthModelIntegrityService.test.ts
git commit -m "feat(artifacts): install verified local depth models"
```

### Task 5: 深度图纯函数与推理适配器

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/main/services/depth-video/depthMath.ts`
- Create: `apps/desktop/src/main/services/depth-video/depthMath.test.ts`
- Create: `apps/desktop/src/main/services/depth-video/DepthFrameEstimator.ts`
- Create: `apps/desktop/src/main/services/depth-video/DepthFrameEstimator.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('normalizes relative depth to near-white far-black', () => {
  expect(Array.from(normalizeInverseDepth(new Float32Array([1, 2, 3])))).toEqual([0, 128, 255])
})

it('resets temporal smoothing on a scene cut', () => {
  const result = smoothDepthFrame(current, previous, { sceneCut: true, historyWeight: 0.25 })
  expect(result).toEqual(current)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- depthMath.test.ts DepthFrameEstimator.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 安装运行依赖并实现适配器**

Run: `pnpm --filter @spark/desktop add @huggingface/transformers`

实现 `normalizeInverseDepth()` 的稳健分位裁剪和近白远黑方向，`smoothDepthFrame()` 使用固定历史权重并在场景切换时重置。`DepthFrameEstimator` 以本地模型路径创建 `depth-estimation` pipeline，设置 `local_files_only: true` 并禁用远程模型加载。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter @spark/desktop test:unit -- depthMath.test.ts DepthFrameEstimator.test.ts`

Expected: PASS。

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/main/services/depth-video
git commit -m "feat(depth): add local ONNX frame estimation"
```

### Task 6: 深度视频 runner、进度和取消

**Files:**
- Create: `apps/desktop/src/main/services/depth-video/DepthVideoRunner.ts`
- Create: `apps/desktop/src/main/services/depth-video/DepthVideoRunner.test.ts`
- Modify: `apps/desktop/src/main/services/FfmpegRunner.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('preserves fps and dimensions while dropping audio', async () => {
  const result = await runner.run(fixtureVideo, outputPath, signal)
  expect(result.ffmpegArgs.join(' ')).toContain('-an')
  expect(result.width).toBe(640)
  expect(result.height).toBe(360)
  expect(result.fps).toBe(24)
})

it('kills decoder and encoder and removes partial output on abort', async () => {
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
  expect(fs.existsSync(outputPath)).toBe(false)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- DepthVideoRunner.test.ts`

Expected: FAIL，runner 不存在。

- [ ] **Step 3: 实现有界流式管线**

decoder 输出固定尺寸 RGB24 帧；runner 一次只允许有限帧等待推理，向 encoder 写入 gray8 帧时遵守 Node stream `drain` 背压。编码参数固定包含：

```ts
['-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', `${width}x${height}`,
 '-framerate', fpsText, '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
 '-movflags', '+faststart', '-y', tempOutput]
```

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter @spark/desktop test:unit -- DepthVideoRunner.test.ts`

Expected: PASS。

```bash
git add apps/desktop/src/main/services/depth-video/DepthVideoRunner.ts apps/desktop/src/main/services/depth-video/DepthVideoRunner.test.ts apps/desktop/src/main/services/FfmpegRunner.ts
git commit -m "feat(depth): stream local depth video processing"
```

### Task 7: IPC 与画布本地任务写回

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Create: `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('emits install and processing progress for a depth task', async () => {
  await handler.run(request)
  expect(events.map((event) => event.stage)).toEqual(
    expect.arrayContaining(['installing_model', 'decoding', 'estimating_depth', 'encoding']),
  )
})

it('writes a local depth result as a generated video asset', async () => {
  const snapshot = await api.applyLocalDepthTaskResult(projectId, taskId, response)
  expect(snapshot.nodes.some((node) => node.type === 'video')).toBe(true)
  expect(snapshot.edges.some((edge) => edge.type === 'generated')).toBe(true)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- registerCanvasDepthTaskIpc.test.ts canvasOperationInheritance.test.ts`

Expected: FAIL，IPC 和本地任务方法不存在。

- [ ] **Step 3: 实现 IPC 与画布状态机**

新增 `canvas:depth-model:status`、`canvas:depth-model:install`、`canvas:task:create-depth-video`、`canvas:task:cancel-depth-video` 以及 `stream:canvas:depth-task`。`canvas.api.ts` 使用 `createLocalDepthTask()` 创建 running 任务，处理进度后复用媒体资产写回 helper 创建 `video/mp4` 资产和结果节点。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter @spark/desktop test:unit -- registerCanvasDepthTaskIpc.test.ts canvasOperationInheritance.test.ts`

Expected: PASS。

```bash
git add packages/protocol/src/ipc/index.ts packages/protocol/src/schemas/index.ts apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.test.ts apps/desktop/src/main/ipc/index.ts apps/desktop/src/renderer/design/views/canvas/canvas.api.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts
git commit -m "feat(canvas): execute and persist local depth video tasks"
```

### Task 8: 构建并发布 MinIO 模型制品

**Files:**
- Create: `scripts/prepare-depth-model-artifact.mjs`
- Create: `scripts/publish-depth-model-to-minio.mjs`
- Create: `scripts/__tests__/prepare-depth-model-artifact.test.mjs`
- Modify: `package.json`
- Create: `docs/release-manifests/depth-anything-v2-small-int8-1.0.0.json`

- [ ] **Step 1: 写失败测试**

```js
test('builds a deterministic model package with required files', async () => {
  const result = await prepareDepthModelArtifact(fixtureDir, outputDir)
  assert.deepEqual(result.files.sort(), [
    'LICENSE', 'config.json', 'model-package.json',
    'onnx/model_int8.onnx', 'preprocessor_config.json',
  ])
  assert.match(result.entry.sha256, /^[a-f0-9]{64}$/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test scripts/__tests__/prepare-depth-model-artifact.test.mjs`

Expected: FAIL，构建脚本不存在。

- [ ] **Step 3: 实现可重复构建和安全发布**

构建脚本固定上游 revision，下载官方配置、Apache-2.0 许可证和 `model_int8.onnx`，逐文件哈希后生成归档与 release manifest。发布脚本沿用 Codex 发布脚本的 SigV4、线上清单备份、冲突检测、staging 清单和公网回读验证；凭据仅从 `RELEASE_MINIO_*` 环境变量读取。

- [ ] **Step 4: 运行测试并生成制品**

Run: `node --test scripts/__tests__/prepare-depth-model-artifact.test.mjs`

Expected: PASS。

Run: `pnpm artifacts:depth-model 1.0.0 /private/tmp/spark-depth-model-1.0.0`

Expected: 生成归档及包含真实 size/SHA-256 的 release manifest。

- [ ] **Step 5: 上传、更新清单并公网回读**

使用当前 shell 临时环境变量传入用户提供的 MinIO endpoint、bucket 和凭据，运行：

```bash
pnpm artifacts:publish-depth-model 1.0.0 /private/tmp/spark-depth-model-1.0.0
node scripts/audit-artifact-repository.mjs
```

Expected: 备份旧 `index.json`；模型对象和新清单上传成功；公网下载的 size/SHA-256 与 release manifest 一致。命令或日志不得打印凭据。

- [ ] **Step 6: 提交**

```bash
git add package.json scripts/prepare-depth-model-artifact.mjs scripts/publish-depth-model-to-minio.mjs scripts/__tests__/prepare-depth-model-artifact.test.mjs docs/release-manifests/depth-anything-v2-small-int8-1.0.0.json
git commit -m "build(artifacts): publish Depth Anything V2 model"
```

### Task 9: 文档、回归与最终核对

**Files:**
- Modify: `apps/website/src/content/docs-pages/canvas-mvp.tsx`
- Modify: `docs/superpowers/specs/2026-08-01-canvas-image-prompt-and-depth-video-nodes-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-image-prompt-and-depth-video-nodes.md`
- Create: `docs/reviews/2026-08-01-canvas-image-prompt-depth-video-delivery.md`

- [ ] **Step 1: 更新当前能力文档与状态**

记录菜单变化、图片反推的视觉模型依赖、深度模型首次下载、完全离线推理、FFmpeg 依赖、模型许可、模型体积和 MinIO artifact id。把 spec/plan 状态更新为“已落地”并刷新核对日期。

- [ ] **Step 2: 运行定向测试**

Run: `pnpm --filter @spark/protocol test:unit`

Run: `pnpm --filter @spark/agent-runtime test:unit -- artifact-manifest`

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu canvasOperationKind canvasOperationPresets canvasTaskSubmissionValidation canvasOperationSubmission CanvasOperationPanel DepthModelIntegrity depthMath DepthFrameEstimator DepthVideoRunner registerCanvasDepthTaskIpc canvasOperationInheritance`

Expected: 全部 PASS。

- [ ] **Step 3: 运行类型、格式和构建检查**

Run: `pnpm --filter @spark/desktop typecheck`

Run: `pnpm --filter @spark/desktop lint`

Run: `pnpm --filter @spark/desktop build`

Run: `git diff --check`

Expected: 全部成功；若 lint 有仓库既有问题，必须区分并记录本次变更是否新增错误。

- [ ] **Step 4: 真实短视频验收**

用仓库测试素材或新生成的短视频运行本地深度任务，使用 ffprobe 核对 H.264、原尺寸、原帧率、近似原时长和无音轨；抽取首/中/尾三帧确认前景亮于背景，并保存验收命令与结果到 review 文档。

- [ ] **Step 5: 运行变更范围核对**

GitNexus 可用时运行 `npx gitnexus analyze` 与 detect changes；不可用时执行：

```bash
rg -n "image_prompt_reverse|video_depth_map" packages apps docs scripts
git diff --stat HEAD~1..HEAD
git status --short
```

确认只影响预期操作、任务执行、制品、文档和测试，并记录 GitNexus 降级原因。

- [ ] **Step 6: 提交文档**

```bash
git add apps/website/src/content/docs-pages/canvas-mvp.tsx docs/superpowers/specs/2026-08-01-canvas-image-prompt-and-depth-video-nodes-design.md docs/superpowers/plans/2026-08-01-canvas-image-prompt-and-depth-video-nodes.md docs/reviews/2026-08-01-canvas-image-prompt-depth-video-delivery.md
git commit -m "docs(canvas): document image prompt and depth video workflow"
```
