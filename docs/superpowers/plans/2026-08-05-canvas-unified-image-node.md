# Canvas Unified Image Node Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-05

> **版本: v2（两轮复核后修订）**。v1 经第一轮自查（核实函数签名/行号/字段）与第二轮独立对抗式复核（发现 8 个阻塞问题 B1-B8、5 个改进 I1-I5），已全部纳入。每条 Task 标注其解决的复核编号以便追溯。

## 背景

无限画布当前有三种图片生成类操作节点：文生图（`text_to_image`）、图编辑（`image_edit`）、多图合成（`image_compose`），外加已通过 `getCanvasCapability` 归并到 `image_edit` 的遗留 `image_to_image`（仍被 `CanvasWorkspaceView.tsx:6892-6903` 角色身份板流程创建）。视频节点已在 `2026-08-02-canvas-unified-video-node.md` 完成「兼容型统一容器」改造。本计划按同一架构把图片三节点合并为单一「图片生成」节点。

## 调研结论（事实基线）

来源：视频合并设计文档 `docs/design/canvas-unified-media-input-configurator.md` §12、视频落地计划 `docs/superpowers/plans/2026-08-02-canvas-unified-video-node.md`、三轮代码调研 + 对抗式复核。

**视频合并的真实做法（模板）**：不删任何枚举、不迁移旧画布，分三层——
1. 用户入口：`canvasNodeGenerationMenu.ts:47` 收敛为单条「视频生成」(`text_to_video` 容器)。
2. 运行时统一：`canvasMediaInputMode.ts:15-50` 用 `UNIFIED_VIDEO_OPERATIONS` 把 4 个视频 operation 与 `video.*` capability 池打通；面板对所有视频节点渲染同一套 6 模式选择器，结果落到 `node.data.mediaInputMode` + `node.data.capabilityId`。
3. 提交路由：`canvas.api.ts:5145` `executionOperationForCanvasMediaCapability(params.capabilityId, nodeOperation)` 把 capability 反向映射成最终 `CanvasTask.operation`。

**图片三节点现状**：
- 面板对三者**无 `operation===` 硬编码分支**，走同一 `panelMode`（`canvasOperationPanelMode.ts:54-62` default，`executionKind='cloud_media'`）、同一提交函数。
- `image_edit` 与 `image_compose` 在底层**完全等价**：`capabilityForOperation` 都映射 `image.edit`（`media-config.ts:296-299`），`inferRolePolicy` 相同（`media-config.ts:429-436`）。
- 模型过滤 `CanvasOperationPanel.tsx:959-970` 依赖 `canvasMediaCapabilityIdsForOperation`。
- 图片节点当前**完全不走 `mediaInputMode` 机制**（`modeOptionsForCapability` 对 `image.*` 返回空）。
- 面板**未实现 mask UI**（`mask` 仅作类型存在），本期不引入 mask。

**底层路由**：`capabilityForOperation`（`media-config.ts:290-327`）是唯一事实源，`image_compose → image.edit`；adapter 已有「`image.generate` 携图 → 降级 `editImage`」兜底（`openai-compatible-media.adapter.ts:137-140` 等）；主进程优先消费 `req.capabilityId`（`main/ipc/index.ts:3641,3678`）。

**协议层关键事实**：`CanvasMediaInputMode`（`canvas-prompt.ts:97-103`）= `'text' | 'first_frame' | 'first_last_frame' | 'reference' | 'edit' | 'extend'`，已含 `text`/`reference` → **2 模式方案协议枚举零新增**。

## 关键决策（已与用户确认）

合并后「图片生成」节点采用 **2 模式**：
- `text`（文生图）：capability `image.generate` → operation `text_to_image` → 产物 `ai_generated`
- `reference`（图生图 / 编辑 / 合成）：capability `image.edit` → operation 按参考图数量反推：≥2 张 → `image_compose`，否则 `image_edit` → 产物 `ai_edited`

## Goal

