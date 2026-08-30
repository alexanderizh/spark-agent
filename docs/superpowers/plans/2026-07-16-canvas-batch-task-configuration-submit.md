# Canvas Batch Task Configuration and Submit Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为画布任务节点增加单节点右键运行、多节点批量配置、参数草稿保存、整批校验、提交确认和全局跳过确认偏好。

**Architecture:** 使用纯模型层表示选择快照、共享补丁、节点覆盖和校验报告；使用独立控制器组合现有 `updateManyNodeData`、提示词编译和 `runOperationNode`；双栏面板只渲染控制器状态。`CanvasWorkspaceView.tsx` 仅挂载控制器和面板，单节点菜单与多选菜单分别沿用 `CanvasNode.tsx` 和 `CanvasStage.tsx` 的现有实际入口。

**Tech Stack:** React 19、TypeScript、Ant Design、LobeHub UI、Vitest、Electron renderer localStorage、现有 Canvas API/store。

---

## 当前代码约束

- `CanvasWorkspaceView.tsx` 约 9300 行，只允许增加 import、hook 调用、props 和面板挂载。
- `canvas.api.ts` 约 5600 行，已有 `updateManyNodeData` 和 `runOperationNode`，不新增批量 UI 状态。
- `CanvasOperationPanel.tsx` 约 2890 行，保持现有单节点编辑职责；共享运行准备逻辑放到新模块。
- 当前工作区已有未提交的媒体任务预校验改动，包括 `canvasTaskSubmissionValidation.ts`、`canvas.api.ts`、`CanvasOperationPanel.tsx` 和 `CanvasWorkspaceView.tsx`。实施时保留这些变更，不重写或回退。
- GitNexus MCP 当前未暴露。每个任务通过 `rg` 查找调用点、相关测试和 `git diff` 核对影响。
- `CanvasContextMenu.tsx` 当前没有生产调用；实际单节点菜单位于 `CanvasNode.tsx`，实际多选菜单位于 `CanvasStage.tsx`。本功能不接入未使用的平行菜单。

## 文件结构

### 新建

- `apps/desktop/src/renderer/design/views/canvas/canvasBatchTaskModel.ts`
  - 任务选区判定、按 operation 分组、共享值、脏字段补丁、节点更新和过期检测。
- `apps/desktop/src/renderer/design/views/canvas/canvasBatchTaskModel.test.ts`
  - 批量模型纯函数测试。
- `apps/desktop/src/renderer/design/views/canvas/canvasBatchSubmitPreferences.ts`
  - 全局跳过确认偏好的安全读写和变更事件。
- `apps/desktop/src/renderer/design/views/canvas/canvasBatchSubmitPreferences.test.ts`
  - 偏好默认值、持久化和异常降级测试。
- `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.ts`
  - 从已保存节点配置构建可校验、可运行的请求，供单节点和批量入口复用。
- `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.test.ts`
  - 输入节点、提示词、模型、参数和校验错误映射测试。
- `apps/desktop/src/renderer/design/views/canvas/useCanvasBatchTasks.ts`
  - 批量会话、保存、两阶段校验、确认偏好、受控提交和结果状态。
- `apps/desktop/src/renderer/design/views/canvas/useCanvasBatchTasks.test.tsx`
  - 控制器集成测试。
- `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.tsx`
  - 双栏配置态、确认态和结果态。
- `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.test.tsx`
  - 面板行为与可访问性测试。
- `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.less`
  - 面板布局、错误状态和窄屏适配。
- `apps/desktop/src/renderer/design/views/canvas/CanvasBatchSubmitPreferenceSetting.tsx`
  - 设置页“批量提交确认”开关。

### 修改

- `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
  - 任务节点右键“提交运行”动作。
- `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
  - 多选任务节点菜单项、禁用说明和处理器 props。
- `apps/desktop/src/renderer/design/views/canvas/canvasContextMenuModel.ts`
  - 扩展选择摘要中的批量任务可用状态。
- `apps/desktop/src/renderer/design/views/canvas/canvasContextMenuModel.test.ts`
  - 全任务、混合普通节点和混合 operation 的菜单判定。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
  - 调用 `useCanvasBatchTasks`，向 stage/node 传动作并挂载 panel。
