# Canvas Unified Video Node Implementation Plan

> 状态: 实施中 | 最后核对: 2026-08-02

## 后续修补（2026-08-02 追加）

统一节点落地后又发现并修复两处与素材输入相关的问题：

1. **「从画布选择」视频任务节点报错**：UI 校验只看 `node.type`，不认任务节点的产物。新增共享 `canvasNodeMediaKind.ts`（`buildOutputMediaKindMap` / `resolveCanvasNodeMediaKind` / `buildOutputMediaNodeMap` / `resolveEffectiveMediaSourceNode`），在 `useCanvasMediaInputQuickActions`、`useCanvasInputBindings` 中把「选任务节点」解析为「选它的产物 output 媒体节点」。因产物节点是真正的 `type:'video'` 节点且带 url，binding.kind、提交文件、输出归属全部沿用既有的「直接选产物节点」路径，无需改编译器。
2. **视频编辑 / 延长合并**：二者 manifest 与 provider 适配层同构（仅模型名后缀不同）。新增 `collapseVideoEditExtendOptions` 纯函数；`CanvasMediaInputConfigurator` 在模型同时支持两者时，下拉合并为一个「视频编辑 / 延长」条目并渲染动态子开关（编辑/延长），仅支持其一时保持原样。编辑/延长选择仍持久化在 `mediaInputMode`（'edit'/'extend'），向后兼容。

两处均有聚焦单测；未做真实界面验证（本会话 Electron/Computer Use 不可用）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文生、首帧、首尾帧、全能参考、视频编辑和视频延长统一到一个兼容旧画布的视频节点，并保证模型参数、输入角色、任务 operation 与输出归属一致。

**Architecture:** 保留现有 `CanvasOperationType` 和旧节点数据结构，新增纯函数把“模型 Manifest + 用户模式”映射为 capability、素材 assignment 与实际执行 operation。新建菜单仅创建 `text_to_video` 容器；历史视频节点继续读取，但所有视频节点都展示当前模型支持的六种模式。节点运行时将实际 operation 传给任务创建链路，输出仍通过 `operationNodeId` 归属原节点。

**Tech Stack:** TypeScript strict、React、Ant Design、Vitest、Electron renderer 本地 canvas API、MediaModelManifest。

---

### Task 1: 统一视频模式与执行类型纯函数

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.test.ts`

- [x] **Step 1: 写失败测试，证明所有历史视频 operation 都读取完整视频能力**

```ts
expect(canvasMediaInputModeOptions('video_edit', seedance2).map(({ mode }) => mode)).toEqual([
  'text', 'reference', 'first_frame', 'first_last_frame', 'edit', 'extend',
])
```

- [x] **Step 2: 运行测试并确认因 operation 白名单裁剪而失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts`

Expected: FAIL，`video_edit` 仅返回 `edit`。

- [x] **Step 3: 实现视频节点 capability 聚合和执行 operation 映射**

```ts
export function executionOperationForCanvasMediaCapability(
  capabilityId: MediaCapabilityId | undefined,
  fallback: CanvasOperationType,
): CanvasOperationType {
  if (capabilityId === 'video.image_to_video') return 'image_to_video'
  if (capabilityId === 'video.edit') return 'video_edit'
  if (capabilityId === 'video.extend') return 'video_extend'
  if (capabilityId === 'video.generate' || capabilityId === 'video.reference_to_video') {
    return 'text_to_video'
  }
  return fallback
}
```

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts`

Expected: PASS。

### Task 2: 分离模式可选性和素材完整性

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.test.tsx`

- [x] **Step 1: 写失败测试，证明空素材时模型支持的全能参考仍可选**

```ts
expect(referenceSelectOption).not.toHaveAttribute('disabled')
```

- [x] **Step 2: 运行测试并确认因 `canvasMediaInputModeIssue` 被用作 option disabled 而失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx`

Expected: FAIL，全能参考 option 带 disabled。

- [x] **Step 3: 只用 Manifest 是否存在决定模式禁用，保留当前模式 issue 作为提示与提交阻断**

```ts
return {
  value: mode,
  label,
  disabled: option == null,
  title: option?.capability.label ?? `当前模型不支持${label}模式`,
}
```

- [x] **Step 4: 运行配置器测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx`

Expected: PASS。

### Task 3: 编辑和延长支持多模态参考素材

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasMediaInputMode.test.ts`

- [x] **Step 1: 写失败测试，定义主视频与参考图片/视频/音频的 assignment**

```ts
expect(assignments).toEqual([
  expect.objectContaining({ sourceNodeId: 'source', role: 'input', used: true }),
  expect.objectContaining({ sourceNodeId: 'video-ref', role: 'reference', used: true }),
  expect.objectContaining({ sourceNodeId: 'image-ref', role: 'reference', used: true }),
  expect.objectContaining({ sourceNodeId: 'audio-ref', role: 'reference', used: true }),
])
```

- [x] **Step 2: 运行测试并确认视频/音频参考当前被排除而失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts`