将文生图、图编辑、多图合成统一到一个兼容旧画布的「图片生成」节点，按「所选模式 + 模型 manifest + 参考资源数量」自动区分 capability 与实际执行 operation，并保证模型参数、输入角色、任务 operation、输出归属与重试行为一致。

## Architecture

保留现有 `CanvasOperationType` 与旧节点数据结构（**不删枚举、不迁移旧画布**），扩展纯函数把「模型 manifest + 用户模式 + 参考图数量」映射为 capability、素材 assignment 与实际执行 operation。新建菜单仅创建 `text_to_image` 容器（标题「图片生成」）；历史 `text_to_image`/`image_edit`/`image_compose`/`image_to_image` 节点继续读取，所有图片节点展示当前模型支持的模式。节点运行时（含 retry）将实际 operation 传给任务创建链路，输出仍通过 `operationNodeId` 归属原节点。

## Tech Stack

TypeScript strict、React、Ant Design、Vitest、Electron renderer 本地 canvas API、MediaModelManifest。

## 兼容性策略（对齐视频 + 复核补充）

- 不删 `CanvasNodeType`/`CanvasOperationType`/`CANVAS_CAPABILITIES` 中任何图片条目；`operationNodeIcon`/`canvasOperationIcons`/`canvasNodeNaming` 保留图片 operation 图标与标签（`CanvasTask.operation` 运行时仍可能是 `image_edit`/`image_compose`/`image_to_image`）。
- 旧节点不写迁移脚本，靠 `UNIFIED_IMAGE_OPERATIONS` 在运行时共享同一 capability 池与面板；`legacyCanvasMediaInputMode` 为旧图片 operation 给出正确默认 mode（修复 B5）。
- 新字段（`mediaInputMode`/`capabilityId`）双读：优先显式值，缺失走兼容推断；新任务必须写入。
- **已知行为变化（B7，接受）**：`image_to_image` 角色身份板（喂基准图）反向映射后 1 图 → `image_edit` → 产物 `asset.source` 从 `ai_generated` 变为 `ai_edited`。这与「基于参考图生成」语义一致，接受此变化；若产品上需保留 `ai_generated`，在 `canvas.api.ts:6305-6308` 判定里把 `image_to_image` 历史值一并纳入 `ai_generated`（Task 6 提供开关式决策点）。

## Tasks

### Task 1: 图片统一模式纯函数 + legacy 默认 mode（复核修复 B5）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.test.ts`

- [ ] **Step 1: 写失败测试**——历史图片 operation 读取完整图片能力并集

```ts
for (const op of ['text_to_image','image_edit','image_compose','image_to_image'] as const) {
  expect(canvasMediaCapabilityIdsForOperation(op)).toEqual(['image.generate', 'image.edit'])
}
```

- [ ] **Step 2: 写失败测试**——`modeOptionsForCapability` 对 image.* 生成 text/reference

```ts
expect(modeOptionsForCapability(imageGenerateCap).map(o => o.mode)).toEqual(['text'])
expect(modeOptionsForCapability(imageEditCap).map(o => o.mode)).toEqual(['reference'])
// 同时声明两者的模型 → ['text','reference']
```

- [ ] **Step 3: 写失败测试**——capability + imageInputCount 反向映射 operation

```ts
expect(executionOperationForCanvasMediaCapability('image.generate', 'text_to_image')).toBe('text_to_image')
expect(executionOperationForCanvasMediaCapability('image.edit', 'image_edit', { imageInputCount: 1 })).toBe('image_edit')
expect(executionOperationForCanvasMediaCapability('image.edit', 'image_edit', { imageInputCount: 3 })).toBe('image_compose')
// 视频分支不受影响
expect(executionOperationForCanvasMediaCapability('video.edit', 'video_edit')).toBe('video_edit')
```

- [ ] **Step 4: 写失败测试（B5）**——旧图片 operation 默认 mode 不漂移到 text