- `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
  - 透传单节点运行 action 到 `CanvasNode`。
- `apps/desktop/src/renderer/design/views/SettingsView.tsx`
  - 在通用设置中挂载独立偏好设置组件。
- `apps/desktop/src/renderer/design/views/canvas/canvas.less`
  - 仅在现有 canvas 入口需要集中 import 时引入面板样式；优先由组件直接 import。
- `docs/superpowers/specs/2026-07-16-canvas-batch-task-configuration-submit-design.md`
  - 验证完成后更新状态为“已落地”。

## Task 1: 批量选择、补丁与偏好纯模型

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasBatchTaskModel.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasBatchTaskModel.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasBatchSubmitPreferences.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasBatchSubmitPreferences.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasContextMenuModel.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasContextMenuModel.test.ts`

- [ ] **Step 1: 编写批量模型失败测试**

覆盖以下行为：

```ts
it('enables batch actions only when every selected node is an operation node', () => {
  expect(summarizeBatchTaskSelection([operationNode('a'), operationNode('b')])).toMatchObject({
    canBatchConfigure: true,
    canBatchSubmit: true,
    reason: null,
  })
  expect(
    summarizeBatchTaskSelection([operationNode('a'), contentNode('b')]),
  ).toMatchObject({
    canBatchConfigure: false,
    canBatchSubmit: false,
    reason: '仅支持同时选择任务节点',
  })
})

it('applies only touched shared fields and preserves other node values', () => {
  const session = createCanvasBatchTaskSession([
    operationNode('a', { modelParams: { size: '1K', seed: 1 } }),
    operationNode('b', { modelParams: { size: '2K', seed: 2 } }),
  ])
  const patched = patchCanvasBatchTaskGroup(session, 'text_to_image', {
    touched: ['modelParams.size'],
    values: { modelParams: { size: '4K' } },
  })
  expect(buildCanvasBatchNodeUpdates(patched)).toEqual([
    { nodeId: 'a', data: { modelParams: { size: '4K', seed: 1 } } },
    { nodeId: 'b', data: { modelParams: { size: '4K', seed: 2 } } },
  ])
})

it('detects a stale node revision before submit', () => {
  const session = createCanvasBatchTaskSession([operationNode('a', {}, '2026-07-16T01:00:00Z')])
  expect(
    findStaleCanvasBatchNodeIds(
      session,
      [operationNode('a', {}, '2026-07-16T01:01:00Z')],
    ),
  ).toEqual(['a'])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasBatchTaskModel.test.ts canvasContextMenuModel.test.ts
```

Expected: FAIL，提示 `canvasBatchTaskModel` 模块或新增导出不存在。

- [ ] **Step 3: 实现批量会话模型**

核心类型和接口固定为：

```ts
export type CanvasBatchEditableData = Pick<
  CanvasNodeData,
  | 'agentId'
  | 'providerProfileId'
  | 'manifestId'
  | 'modelId'
  | 'reasoningEffort'
  | 'skillIds'
  | 'modelParams'
>

export type CanvasBatchTaskEntry = {
  nodeId: string
  title: string
  operation: CanvasOperationType
  baseUpdatedAt: string
  base: CanvasBatchEditableData
  draft: CanvasBatchEditableData
  touchedFields: Set<string>
}

export type CanvasBatchTaskSession = {
  entries: CanvasBatchTaskEntry[]
  activeOperation: CanvasOperationType
  activeNodeId: string | null
}

export function summarizeBatchTaskSelection(nodes: CanvasNode[]): {
  canBatchConfigure: boolean
  canBatchSubmit: boolean
  reason: string | null
  operationCount: number
}

export function createCanvasBatchTaskSession(nodes: CanvasNode[]): CanvasBatchTaskSession

export function patchCanvasBatchTaskGroup(
  session: CanvasBatchTaskSession,
  operation: CanvasOperationType,
  patch: { touched: string[]; values: CanvasBatchEditableData },
): CanvasBatchTaskSession

export function patchCanvasBatchTaskNode(
  session: CanvasBatchTaskSession,
  nodeId: string,
  patch: { touched: string[]; values: CanvasBatchEditableData },
): CanvasBatchTaskSession

export function buildCanvasBatchNodeUpdates(
  session: CanvasBatchTaskSession,
): Array<{ nodeId: string; data: Partial<CanvasNodeData> }>

export function findStaleCanvasBatchNodeIds(
  session: CanvasBatchTaskSession,
  currentNodes: CanvasNode[],
): string[]
```

