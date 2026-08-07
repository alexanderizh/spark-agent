# 画布视频「分离音频」+ 音频资源节点入口

> 状态: 待开发 | 最后核对: 2026-08-07

## 目标与范围

在无限画布中为视频节点新增「分离音频」操作：把视频音轨抽成独立音频资源节点，并补齐音频资源节点的添加入口。

**用户已确认的两个决策（A/A）**：
1. 改动范围：画布 operation + 视频工作台通用通道都加（复用同一 `FfmpegRunner.extractAudio`）。
2. 音频格式：默认原轨抽取（`-c:a copy`，最快无损，扩展名按 probe 出的音轨编码自动定），面板另提供 MP3 / AAC / WAV 重编码选项。

## 核心发现（决定工作量）

audio 节点类型**已完整存在**，无需新建类型：
- `canvas.types.ts:20` `CanvasNodeType` 已含 `'audio'`
- `canvas.types.ts:45` `CanvasAssetType` 已含 `'audio'`
- 渲染 `<audio>`、编辑、拖入分类、`createMediaNode({kind:'audio'})`、agent 工具枚举均已接入
- `applyMediaTaskResult`（`canvas.api.ts:6284-6390`）已支持 audio 物化：assetType==='audio' → 建 audio 节点 + generated 连线 + `safe-file://` URL

**因此真正要做的只有三件事**：新增 `extract_audio` operation 全链路（仿 `video_depth_map`）+ ffmpeg 后端 + 补音频资源菜单入口。

## 技术决策（已定）

| 项 | 决策 |
|---|---|
| operation 名 | `extract_audio` |
| 执行通道 | `local_media`（与 `video_depth_map` 同类，本地 ffmpeg） |
| 产物落画布 | 复用 `applyMediaTaskResult`，**不改**物化逻辑 |
| 产物存储 | `{userData}/.spark-artifacts/media/canvas-audio/` 临时目录 + `safe-file://` URL（与 depth 一致；持久化到项目目录为后续优化） |
| provider/modelId 标识 | `provider:'local_ffmpeg'`, `modelId:'ffmpeg-extract-audio'` |
| 默认格式 | `-c:a copy` 原轨抽取，扩展名按 audioCodec 映射（aac→m4a, mp3→mp3, ac3→ac3, opus→ogg, pcm→wav） |
| 无音轨 | `probe.hasAudio === false` 时直接返回 failed，文案「该视频没有音轨，无法分离音频」 |
| 单文件大小 | `canvas.api.ts` / `CanvasWorkspaceView.tsx` 已超 3000 行（历史遗留），本次按 depth 既有模式做小幅扩展，不顺带拆分（拆分属独立重构任务） |

## 实现步骤

### A. ffmpeg 后端（主进程）

**A1. `apps/desktop/src/main/services/FfmpegRunner.ts`（当前 1258 行）— 加 `extractAudio`**

仿 `trimVideo` / `transcodeVideo` 模式，新增：

```ts
export type AudioExtractFormat = 'copy' | 'mp3' | 'aac' | 'wav'

export interface ExtractAudioOpts {
  format?: AudioExtractFormat          // 默认 'copy'
  onProgress?: (p: FfmpegProgress) => void
}

export interface ExtractAudioResult {
  path: string
  mimeType: string
  durationMs: number
  audioCodec: string
}

export async function extractAudio(
  input: string,
  outputPath: string,
  opts: ExtractAudioOpts = {},
): Promise<ExtractAudioResult>
```

实现要点：
- 先 `probeVideo(input)`，`hasAudio===false` 抛「该视频没有音轨，无法分离音频」
- `format==='copy'`：`-vn -c:a copy`，扩展名按 `audioCodec` 映射（调用方传入的 outputPath 已含正确扩展名，内部校验一致）
- `format==='mp3'`：`-vn -c:a libmp3lame -q:a 2`
- `format==='aac'`：`-vn -c:a aac -b:a 192k`（输出 m4a）
- `format==='wav'`：`-vn -c:a pcm_s16le`
- mimeType 按实际输出格式定（audio/mpeg、audio/mp4、audio/wav、audio/aac…）
- durationMs = `Math.round(probe.durationSec * 1000)`
- copy 模式极快但仍走 `runFfmpeg`，复用进度/超时/取消