```ts
expect(legacyCanvasMediaInputMode('image_edit')).toBe('reference')
expect(legacyCanvasMediaInputMode('image_compose')).toBe('reference')
expect(legacyCanvasMediaInputMode('image_to_image')).toBe('reference')
expect(legacyCanvasMediaInputMode('text_to_image')).toBe('text')
```

- [ ] **Step 5: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts` — Expected: FAIL。

- [ ] **Step 6: 实现**

1. 新增 `UNIFIED_IMAGE_OPERATIONS = new Set(['text_to_image','image_edit','image_compose','image_to_image'])`、`UNIFIED_IMAGE_CAPABILITY_IDS: MediaCapabilityId[] = ['image.generate','image.edit']`。
2. `canvasMediaCapabilityIdsForOperation`（:45-50）：图片 operation 返回 `[...UNIFIED_IMAGE_CAPABILITY_IDS]`（与视频分支并列）。
3. `modeOptionsForCapability`（:293-337）：新增 image 分支——`image.generate` → `[option('text','文生图')]`；`image.edit` → `[option('reference','图生图 / 编辑')]`。
4. `executionOperationForCanvasMediaCapability(capabilityId, fallback, options?: { imageInputCount?: number })`（:52-63）：保留视频分支；新增 `image.generate → 'text_to_image'`、`image.edit → (options?.imageInputCount ?? 0) >= 2 ? 'image_compose' : 'image_edit'`。
5. `legacyCanvasMediaInputMode`（:126-132）：新增图片分支（`image_edit`/`image_compose`/`image_to_image` → `'reference'`；`text_to_image` → `'text'`）。

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts` — Expected: PASS。

### Task 2: 校验改为 capability/mode 驱动（含视频回归保护）（复核修复 B6/I5，前移）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.test.ts`

- [ ] **Step 1: 写失败测试**——同容器节点 text/reference 模式校验规则不同；且视频不回归

```ts
// 图片 text 模式(image.generate)：requiresPrompt=true, requiresImage=false
// 图片 reference 模式(image.edit)：requiresPrompt=false, requiresImage=true
// 视频回归：capability=video.generate 提交时不被 requiresImage 阻断；capability=video.edit 无视频时失败
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasTaskSubmissionValidation.test.ts` — Expected: FAIL。

- [ ] **Step 3: 按 capability 命名空间分层判定**

`validateBasicMediaSubmission`（:198-246）把图片改为 capability-driven，视频分支不动；`capabilityId` 缺失时回退字面 operation（保护旧 retry/inline 边界）。伪代码：

```ts
const imageCapability = request.capabilityId?.startsWith('image.') ? request.capabilityId : undefined
const requiresPrompt = imageCapability
  ? imageCapability === 'image.generate'
  : videoCapability
    ? videoCapability === 'video.generate'
    : operationRequiresPrompt(request.operation)
const requiresImage = imageCapability
  ? imageCapability === 'image.edit'
  : videoCapability
    ? /* 维持视频既有判定 */ ...
    : operationRequiresImage(request.operation)
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- canvasTaskSubmissionValidation.test.ts` — Expected: PASS（含视频回归断言）。

### Task 3: 面板与提交链路反向映射（含 retry）（复核修复 B2/B8）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`（`selectedCapabilityId` 由 mode 推导，确认持久化点）
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

- [ ] **Step 1: 写失败测试**——统一节点 reference 模式按图数落 image_edit / image_compose；text 落 text_to_image

```ts
expect(runOperationNode(referenceOneImg)).toHaveCreatedTask(expect.objectContaining({ operation: 'image_edit', operationNodeId: 'image-node' }))
expect(runOperationNode(referenceMultiImg)).toHaveCreatedTask(expect.objectContaining({ operation: 'image_compose', operationNodeId: 'image-node' }))
expect(runOperationNode(textMode)).toHaveCreatedTask(expect.objectContaining({ operation: 'text_to_image', operationNodeId: 'image-node' }))
// retry 切换模式后 operation 随之改变（B8）
expect(retryAfterModeSwitch).toHaveCreatedTask(expect.objectContaining({ operation: 'text_to_image' }))
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.ts canvasOperationInheritance.test.ts` — Expected: FAIL。