`modelParams.<name>` 使用深一层合并；其他字段使用显式 touched field 覆盖。空字符串转为 `undefined`，以便现有 `updateManyNodeData` 删除清空字段。

- [ ] **Step 4: 扩展多选菜单摘要**

在 `CanvasSelectionContextSummary` 中增加：

```ts
canBatchConfigureTasks: boolean
canBatchSubmitTasks: boolean
batchTaskDisabledReason: string | null
batchTaskNodeIds: string[]
batchTaskOperationCount: number
```

`summarizeCanvasSelectionContext` 调用 `summarizeBatchTaskSelection`，不在 `CanvasStage.tsx` 重复节点类型判断。

- [ ] **Step 5: 编写偏好失败测试**

```ts
it('defaults to showing confirmation', () => {
  expect(readSkipCanvasBatchSubmitConfirmation(memoryStorage())).toBe(false)
})

it('persists and resets the global user preference', () => {
  const storage = memoryStorage()
  writeSkipCanvasBatchSubmitConfirmation(true, storage)
  expect(readSkipCanvasBatchSubmitConfirmation(storage)).toBe(true)
  writeSkipCanvasBatchSubmitConfirmation(false, storage)
  expect(readSkipCanvasBatchSubmitConfirmation(storage)).toBe(false)
})

it('fails closed when storage is unavailable', () => {
  expect(readSkipCanvasBatchSubmitConfirmation(throwingStorage)).toBe(false)
})
```

- [ ] **Step 6: 实现安全偏好读写**

```ts
export const CANVAS_BATCH_SUBMIT_CONFIRMATION_KEY =
  'spark-canvas:batch-submit:skip-confirmation:v1'
export const CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT =
  'spark-canvas:batch-submit-preference-changed'

export function readSkipCanvasBatchSubmitConfirmation(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage(),
): boolean

export function writeSkipCanvasBatchSubmitConfirmation(
  skip: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage(),
): void
```

读取或写入异常时使用安全默认值 `false`，不得阻止任务提交。写入后 dispatch 自定义事件，使设置页和已打开面板同步。

- [ ] **Step 7: 运行纯模型测试**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasBatchTaskModel.test.ts canvasBatchSubmitPreferences.test.ts canvasContextMenuModel.test.ts
```

Expected: PASS。

## Task 2: 从已保存节点构建运行请求并执行预校验

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [ ] **Step 1: 编写运行准备失败测试**

测试必须覆盖：

```ts
it('uses saved node runtime and connected input nodes', async () => {
  const prepared = await prepareSavedCanvasOperationSubmission({
    snapshot,
    node: operationNode,
  })
  expect(prepared).toMatchObject({
    nodeId: operationNode.id,
    params: {
      providerProfileId: 'provider-1',
      manifestId: 'manifest-1',
      modelId: 'model-1',
      inputNodeIds: ['input-1'],
      modelParams: { size: '2K' },
    },
  })
})