**A2. `apps/desktop/src/main/services/videoProcessHandler.ts`— 加 `extractAudio` case**

- import `extractAudio` from FfmpegRunner
- `dispatch` switch 加 `case 'extractAudio'`：校验 input 路径白名单 → `makeOutputPath(ext)` → 调 `extractAudio` → 返回 `{ path, mimeType, durationMs }`
- 注意：operation 联合类型在 protocol 侧扩展（见 C2）

**A3. 新建 `apps/desktop/src/main/ipc/registerCanvasAudioExtractIpc.ts`**

仿 `registerCanvasDepthTaskIpc.ts`（完整模板已读），关键差异：
- 通道：`canvas:task:extract-audio` / `canvas:task:cancel-extract-audio`
- 无需 capability manager / 模型下载（ffmpeg 已是基础能力）
- `runningTasks` Map + AbortController，`before-quit` 清理
- 入参：`{ projectId, clientTaskId, inputPath, audioFormat }`
- 流程：`assertAllowedInputPath` → probe（确认有音轨）→ `extractAudio` → 推 `succeeded` payload
- 成功 assets：`[{ type:'audio', filePath: result.path, mimeType: result.mimeType, durationMs: result.durationMs }]`
- 失败/取消走与 depth 相同的 pushResponse 模式
- 复用 `isSafeFilePathAllowed` 校验输入路径

**A4. `apps/desktop/src/main/ipc/index.ts:3011` — 注册**

```ts
import { registerCanvasAudioExtractIpc } from './registerCanvasAudioExtractIpc.js'
// ...
registerCanvasAudioExtractIpc()
```

### B. protocol 层（packages/protocol）

**B1. `packages/protocol/src/schemas/index.ts:1252` 后 — 加 channel schema**

```ts
'canvas:task:extract-audio': z.object({
  projectId: z.string().min(1).max(200),
  clientTaskId: z.string().min(1).max(200),
  inputPath: z.string().min(1).max(4096),
  audioFormat: z.enum(['copy', 'mp3', 'aac', 'wav']).optional(),
}),
'canvas:task:cancel-extract-audio': z.object({
  runtimeTaskId: z.string().min(1).max(200),
}),
```

**B2. `packages/protocol/src/ipc/index.ts:5804` 后 — 加 channel 类型映射**

仿 depth 映射，加 `'canvas:task:extract-audio'` 与 `'canvas:task:cancel-extract-audio'`，复用 `CanvasMediaTaskCreateResponse` / 流式 payload。

**B3. `packages/protocol/src/ipc/index.ts:3887` — 扩展 `VideoProcessRequest.operation`**

联合类型追加 `| 'extractAudio'`。

### C. 前端 operation 注册（renderer/design/views/canvas/）

**C1. `canvas.types.ts`**
- `CanvasOperationType`（:48-65）追加 `| 'extract_audio'`

**C2. `canvas.capabilities.ts`**
- `CANVAS_CAPABILITIES` 加 capability：
  ```ts
  {
    operation: 'extract_audio',
    label: '分离音频',
    inputTypes: ['video'],
    outputTypes: ['audio'],
  }
  ```
- `OPERATION_NODE_TYPES`（:181）加 `'extract_audio'`
- `operationNodeIcon`（:243 case）加 `case 'extract_audio'`

**C3. `canvasOperationKind.ts:16`**
```ts
if (operation === 'video_depth_map' || operation === 'extract_audio') return 'local_media'
```

**C4. `canvasOperationPanelMode.ts:32` 后 — 加分支**
仿 `video_depth_map` 分支，但 `showLocalDepthNotice: false`（无需深度模型），`dedicatedMediaKind: 'video'`，`submitLabel: '分离音频'`，`showPromptEditor: false`，`runtimeKind: 'none'`。

需扩展 `CanvasOperationPanelMode`：加 `audioFormat?: 'copy'|'mp3'|'aac'|'wav'` 选项控制（或在面板组件内本地 state，不改类型）。**倾向后者**：面板组件内用 useState 管 audioFormat，提交时塞进 modelParams，不改 PanelMode 类型。