- [ ] **Step 3: `imageInputCount` 从 `inputBindings` 统计（B2 关键修复）**

> 标准 UI 路径下 `params.inputFiles` 始终为 `undefined`（仅 retry/inline 传入）；唯一稳定来源是 `params.inputBindings`。

`canvas.api.ts:5144-5145` 改为：

```ts
const nodeOperation = (node.data.operation ?? node.type) as CanvasOperationType
const imageInputCount = (params.inputBindings ?? [])
  .filter((b) => b.enabled && b.kind === 'image').length
const operation = executionOperationForCanvasMediaCapability(
  params.capabilityId, nodeOperation,
  imageInputCount > 0 ? { imageInputCount } : undefined,
)
```

`createMediaTask`/IPC/`bindToNodeId` 保持不变（输出归属仍是原容器节点）。

- [ ] **Step 4: retry 路径接入反向映射（B8）**

`retryOperationNode`（`canvas.api.ts:4949-5076`，:5049 处 `operation: oldTask.operation`）改为：

```ts
const retryImageInputCount = (oldTask.inputBindings ?? [])
  .filter((b) => b.enabled && b.kind === 'image').length
const operation = executionOperationForCanvasMediaCapability(
  oldTask.capabilityId, oldTask.operation,
  retryImageInputCount > 0 ? { imageInputCount: retryImageInputCount } : undefined,
)
```

使模式切换后重试生效；`...pickCanvasPromptTaskFields(oldTask)` 已透传 `capabilityId`/`inputBindings`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.ts canvasOperationInheritance.test.ts` — Expected: PASS。

### Task 4: 配置器 UI 支持 2 模式（复核修复 I2/I4）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.test.tsx`

- [ ] **Step 1: 写失败测试**——图片节点渲染 2 模式胶囊、label 正确、超额图标灰

```ts
expect(options.map(o => o.label)).toEqual(['文生图', '图生图 / 编辑'])
expect(options.every(o => o.disabled === !modelSupports(o.capability))).toBe(true) // disabled 仅由 manifest 决定
// 超过 maxImages 的参考图标灰（is-unused）
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx` — Expected: FAIL（`VIDEO_GENERATION_MODES` 不含图片文案，`compactModeLabel` 写死视频文案）。

- [ ] **Step 3: 新增图片模式表 + 文案分支**

1. 新增 `IMAGE_GENERATION_MODES: Record<CanvasMediaInputMode,string> = { text:'文生图', reference:'图生图 / 编辑' }`。
2. `presentationModes`（:245-277）按节点 operation 族（`UNIFIED_IMAGE_OPERATIONS` vs `UNIFIED_VIDEO_OPERATIONS`）选表；图片模式 disabled 规则与视频一致——仅由 manifest 决定，缺素材只阻断提交。
3. **`compactModeLabel`（:289-296，I2 修复）**：改为接收 `option.label` 或按 capability 命名空间（image.* vs video.*）选文案，避免图片节点显示「文生视频」「全能参考」。
4. `reference` 模式素材编排沿用 `CanvasInputBinding` 托盘（rolePolicy 已 `all_reference`，超额由 `assignMediaInventory` used=false + 既有 `is-unused` class 标灰）。

- [ ] **Step 4: mask 角色决策（I4）**