Expected: FAIL，编辑仅使用主视频和参考图片，延长仅使用主视频。

- [x] **Step 3: 按 rolePolicy 和 maxImages/maxVideos/maxAudios 分配剩余参考素材**

实现共享的 reference 计数器；编辑/延长先占用第一段主视频，再处理剩余素材。更新 UI 引导文案，明确第一段视频为主体、灰色素材不发送。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts`

Expected: PASS。

### Task 4: 配置面板按所选模式执行实际 operation

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

- [x] **Step 1: 写失败测试，定义统一节点切换编辑模式后任务 operation 为 `video_edit`**

```ts
expect(runOperationNode).toHaveCreatedTask(
  expect.objectContaining({ operation: 'video_edit', operationNodeId: 'video-node' }),
)
```

- [x] **Step 2: 运行测试并确认任务仍沿用节点旧 operation 而失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.ts canvasOperationInheritance.test.ts`

Expected: FAIL，当前 `runOperationNode` 从 `node.data.operation ?? node.type` 取 operation。

- [x] **Step 3: 根据显式 capability 映射实际执行 operation，仅覆盖任务请求，不改变输出绑定节点 id**

```ts
const operation = params.executionOperation ?? nodeOperation
```

面板根据 `selectedCapabilityId` 计算该字段；草稿仍保存 `mediaInputMode/capabilityId`，创建任务继续传 `bindToNodeId: nodeId`。

- [x] **Step 4: 运行面板与 API 测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationPanel.test.ts canvasOperationInheritance.test.ts`

Expected: PASS。

### Task 5: 合并新建菜单和内联快捷生成器

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts`

- [x] **Step 1: 写失败测试，定义视频菜单只保留“视频生成”和“深度视频”**

```ts
expect(videoGroup.items).toEqual([
  { operation: 'text_to_video', label: '视频生成', icon: 'Video' },
  { operation: 'video_depth_map', label: '深度视频', icon: 'Video' },
])
```

- [x] **Step 2: 写失败测试，定义内联生成器使用同一模式映射 capability、inputRoles 和 operation**

内联输入将当前选中图片、视频、音频规范化为临时 binding；模式选择和 assignment 复用 `canvasMediaInputMode.ts`，提交 payload 带 `mediaInputMode`、`capabilityId` 与实际 operation。

- [x] **Step 3: 运行测试并确认旧四入口与 capability 首项选择导致失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu.test.ts CanvasInlineAiComposer.test.ts`

Expected: FAIL。

- [x] **Step 4: 实现菜单与快捷生成器统一并运行测试**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeGenerationMenu.test.ts CanvasInlineAiComposer.test.ts`

Expected: PASS。

### Task 6: 回归、类型与真实 UI 验证

**Files:**
- Modify: `docs/design/canvas-unified-media-input-configurator.md`
- Modify: `docs/superpowers/plans/2026-08-02-canvas-unified-video-node.md`

- [x] **Step 1: 运行聚焦测试矩阵**

Run: `pnpm --filter @spark/desktop test:unit -- canvasMediaInputMode.test.ts CanvasMediaInputConfigurator.test.tsx canvasNodeGenerationMenu.test.ts CanvasInlineAiComposer.test.ts CanvasOperationPanel.test.ts canvasMediaCapabilitySelection.test.ts canvasMediaContract.test.ts canvasOperationInheritance.test.ts`

Expected: PASS，0 failures。

- [x] **Step 2: 运行 desktop 类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS；若并行 Computer Use 改动产生无关错误，记录错误归属并补做本次文件的定向检查。

- [ ] **Step 3: 启动桌面端并验证 Seedance 2.x 六模式**

验证空节点可选全能参考、参考视频/音频槽位可用、编辑/延长主视频与参考角色正确、切换模式后参数 schema 更新、任务输出回写同一节点。

- [x] **Step 4: 三轮复核**

第一轮逐项对照验收标准；第二轮检查 `git diff` 的执行 operation、参数和输入角色；第三轮从任务持久化与输出归属反向检查旧节点兼容。

- [ ] **Step 5: 更新文档状态并刷新 GitNexus**

Run: `npx gitnexus analyze`

Expected: 索引更新成功；若 GitNexus 环境不可用，按项目降级规则记录原因，使用调用点检索、测试和 `git diff` 完成变更范围核对。