**C5. `canvasNodeNaming.ts:27`** — 加 `extract_audio: '分离音频'`

**C6. `canvasOperationIcons.tsx:121`** — 加 `case 'extract_audio'`，返回 audio 语义色 + `Icons.Music/Audio` 图标

**C7. `canvasNodeGenerationMenu.ts:48` video 组** — 加 `{ operation: 'extract_audio', label: '分离音频', icon: 'Audio' }`

### D. canvas.api.ts 任务链路

**D1. 新增 `createLocalAudioExtractTask`**（仿 `createLocalDepthTask` :5360-5437）

关键差异：
- `operation: 'extract_audio'`，`title: '分离音频'`
- `provider: 'local_ffmpeg'`，`modelId: 'ffmpeg-extract-audio'`
- 调 `window.spark.invoke('canvas:task:extract-audio', { projectId, clientTaskId, inputPath, audioFormat })`
- `audioFormat` 从 `request.modelParams?.audioFormat` 取，默认 `'copy'`

**D2. `submitOperation` 分派（:5255）— 泛化 local_media 分派**

当前 `executionKind === 'local_media'` 硬调 `createLocalDepthTask`。改为按 operation 分派：
```ts
: executionKind === 'local_media'
  ? (request.operation === 'extract_audio'
      ? this.createLocalAudioExtractTask(...)
      : this.createLocalDepthTask(...))
```

**D3. `cancelTask` 路由（:5291）— 加 extract_audio 分支**

```ts
if (task.operation === 'video_depth_map') {
  await window.spark.invoke('canvas:task:cancel-depth-video', {...})
} else if (task.operation === 'extract_audio') {
  await window.spark.invoke('canvas:task:cancel-extract-audio', {...})
} else {
  await window.spark.invoke('canvas:task:cancel-media', {...})
}
```

### E. 校验泛化

**`canvasTaskSubmissionValidation.ts:130` `validateCanvasLocalTaskSubmission`**

当前硬编码「深度视频转换」文案。改为按 operation 参数化文案：
- 入参增加 operation 判定（从 request 取）
- `extract_audio`：校验单段视频输入 + 本地路径，文案「分离音频仅支持一段输入视频」「分离音频需要可读取的本地视频路径」
- `video_depth_map`：保持原文案

注意：函数签名可能需小幅调整以接收 operation（或从 request.operation 推断）。

### F. 音频资源节点菜单入口

**F1. `CanvasAddNodeMenu.tsx`**
- `AddNodeMenuItem.action` 联合类型（:30）扩展 `| 'upload_audio'`（视频上传是否一并补 `upload_video` 见下）
- `useAddNodeMenuItems`（:58）在 `resource:image` 后加：
  ```ts
  {
    id: 'resource:audio',
    label: '音频',
    category: 'resource',
    icon: <Icons.Audio size={15} />,
    colorClass: 'canvas-op-color-audio',
    nodeType: 'audio',
    data: {},
  }
  ```
- 同理补 `resource:video`（当前菜单缺视频资源入口，拖入已支持但点击添加没有，顺手补齐一致性）

**F2. `CanvasWorkspaceView.tsx:3391` onSelect 消费**

仿 `item.nodeType === 'image'` → `addEmptyImage()`，加：
```ts
if (item.nodeType === 'audio') { void addEmptyAudio(); return }
if (item.nodeType === 'video') { void addEmptyVideo(); return }
```
`addEmptyAudio` / `addEmptyVideo` 仿 `addEmptyImage`：落空节点 → 触发文件选择 → `createMediaNode({kind:'audio'|'video'})` 填充。需确认 `createMediaNode` 对 audio/video 的空节点支持（调研确认已支持）。

### G. 操作面板（分离音频参数 UI）

定位视频节点的操作面板组件（`video_depth_map` 的面板渲染处），为 `extract_audio` 加：
- 格式选择器：原轨抽取(默认) / MP3 / AAC / WAV（Radio 或 Select）
- 无 prompt 编辑器、无自定义参数
- 提交按钮文案「分离音频」
- 复用 depth 面板的本地执行提示样式（但不显示深度模型下载）