评估所选 image.edit 模型 manifest 是否暴露 mask 角色；本期**维持现状（无 mask UI）**，mask 不进入 unified reference 模式（与原三节点行为一致）。在测试与文档记录此范围决策。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx` — Expected: PASS。

### Task 5a: 合并新建菜单入口

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.capabilities.ts`（仅扩 `text_to_image.inputTypes` 为宽入口）
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts`

- [ ] **Step 1: 写失败测试**——图片菜单只保留「图片生成」+「图片反推」

```ts
expect(imageGroup.items).toEqual([
  { operation: 'text_to_image', label: '图片生成', icon: 'Image' },
  { operation: 'image_prompt_reverse', label: '图片反推', icon: 'Image' },
])
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu.test.ts` — Expected: FAIL。

- [ ] **Step 3: 实现**

1. `canvasNodeGenerationMenu.ts:32-42` 图像组收敛为 `text_to_image`（label「图片生成」）+ `image_prompt_reverse`；移除 `image_edit`/`image_compose` 常用入口（`CANVAS_CAPABILITIES` 条目保留）。
2. `canvas.capabilities.ts:18-26` `text_to_image.inputTypes` 扩为 `['text','prompt','image']`（宽入口容器，对齐 `text_to_video`）。

- [ ] **Step 4: 运行确认通过** — Run 同上 — Expected: PASS。

### Task 5b: 内联快捷生成器全面 unified 化（复核修复 B3/B4/I1，最大盲区）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts`

> `CanvasInlineAiComposer` 有大量 `isUnifiedVideoOperation` 硬编码（B4 列出 12 处），必须逐一加图片等价分支，并用 `canvasMediaInputMode.ts` 的统一纯函数驱动。

- [ ] **Step 1: 写失败测试**

```ts
// 能力下拉只显示合并后的「图片生成」（B3）
expect(composerCapabilities.map(c => c.operation)).not.toContain('image_edit')
expect(composerCapabilities.map(c => c.operation)).not.toContain('image_compose')
// 内联：无图→text/image.generate/text_to_image；有图→reference/image.edit/(1图 image_edit|多图 image_compose)
// executionOperation 提交带 imageInputCount（B2 的内联对应点）
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter @spark/desktop test:unit -- CanvasInlineAiComposer.test.ts` — Expected: FAIL。

- [ ] **Step 3: 实现（逐行对照 B4 表）**

1. **`unifiedCanvasComposerCapabilities`（:90-119，B3）**：扩展为也合并图片——把 `capability.operation ∈ {text_to_image, image_edit, image_compose}` 合并为单一 `text_to_image`（label「图片生成」）。
2. **`LEGACY_VIDEO_OPERATIONS`（:90-95）+ `UNIFIED_VIDEO_MODE_CHOICES`（:96-106）**：新增 `LEGACY_IMAGE_OPERATIONS` 与 `UNIFIED_IMAGE_MODE_CHOICES = [{mode:'text',label:'文生图'},{mode:'reference',label:'图生图 / 编辑'}]`。
3. **`isUnifiedVideoOperation`（:336）泛化为 `isUnifiedMediaOperation`**：含 `text_to_image` 容器；下游所有 `isUnifiedVideoOperation` 三元（:337-343 mediaCapabilityIds、:385-407 unifiedVideoModeOptions/effectiveMediaInputMode、:421-424 selectedCapabilityId、:476-489 canSubmit、:829-855 inputRoles/inputNodeIds、:1072-1088 模式选择器渲染）改为对图片也生效——图片走 `canvasMediaCapabilityIdsForOperation`/`canvasMediaInputModeOptions`（Task 1 扩展后天然返回 image 并集与 2 模式）。
4. **`canRunUnifiedVideoFromMedia`（:121-127）泛化**：图片「有图 + mode≠text + 无 issue」即可跑 reference。
5. **`shouldAttachCanvasMediaInputTransport`（:129-135）**：图片 unified 在「有参考图」时同样附加 inputTransport。
6. **`executionOperation`（:790-793，B2 内联点）**：补 `imageInputCount`（从内联临时 binding 统计 image 数量）。
7. **`canRunFromInputOnly`/`operationNeedsImageInput`（:1484-1518，I1）**：明确分两子集——`UNIFIED_IMAGE_OPERATIONS_REQUIRING_IMAGE = {image_to_image,image_edit,image_compose}` 与 text-only `{text_to_image}`；**不可**把 `text_to_image` 误并入 needsImage。

- [ ] **Step 4: 运行确认通过** — Run 同上 — Expected: PASS。