it('returns structured issues instead of submitting an invalid node', async () => {
  await expect(
    prepareSavedCanvasOperationSubmission({ snapshot: missingInputSnapshot, node }),
  ).rejects.toMatchObject({
    name: 'CanvasTaskValidationError',
    issues: [expect.objectContaining({ path: ['inputFiles'] })],
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasOperationSubmission.test.ts
```

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现共享运行准备器**

固定接口：

```ts
export type PreparedCanvasOperationSubmission = {
  nodeId: string
  operation: CanvasOperationType
  title: string
  params: Parameters<ReturnType<typeof useCanvasWorkspace>['runOperationNode']>[1]
}

export async function prepareSavedCanvasOperationSubmission(input: {
  snapshot: CanvasSnapshot
  node: CanvasNode
}): Promise<PreparedCanvasOperationSubmission>
```

实现顺序：

1. 使用 `isOperationNode` 拒绝普通节点。
2. 从 `used_as_input` edges 读取稳定顺序的输入节点 ID。
3. 使用 `node.data.promptDocument`；旧节点通过 `migrateLegacyPrompt` 迁移。
4. 使用 `buildCanvasPromptSubmission` 编译提示词并物化输入文件。
5. 从节点 data 和关联 task 读取 agent/provider/manifest/model/reasoning/skills/modelParams。
6. 使用 `validateCanvasTextTaskSubmission` 或 `validateCanvasMediaTaskSubmission` 做只读预校验。
7. 返回 `runOperationNode` 可直接接受的 params，不创建任务。

提取现有 `CanvasWorkspaceView` 普通 operation 分支中与请求准备相同的步骤，工作区保留特殊 `extract_character` / `extract_scene` workflow 分支。批量模型遇到这两个特殊 workflow 时返回节点级错误“该流水线任务需单独运行”，避免绕过现有专用处理。

- [ ] **Step 4: 让现有普通 operation 提交复用准备器**

在 `CanvasWorkspaceView.tsx` 的普通 operation `onRun` 分支中，用新准备器承载提示词编译、输入物化和预校验；保留 viewport、style preset、last-used preset、shot script 和特殊 workflow 的现有行为。

该步骤只做小范围替换，不移动大型组件主体。

- [ ] **Step 5: 运行准备器和现有提交回归测试**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasOperationSubmission.test.ts canvasTaskSubmissionValidation.test.ts canvasPromptSubmission.test.ts canvasOperationInheritance.test.ts
```

Expected: PASS。

## Task 3: 批量控制器

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasBatchTasks.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasBatchTasks.ts`

- [ ] **Step 1: 编写控制器失败测试**

使用 fake dependencies 测试：

```ts
it('saves all drafts once and never runs when save-only is selected', async () => {
  await controller.openConfigure(nodes)
  controller.patchGroup('text_to_image', patch)
  await controller.saveDrafts()
  expect(updateManyNodeData).toHaveBeenCalledTimes(1)
  expect(runOperationNode).not.toHaveBeenCalled()
})

it('forces the configuration panel when any preflight fails even if confirmation is skipped', async () => {
  readSkipConfirmation.mockReturnValue(true)
  prepareSubmission
    .mockResolvedValueOnce(validPrepared)
    .mockRejectedValueOnce(validationError)
  await controller.submit()
  expect(runOperationNode).not.toHaveBeenCalled()
  expect(controller.state.mode).toBe('configure')
  expect(controller.state.issues[0]?.nodeId).toBe('node-2')
})

it('opens confirmation for a valid batch and persists skip only on confirm', async () => {
  await controller.submit()
  expect(controller.state.mode).toBe('confirm')
  controller.setSkipNextConfirmation(true)
  expect(writeSkipConfirmation).not.toHaveBeenCalled()
  await controller.confirmSubmit()
  expect(writeSkipConfirmation).toHaveBeenCalledWith(true)
})

it('submits with bounded concurrency and retries only failed nodes', async () => {
  await controller.confirmSubmit()
  expect(controller.state.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: 'node-1', status: 'succeeded' }),
      expect.objectContaining({ nodeId: 'node-2', status: 'failed' }),
    ]),
  )
  await controller.retryFailed()
  expect(runOperationNode).toHaveBeenLastCalledWith('node-2', expect.anything())
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- useCanvasBatchTasks.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现控制器状态机**

固定状态：

```ts
export type CanvasBatchPanelMode = 'closed' | 'configure' | 'confirm' | 'submitting' | 'result'

export type CanvasBatchValidationIssue = {
  nodeId: string
  fieldPath: Array<string | number>
  message: string
}

export type CanvasBatchSubmitResult = {
  nodeId: string
  batchId: string
  status: 'succeeded' | 'failed'
  error?: string
}
```

固定入口：

```ts
openConfigure(nodeIds: string[]): void
openSubmit(nodeIds: string[]): Promise<void>
runSingle(nodeId: string): Promise<void>
patchGroup(operation: CanvasOperationType, patch: CanvasBatchPatch): void
patchNode(nodeId: string, patch: CanvasBatchPatch): void
saveDrafts(): Promise<void>
submit(): Promise<void>
confirmSubmit(): Promise<void>
retryFailed(): Promise<void>
close(): void
```

规则：

- `saveDrafts` 只调用一次 `updateManyNodeData`。
- `submit` 先保存草稿，再对所有节点运行 `prepareSavedCanvasOperationSubmission`。
- 任一预校验失败时不调用 `runOperationNode`。
- 合法且偏好为 false 时进入 `confirm`；偏好为 true 时直接提交。
- `confirmSubmit` 发请求前用 `updatedAt` 再检查过期节点。
- 受控并发固定为 3；实现一个局部 `runWithConcurrency`，不引入依赖。
- 同一批使用 `crypto.randomUUID()` 生成 `batchId`；结果状态持有该 ID。
- 当前 API 没有 batchId 字段时先用于 UI 结果关联，不修改 Provider payload。
- 单节点 `runSingle` 使用相同准备器和错误映射，但不读取批量确认偏好。

- [ ] **Step 4: 运行控制器测试**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- useCanvasBatchTasks.test.tsx
```

Expected: PASS。

## Task 4: 双栏批量配置、确认和结果面板

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasBatchTaskPanel.less`

- [ ] **Step 1: 编写面板失败测试**

```ts
it('renders operation groups and focuses the first invalid node', () => {
  renderPanel({ mode: 'configure', issues: [issueFor('video-1')] })
  expect(screen.getByRole('button', { name: /短视频.*缺少模型/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
})

it('keeps save draft separate from submit', async () => {
  renderPanel()
  await user.click(screen.getByRole('button', { name: '保存参数草稿' }))
  expect(onSaveDrafts).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()
})

it('does not persist skip confirmation when returning to edit', async () => {
  renderPanel({ mode: 'confirm' })
  await user.click(screen.getByRole('checkbox', { name: /下次不再确认/ }))
  await user.click(screen.getByRole('button', { name: '返回修改' }))
  expect(onConfirmSubmit).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- CanvasBatchTaskPanel.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现配置态**

组件只接受控制器 props：

```ts
export type CanvasBatchTaskPanelProps = {
  open: boolean
  mode: CanvasBatchPanelMode
  session: CanvasBatchTaskSession | null
  issues: CanvasBatchValidationIssue[]
  results: CanvasBatchSubmitResult[]
  submitting: boolean
  onSelectOperation: (operation: CanvasOperationType) => void
  onSelectNode: (nodeId: string | null) => void
  onPatchGroup: (operation: CanvasOperationType, patch: CanvasBatchPatch) => void
  onPatchNode: (nodeId: string, patch: CanvasBatchPatch) => void
  onSaveDrafts: () => Promise<void>
  onSubmit: () => Promise<void>
  onConfirmSubmit: () => Promise<void>
  onRetryFailed: () => Promise<void>
  onBackToConfigure: () => void
  onClose: () => void
}
```

配置态：

- 使用 Ant Design `Modal`，宽度约 `min(1040px, calc(100vw - 32px))`。
- 左栏按 operation 分组，显示节点数量、就绪/异常 badge 和搜索。
- 右栏为“类型共享参数 / 节点覆盖”切换。
- 媒体节点复用 `CanvasModelPicker`、`CanvasOperationParameterControls`。
- 文本节点复用 `AgentPickerInline`、`ProviderModelPickerInline`。
- 自定义参数以现有 `CustomParamDraft` 控件模式渲染。
- “多个值”使用空值提示，不把空值写入 touched fields。
- 错误节点置顶；点击错误定位右栏字段。
- 底部动作固定显示“保存参数草稿”“检查并提交”。

- [ ] **Step 4: 实现确认态和结果态**

确认态：

- 按 operation 展示节点数、模型和关键参数摘要。
- 复选框文案为“下次不再确认，校验通过后直接提交”。
- 辅助说明“对当前用户的所有项目生效，可在设置中恢复”。
- 只有点击“确认提交 N 个任务”时把 checkbox 值传给控制器。

结果态：

- 展示成功、失败数量和每个失败原因。
- 有失败项时显示“仅重试失败节点”。
- 提交中关闭面板只关闭 UI，不取消已发出的任务。

- [ ] **Step 5: 实现响应式与可访问性**

`CanvasBatchTaskPanel.less`：

- 宽屏两栏 `320px minmax(0, 1fr)`。
- 小于 720px 时改为上下布局。
- 左栏使用 `@tanstack/react-virtual` 虚拟化超过 50 个节点的列表。
- 错误状态包含图标和文本，不只依赖红色。
- 所有图标按钮提供 `aria-label`。
- `aria-live="polite"` 汇报保存、校验和提交结果。

- [ ] **Step 6: 运行组件测试**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- CanvasBatchTaskPanel.test.tsx CanvasOperationParameterControls.test.tsx CanvasModelPicker.test.tsx
```

Expected: PASS。

## Task 5: 单节点与多选右键接线

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [ ] **Step 1: 先扩展 action 类型和菜单测试**

`CanvasNodeActions` 增加：

```ts
runOperationNode?: (nodeId: string) => void
```

`CanvasStage` props 增加：

```ts
onRunOperationNode?: (nodeId: string) => void
onConfigureSelectedTasks?: (nodeIds: string[]) => void
onSubmitSelectedTasks?: (nodeIds: string[]) => void
```

通过现有模型测试和轻量渲染测试确认：

- operation node 单节点菜单包含“提交运行”。
- 多选全为 operation nodes 时显示“批量配置参数…”和“批量提交运行”。
- 混入普通节点时显示禁用项和 `title` 原因。

- [ ] **Step 2: 实现单节点菜单**

在 `CanvasNode.tsx` 的 operation node 菜单顶部加入：

```tsx
{
  key: 'run-operation',
  label: (
    <span className="canvas-menu-item">
      <Icons.Play size={14} /> 提交运行
    </span>
  ),
  disabled: node.data.status === 'running',
  onClick: () => actions.runOperationNode?.(node.id),
}
```

只对 `isOperationNode(node)` 渲染；运行中禁用。

- [ ] **Step 3: 实现多选菜单**

在 `CanvasStage.tsx` “选中节点”区域、复制动作之前渲染：

```tsx
<button
  type="button"
  role="menuitem"
  disabled={!selectedContext.canBatchConfigureTasks}
  title={selectedContext.batchTaskDisabledReason ?? undefined}
  onClick={() => {
    closePaneContextMenu()
    onConfigureSelectedTasks?.(selectedContext.batchTaskNodeIds)
  }}
>
  <Icons.Sliders size={14} />
  <span>批量配置参数…</span>
</button>
```

“批量提交运行”使用 `Icons.Play` 和 `onSubmitSelectedTasks`。不同 operation 类型保持启用。

- [ ] **Step 4: 在工作区挂载控制器**

`CanvasWorkspaceView.tsx` 只增加：

```ts
const batchTasks = useCanvasBatchTasks({
  snapshot,
  updateManyNodeData,
  runOperationNode,
})
```

向 `CanvasStage` 传：

```tsx
onRunOperationNode={(nodeId) => void batchTasks.runSingle(nodeId)}
onConfigureSelectedTasks={batchTasks.openConfigure}
onSubmitSelectedTasks={(nodeIds) => void batchTasks.openSubmit(nodeIds)}
```

在 `CanvasStage` 后挂载：

```tsx
<CanvasBatchTaskPanel {...batchTasks.panelProps} />
```

工作区不保存批量字段草稿、不实现并发队列、不复制 JSX。

- [ ] **Step 5: 运行菜单与工作区相关测试**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasContextMenuModel.test.ts CanvasBatchTaskPanel.test.tsx useCanvasBatchTasks.test.tsx
```

Expected: PASS。

## Task 6: 设置恢复、完整验证和文档状态

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasBatchSubmitPreferenceSetting.tsx`
- Modify: `apps/desktop/src/renderer/design/views/SettingsView.tsx`
- Modify: `docs/superpowers/specs/2026-07-16-canvas-batch-task-configuration-submit-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-canvas-batch-task-configuration-submit.md`

- [ ] **Step 1: 实现设置组件**

```tsx
export function CanvasBatchSubmitPreferenceSetting() {
  const [skip, setSkip] = useState(readSkipCanvasBatchSubmitConfirmation)

  useEffect(() => {
    const sync = () => setSkip(readSkipCanvasBatchSubmitConfirmation())
    window.addEventListener(CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT, sync)
    return () => window.removeEventListener(CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT, sync)
  }, [])

  return (
    <SettingsRow
      title="批量提交运行确认"
      desc="关闭后，画布任务批量校验通过时直接提交；校验失败仍会打开确认面板。"
      right={
        <Switch
          checked={!skip}
          onChange={(confirm) => {
            writeSkipCanvasBatchSubmitConfirmation(!confirm)
            setSkip(!confirm)
          }}
        />
      }
    />
  )
}
```

如果 `SettingsRow` 不是可导出组件，则让新组件只返回标题、说明和 Switch 内容，由 `SettingsView.tsx` 用现有 `SettingsRow` 包裹，避免移动 Settings 实现。

- [ ] **Step 2: 挂载到通用设置**

在 `GeneralSection` 的默认行为区域增加“批量提交运行确认”，默认开启。该改动只包含 import 和一个独立组件挂载。

- [ ] **Step 3: 运行定向测试与类型检查**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- canvasBatchTaskModel.test.ts canvasBatchSubmitPreferences.test.ts canvasOperationSubmission.test.ts useCanvasBatchTasks.test.tsx CanvasBatchTaskPanel.test.tsx canvasContextMenuModel.test.ts canvasTaskSubmissionValidation.test.ts canvasPromptSubmission.test.ts canvasOperationInheritance.test.ts
pnpm --filter @spark/desktop typecheck
```

Expected: 所有测试 PASS，typecheck 退出码 0。

- [ ] **Step 4: 运行 lint 和构建**

Run:

```powershell
pnpm --filter @spark/desktop lint
pnpm --filter @spark/desktop build
```

Expected: 退出码 0。若仓库存在与本功能无关的基线错误，记录完整文件和错误，不修改无关代码。

- [ ] **Step 5: 手动交互验证**

在 Electron 开发环境验证：

1. 单 operation node 右键“提交运行”。
2. 同类型两节点批量修改模型和一个参数，确认其他参数未被覆盖。
3. 混合图像/视频任务按类型配置并保存草稿，确认没有任务创建。
4. 合法批次进入确认态。
5. 勾选“下次不再确认”后，另一项目合法批次直接提交。
6. 在设置中恢复确认。
7. 跳过确认开启时制造一个缺模型或缺输入节点，确认整批阻止并定位错误。
8. 模拟一个提交失败，确认成功项保留且“仅重试失败节点”可用。

- [ ] **Step 6: 变更范围核对**

Run:

```powershell
rg -n "runOperationNode|updateManyNodeData|CanvasBatchTask" apps/desktop/src/renderer/design/views/canvas
git diff --check
git diff --stat
git status --short
```

Expected: 变更只覆盖计划列出的文件；现有媒体校验未提交修改保持存在且内容未回退。由于 GitNexus MCP 未暴露，本步骤替代 `gitnexus_detect_changes()`。

- [ ] **Step 7: 更新文档状态**

全部验证通过后：

- 将设计文档状态更新为 `已落地`，最后核对日期保持 `2026-07-16`。
- 将本计划状态更新为 `已落地`。
- 若仍有未完成验收项，状态保持 `实施中`，并在交付说明中列出具体缺口。

## 提交策略

当前工作区已有用户未提交修改，且与 `CanvasWorkspaceView.tsx`、`CanvasOperationPanel.tsx`、`canvas.api.ts` 重叠。实施期间不自动提交包含这些既有修改的文件。

可以安全单独提交的新增纯模块和测试按任务分组提交；涉及重叠文件的集成变更保持未提交，除非用户明确授权将当前相关工作一起提交。每次暂存前使用 `git diff --cached --name-only` 确认范围。

建议提交信息：

```text
feat(canvas): add batch task edit model
feat(canvas): add batch task confirmation panel
feat(canvas): wire task context menu submission
test(canvas): cover batch task workflows
docs(canvas): mark batch task workflow implemented
```

## 计划自检

- 设计中的单节点右键运行由 Task 2、3、5 覆盖。
- 同类型和混合类型批量配置由 Task 1、4 覆盖。
- 保存草稿不提交和一次历史操作由 Task 1、3 覆盖。
- 默认确认、全局跳过和设置恢复由 Task 1、3、4、6 覆盖。
- 异常强制打开面板和整批阻止由 Task 2、3、4 覆盖。
- 过期快照、受控并发和失败重试由 Task 1、3、4 覆盖。
- 大文件拆分和现有未提交修改保护由文件结构、Task 5 和提交策略覆盖。
- 未包含占位符或未定义的实现步骤。