实现时需定位 depth 面板组件确切文件（`canvasOperationPanelMode` 的消费方），在 plan 执行阶段定位。

### H. 工具说明同步（三处）

**H1. `canvas.tools.ts` OPERATION_TYPES（:457）**
- 注意：当前数组**不含** `video_depth_map`（depth 未暴露给 agent）。`extract_audio` 是否暴露给 agent？
- **决策：暴露**。分离音频是通用能力，agent 可帮用户批量处理。加入 OPERATION_TYPES 数组 + tool description。
- 同时补 `video_depth_map`（修正既有遗漏？需确认是否有意不暴露 — 执行时核实，不强行改）。

**H2. `canvas-studio` SKILL.md** — 在视频操作说明区加「分离音频」条目。

**H3. `canvasAgentContextBuilder`** — 动态查询 capability，无需改（调研确认）。

### I. 顺手优化（可选，独立提交）

抽离 audio 节点渲染：`CanvasNode.tsx:1476-1496` 内联的 `<audio>` 渲染抽成 `canvasAudioNodePresentation.tsx` 组件。符合「单文件超 3000 行拆分」规则。**列为可选项**，若主体改动验证通过且时间允许再做，避免与主体改动耦合。

## 验证计划

1. **typecheck**：针对改动文件跑 `pnpm tsc --noEmit`（若工作树有并行改动，仅自查自身改动文件，跳过全项目 typecheck — 遵循记忆 `agt_9f36c02d`）。
2. **ffmpeg 单测**：为 `extractAudio` 补聚焦测试（仿 `videoProcessHandler.test.ts` 模式），覆盖 copy/mp3/aac/wav 四种格式 + 无音轨报错。需确认 FfmpegRunner 是否已有测试文件（执行时定位，若无则新建 `FfmpegRunner.extractAudio.test.ts`）。
3. **真机冒烟**（必做）：
   - 含音频视频 → 分离 → 确认产出 audio 节点 + generated 连线 + `<audio>` 可播放 + 时长正确
   - 无音频视频 → 确认友好报错
   - 各格式选项产物可播放、mimeType 正确
   - 取消任务 → 确认 ffmpeg 进程终止、task 标 cancelled
   - 添加菜单 → 音频/视频资源入口可落节点并上传
   - 拖入音频文件 → 已有支持，回归确认不破坏
4. **视频工作台**：右键视频 → 分离音频 → 产物文件生成（不落画布节点）。

## 风险与回退

| 风险 | 应对 |
|---|---|
| `submitOperation` / `cancelTask` 分派改动影响现有 depth 流程 | 改动是纯分支扩展（新增 else-if），不动 depth 分支逻辑；冒烟时回归 depth 转换 |
| `VideoProcessRequest.operation` 联合类型扩展影响序列化 | 只增不删，向后兼容 |
| ffmpeg copy 模式遇到特殊容器（如 mp4 装 pcm）失败 | catch 后回退建议用户选 wav 重编码；错误文案带 ffmpeg stderr 尾部 |
| 临时目录产物被清理 | 与 depth 一致的既有行为；持久化到项目目录列为后续优化 |
| `canvas.api.ts` / `CanvasWorkspaceView.tsx` 已超 3000 行 | 本次按 depth 既有模式小幅扩展，不顺带拆分；若 reviewer 要求，I 项可独立拆出 |

## 实现前必做（GitNexus 规则）

开始编辑前，对以下公共符号跑 `gitnexus_impact({target, direction:'upstream'})`：
- `canvasOperationKind` / `resolveCanvasOperationPanelMode`（被全 operation 面板消费）
- `createLocalDepthTask` 附近分派逻辑 / `cancelTask`
- `handleVideoProcess` / `VideoProcessRequest`

若 GitNexus MCP 不可用（记忆 `agt_2ab2c560`），降级用 `rg` 调用点检索 + `git diff` 核对，在交付说明注明降级。

## 交付物

- 改动文件清单 + 每处改动原因
- typecheck / 单测结果（如实报告）
- 真机冒烟结果（截图或文字描述）
- 风险项与待确认事项