### Task 6: 边角耦合点、产物标签与行为变化记录（复核修复 B1/B7）

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`（`asset.source` 分支确认/可选调整）
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasMediaCapabilitySelection.ts`（图片默认 mode 推断，若需）
- Modify: `apps/desktop/src/renderer/design/views/canvas/useCanvasMediaInputQuickActions.ts`（若图片统一节点需对齐）
- Test: 相关既有测试

- [ ] **Step 1: `asset.source` 与 B7 行为变化（B1 顺带确认）**

1. 回归覆盖：reference 1 图→`image_edit`→`ai_edited`；多图→`image_compose`→`ai_edited`；text→`text_to_image`→`ai_generated`。
2. **B1 修正**：`canvasTaskDefaults.ts:28-35` `IMAGE_GENERATION_OPERATIONS` **已存在**（含 text_to_image/image_to_image/image_edit/image_compose/storyboard_grid/panorama_360），四 operation 已共享「上次使用模型」缓存——**本期不新增**，仅补回归断言确认四 operation 返回同一 kind。
3. **B7 决策点**：`image_to_image` 角色身份板反向映射后产物 `asset.source` 由 `ai_generated` 变 `ai_edited`（默认接受）。若产品需保留旧标签，在 `canvas.api.ts:6305-6308` 把 `image_to_image` 历史值纳入 `ai_generated` 分支；此处留明确开关注释，由实现时与产品确认定夺。

- [ ] **Step 2: 默认 mode 推断与快捷动作**

`canvasMediaCapabilitySelection.ts`、`useCanvasMediaInputQuickActions.ts` 中按 operation 字面分支处，把图片统一节点归 `UNIFIED_IMAGE_OPERATIONS`；`shouldUseReferenceCapability` 若图片需要「按是否连图切 mode」补图片分支（无图→text，有图→reference；主体逻辑已由 Task 1 `legacyCanvasMediaInputMode` + `resolveCanvasMediaInputMode:114-119` 天然支持）。

- [ ] **Step 3: 运行相关测试**

Run: `pnpm --filter @spark/desktop test:unit -- useCanvasMediaInputQuickActions.test.ts canvasMediaCapabilitySelection.test.ts canvasTaskDefaults.test.ts canvasOperationPresets.test.ts` — Expected: PASS。

### Task 7: 回归、类型与真实 UI 验证

**Files:**
- Modify: `docs/design/canvas-unified-media-input-configurator.md`（追加图片章节 + 刷新状态/日期）
- Modify: `docs/superpowers/plans/2026-08-05-canvas-unified-image-node.md`

- [ ] **Step 1: 聚焦测试矩阵**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts canvasTaskSubmissionValidation.test.ts CanvasOperationPanel.test.ts canvasOperationInheritance.test.ts CanvasMediaInputConfigurator.test.tsx canvasNodeGenerationMenu.test.ts CanvasInlineAiComposer.test.ts canvasMediaCapabilitySelection.test.ts useCanvasMediaInputQuickActions.test.ts canvasMediaContract.test.ts canvasTaskDefaults.test.ts`

Expected: PASS，0 failures。

- [ ] **Step 2: desktop 类型检查**

Run: `pnpm -C apps/desktop run typecheck` — Expected: PASS；并行改动产生无关错误时记录归属并补定向检查。

- [ ] **Step 3: 真实 UI 验证（启动桌面端）**

覆盖：新建菜单图片组只剩「图片生成」+「图片反推」；图片生成节点显示 2 模式胶囊且可选性随模型变化；文生图走 image.generate、图生图编辑走 image.edit；单图/多图分别落 image_edit/image_compose；切换模式后参数 schema 重建；**切换模式后 retry 生效（B8）**；任务输出回写同一节点；历史 image_edit/image_compose/image_to_image 节点可打开运行且默认 mode 正确（B5）；角色身份板流程正常（B7）。

- [ ] **Step 4: 三轮复核**

第一轮逐项对照验收标准；第二轮检查 `git diff` 的 executionOperation/capabilityId/imageInputCount 与输入角色；第三轮从任务持久化与输出归属反向检查旧节点兼容与 retry 行为。

- [ ] **Step 5: 更新文档状态并刷新 GitNexus**

Run: `npx gitnexus analyze` — 若不可用按降级规则用 `rg`/测试/`git diff` 完成变更范围核对。

## 验收标准

- 新建菜单图片组仅暴露「图片生成」(`text_to_image` 容器) 与「图片反推」；`image_edit`/`image_compose` 不再作为常用入口。
- 内联快捷生成器能力下拉同步合并为「图片生成」（与新建菜单一致，B3）。
- 「图片生成」节点显示 2 模式选择器（文生图 / 图生图编辑）；模式可选性仅由模型 manifest 决定，缺素材只阻断提交。
- 文生图模式：capability `image.generate`、operation `text_to_image`、产物 `ai_generated`。
- 图生图编辑模式：capability `image.edit`；参考图 1 张 → `image_edit`，≥2 张 → `image_compose`（由 `inputBindings` 统计，B2）；产物 `ai_edited`。
- 模型清单显示 `image.generate ∪ image.edit` 并集。
- 历史 `text_to_image`/`image_edit`/`image_compose`/`image_to_image` 节点可打开/保存/运行/重试，默认 mode 不漂移（B5）；切换模式后重试 operation 随之改变（B8）。
- 切换模式/模型后参数 schema 正确重建；任务输出通过 `operationNodeId` 回写同一节点。
- 视频节点校验行为不回归（B6/I5）。
- `mediaInputMode`/`capabilityId` 双读：新任务写入显式值，旧任务缺失走兼容推断。
- renderer typecheck 0 错误；聚焦测试 0 failures。

## 风险与控制

属 HIGH 风险画布核心路径（与视频改造同级别）。

- TDD 逐 Task 推进，顺序：纯函数（Task 1）→ 校验（Task 2）→ 提交链路（Task 3）→ UI（Task 4）→ 菜单（5a）→ InlineComposer（5b）→ 边角（6）→ 回归（7）。
- **B2 关键**：`imageInputCount` 必须取自 `params.inputBindings`（标准路径 `inputFiles` 为 undefined），否则多图永远错路由成 `image_edit`——Task 3/5b 各有一处调用点。
- **B8 关键**：`retryOperationNode` 必须接入反向映射，否则模式切换后重试无效。
- **B6 关键**：校验改 capability 驱动须按 image/video 命名空间分层并保留 fallback，不得破坏已落地的视频路径。
- `executionOperationForCanvasMediaCapability` 签名扩展（新增可选 `options.imageInputCount`）唯一主调用点 `canvas.api.ts:5145` + 内联点 `CanvasInlineAiComposer.tsx:790` + retry 点 `canvas.api.ts:5049`；视频分支行为不变。
- 多 agent 并行开发：本任务涉及大量画布共享文件，须用 worktree 物理隔离，避免与它人改动互相覆盖（项目既定约束）。
- 不在同一 PR 删除任何旧兼容逻辑；新旧推导不一致时优先阻断静默发送并给出可操作提示。
- GitNexus 不可用时按降级规则用 `rg`、测试、`git diff` 完成影响核对。

## 复核问题追溯索引

B1（canvasTaskDefaults 已存在）→ Task 6 Step 1.2；B2（imageInputCount 来源）→ Task 3 Step 3 / Task 5b Step 3.6；B3（capability 合并）→ Task 5b Step 3.1；B4（InlineComposer 12 处）→ Task 5b；B5（legacy mode）→ Task 1 Step 4/6.5；B6（校验视频回归）→ Task 2；B7（asset.source 变化）→ Task 6 Step 1.3 + 兼容性策略；B8（retry）→ Task 3 Step 4；I1（needsImage 子集）→ Task 5b Step 3.7；I2（compactModeLabel）→ Task 4 Step 3.3；I3（Task 顺序）→ Tasks 编号；I4（mask）→ Task 4 Step 4；I5（视频回归）→ Task 2。
