# 画布节点内快捷操作、比例尺寸联动与参数聚合实施计划

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增参数入口和第二套状态的前提下，为节点补齐就地操作、让图片/视频任务节点响应画幅，并把现有常用参数配置聚合到同一面板。

**Architecture:** 继续以 `SchemaField[]`、`modelParamDraft` 和现有节点 actions 为唯一数据链路。参数改造集中在现有 `CanvasOperationParameterControls` / `CanvasParameterControl`；任务节点画幅复用当前未提交的 `canvasOperationNodePresentation` 展示尺寸层；文件替换和输入快捷动作拆入小型 helper/hook，避免继续扩大接近或超过 3000 行的面板与工作区文件。

**Tech Stack:** React 19、TypeScript、Ant Design、@lobehub/ui、XYFlow、Vitest/jsdom、LESS、GitNexus CLI。

---

## 文件结构

- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasOperationParameterControls.tsx`：把逐参数 Popover 收敛为现有容器内的单个常用参数聚合面板。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasOperationParameterControls.less`：参数预览行、聚合面板和单列常用参数样式。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.tsx`：连续时长与高频布尔参数的紧凑控件。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.less`：Slider、数值回显和二段式布尔控件样式。
- 修改 `apps/desktop/src/renderer/design/views/canvas/canvasOperationNodePresentation.ts`：在现有视频尺寸逻辑上补齐图片任务画幅。
- 新建 `apps/desktop/src/renderer/design/views/canvas/canvasNodeInlinePrimaryAction.ts`：空节点首要文字操作的纯展示模型。
- 新建 `apps/desktop/src/renderer/design/views/canvas/canvasMediaNodeReplacement.ts`：视频文件校验、落盘结果和节点尺寸/数据更新编排。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`：渲染空文本和空视频的节点内文字按钮；仅接线 actions。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`：透传视频替换 action。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`：只添加视频替换 helper 的最小接线，不在大文件内堆业务逻辑。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.tsx`：缺失任务输入时显示简单文字按钮与隐藏文件输入。
- 新建 `apps/desktop/src/renderer/design/views/canvas/useCanvasMediaInputQuickActions.ts`：把画布选择、上传后等待快照刷新、绑定节点的状态编排移出 `CanvasOperationPanel.tsx`。
- 修改 `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`：仅调用 quick-actions hook 并把回调传给现有输入配置器。
- 更新对应 `*.test.ts(x)` 与已确认设计文档状态。

### Task 1：聚合现有常用参数面板

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationParameterControls.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationParameterControls.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationParameterControls.less`

- [x] **Step 1: 写失败测试，要求一次打开全部常用参数**

```tsx
it('opens all common task parameters in the existing toolbar popover', async () => {
  renderControls([
    field('aspect_ratio', ['1:1', '16:9']),
    field('resolution', ['720P', '1080P']),
    field('duration', ['5', '10']),
  ])

  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="设置画幅"]')!.click(),
  )

  const panel = container.querySelector('.canvas-operation-common-parameters')
  expect(panel?.querySelector('[data-parameter-name="aspect_ratio"]')).not.toBeNull()
  expect(panel?.querySelector('[data-parameter-name="resolution"]')).not.toBeNull()
  expect(panel?.querySelector('[data-parameter-name="duration"]')).not.toBeNull()
  expect(container.querySelectorAll('.canvas-operation-parameter-overlay')).toHaveLength(1)
})
```

- [x] **Step 2: 运行测试并确认因仍是逐项 Popover 而失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationParameterControls.test.tsx`

Expected: FAIL，聚合面板不存在或只能找到当前单个字段。

- [x] **Step 3: 最小实现单一常用参数 Popover**

```tsx
const [commonOpen, setCommonOpen] = useState(false)

<Popover
  trigger="click"
  open={commonOpen}
  onOpenChange={setCommonOpen}
  overlayClassName="canvas-operation-parameter-overlay is-common"
  content={
    <div className="canvas-operation-common-parameters">
      {groups.common.map((presentation) => (
        <CanvasParameterControl
          key={presentation.field.name}
          presentation={presentation}
          value={values[presentation.field.name] ?? ''}
          onChange={(next) => onParameterChange(presentation.field.name, next)}
        />
      ))}
    </div>
  }
>
  <div className="canvas-operation-parameter-preview">
    {groups.common.map(renderExistingSummaryButton)}
  </div>
</Popover>
```

保留模型选择、现有摘要按钮、高级设置和 panel 变体；删除按字段维护的 `activeParameter`。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasOperationParameterControls.test.tsx`

Expected: PASS。

### Task 2：补齐图中常用参数控件形态

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.less`

- [x] **Step 1: 写失败测试覆盖连续时长和布尔分段按钮**

```tsx
it('renders bounded duration as a slider with numeric readout', async () => {
  const { container } = await renderControl(
    field('duration', [], 'integer', { minimum: 2, maximum: 15 }),
    '5',
  )
  expect(container.querySelector('[role="slider"]')).not.toBeNull()
  expect(container.querySelector('.canvas-parameter-range-value')?.textContent).toContain('5秒')
})

it('renders common booleans as explicit enabled and disabled choices', async () => {
  const { container, onChange } = await renderControl(
    field('generate_audio', [], 'boolean'),
    'false',
  )
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-param-value="true"]')!.click(),
  )
  expect(onChange).toHaveBeenCalledWith('true')
})
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasParameterControl.test.tsx`

Expected: FAIL，当前为数字 Input 和 Switch。

- [x] **Step 3: 实现最小 Slider 与二段式布尔控件**

```tsx
function BooleanOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  return (
    <div className="canvas-parameter-option-rail is-boolean" role="group">
      {[
        ['true', '开启'],
        ['false', '关闭'],
      ].map(([option, label]) => (
        <button
          key={option}
          type="button"
          data-param-value={option}
          aria-pressed={value === option}
          className={`canvas-parameter-option${value === option ? ' is-selected' : ''}`}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
```

只有 duration 同时具备有限 `minimum` / `maximum` 时使用 `Slider`；缺少可靠边界继续使用现有数字 Input。

- [x] **Step 4: 运行参数控件测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasParameterControl.test.tsx CanvasOperationParameterControls.test.tsx`

Expected: PASS。

### Task 3：补齐图片任务节点的画幅展示尺寸

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationNodePresentation.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationNodePresentation.ts`
- Reuse: `apps/desktop/src/renderer/design/views/canvas/canvasVideoNodePresentation.ts`

- [x] **Step 1: 在现有未提交测试上追加图片任务画幅用例**

```ts
it('uses the requested image ratio before the first output is available', () => {
  expect(
    operationNodePresentationSize(
      operationNode({
        type: 'text_to_image',
        data: { operation: 'text_to_image', modelParams: { aspect_ratio: '9:16' } },
      }),
      [],
    ),
  ).toEqual({ width: 460, height: 856 })
})

it('keeps auto ratios at the current operation size', () => {
  const node = operationNode({
    type: 'text_to_image',
    data: { operation: 'text_to_image', modelParams: { aspect_ratio: 'Auto' } },
  })
  expect(operationNodePresentationSize(node, [])).toEqual({ width: 460, height: 420 })
})
```

- [x] **Step 2: 运行并确认图片画幅用例失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasOperationNodePresentation.test.ts`

Expected: FAIL，图片任务仍保持默认 460×420。

- [x] **Step 3: 复用现有比例解析，补齐图片 operation 分支**

```ts
const configuredAspectRatio = readCanvasVideoAspectRatio(node.data.modelParams)
const outputTypes = nodeOperation(node)
  ? (getCanvasCapability(nodeOperation(node)!)?.outputTypes ?? [])
  : []
if (!output && configuredAspectRatio && outputTypes.includes('image')) {
  return {
    width: node.width,
    height: Math.round(node.width / configuredAspectRatio) + CANVAS_NODE_META_BAR_HEIGHT,
  }
}
```

不得覆盖已有视频、集合、分镜和真实产物尺寸逻辑；`Auto` 和非法值回退当前尺寸。

- [x] **Step 4: 运行尺寸相关测试**

Run: `pnpm --filter @spark/desktop test:unit -- canvasOperationNodePresentation.test.ts canvasVideoNodePresentation.test.ts canvasNodeSize.test.ts`

Expected: PASS。

### Task 4：空内容节点的简单文字按钮与视频替换

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasNodeInlinePrimaryAction.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasNodeInlinePrimaryAction.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasMediaNodeReplacement.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasMediaNodeReplacement.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`

- [x] **Step 1: 写失败纯函数测试定义空节点动作**

```ts
expect(canvasNodeInlinePrimaryAction(emptyTextNode())).toEqual({
  kind: 'edit',
  label: '编辑内容',
})
expect(canvasNodeInlinePrimaryAction(emptyVideoNode())).toEqual({
  kind: 'upload-video',
  label: '上传视频',
})
expect(canvasNodeInlinePrimaryAction(filledTextNode())).toBeNull()
```

- [x] **Step 2: 写失败视频替换 helper 测试**

```ts
await replaceCanvasVideoNode({ node, file, prepare, patchNode, updateNodeData })
expect(patchNode).toHaveBeenCalledWith(node.id, expect.objectContaining({ width: 500 }))
expect(updateNodeData).toHaveBeenCalledWith(
  node.id,
  expect.objectContaining({ url: 'safe-file://video.mp4', mimeType: 'video/mp4' }),
)
```

- [x] **Step 3: 运行新测试并确认缺少模块而失败**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeInlinePrimaryAction.test.ts canvasMediaNodeReplacement.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 4: 实现纯展示模型和视频替换 helper**

`canvasMediaNodeReplacement.ts` 负责文件类型校验、调用传入的 prepare、保持节点中心、计算视频尺寸、调用 patch/data callbacks；`CanvasWorkspaceView.tsx` 只保留一个 `useCallback` 接线。

- [x] **Step 5: 在 CanvasNode 渲染简单文字按钮**

```tsx
{
  inlinePrimaryAction ? (
    <button
      type="button"
      className="canvas-node-inline-primary-action nodrag nopan"
      onClick={(event) => runInlinePrimaryAction(event, inlinePrimaryAction)}
    >
      {inlinePrimaryAction.label}
    </button>
  ) : null
}
```

图片沿用现有“上传图片”；视频按钮通过局部隐藏 `input[type=file][accept="video/*"]` 把 File 交给 `actions.replaceVideo`；文本按钮调用现有 `editNode`。

- [x] **Step 6: 运行新测试和现有节点集成测试**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeInlinePrimaryAction.test.ts canvasMediaNodeReplacement.test.ts canvasVideoNodeDoubleClick.test.ts canvasUiuxV4Integration.test.ts`

Expected: PASS。

### Task 5：任务节点缺失输入时的“从画布选择 / 本地上传”

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasMediaInputConfigurator.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasMediaInputQuickActions.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasMediaInputQuickActions.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`

- [x] **Step 1: 写失败组件测试要求空输入区出现两个文字按钮**

```tsx
expect(container.querySelector('[aria-label="从画布选择输入素材"]')).not.toBeNull()
expect(container.querySelector('[aria-label="本地上传输入素材"]')).not.toBeNull()
```

按钮仅在 `assignments.length === 0` 且提供对应回调时显示；已有输入后不重复占位。

- [x] **Step 2: 写失败 hook 测试覆盖选择与上传后绑定**

```tsx
await result.current.pick()
expect(onAppendNode).toHaveBeenCalledWith(imageNode)

await result.current.upload(videoFile)
rerender({ nodes: [uploadedVideoNode] })
expect(onAppendNode).toHaveBeenCalledWith(uploadedVideoNode)
```

- [x] **Step 3: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx useCanvasMediaInputQuickActions.test.tsx`

Expected: FAIL，组件无按钮且 hook 不存在。

- [x] **Step 4: 实现输入区按钮与 quick-actions hook**

Hook 接收候选类型、`onRequestCanvasNodePick`、`onUploadLocalFile` 和 `onAppendNode`。上传返回的新节点若尚未出现在 snapshot，则暂存到 hook 内；snapshot 刷新后再绑定，避免 `reconcileCanvasInputBindings` 提前丢弃。

- [x] **Step 5: 在 CanvasOperationPanel 做最小接线**

```tsx
const mediaQuickActions = useCanvasMediaInputQuickActions({
  nodes: snapshot.nodes,
  acceptedKinds: selectedMediaInputKinds,
  onRequestCanvasNodePick,
  onUploadLocalFile,
  onAppendNode: (mediaNode) => {
    setSelectedInputNodeIds((current) => [...new Set([...current, mediaNode.id])])
    markConfigurationTouched()
  },
})
```

把 `mediaQuickActions.pick/upload` 传给 inline 和完整 panel 的现有 `CanvasMediaInputConfigurator`。

- [x] **Step 6: 运行输入绑定相关测试**

Run: `pnpm --filter @spark/desktop test:unit -- CanvasMediaInputConfigurator.test.tsx useCanvasMediaInputQuickActions.test.tsx canvasMediaInputMode.test.ts useCanvasInputBindings.test.tsx`

Expected: PASS。

### Task 6：回归、文档和 GitNexus 更新

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-canvas-node-inline-actions-and-parameter-aggregation-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-node-inline-actions-and-parameter-aggregation.md`

- [x] **Step 1: 运行相关画布测试集合**

Run:

```bash
pnpm --filter @spark/desktop test:unit -- \
  CanvasOperationParameterControls.test.tsx \
  CanvasParameterControl.test.tsx \
  CanvasMediaInputConfigurator.test.tsx \
  canvasOperationNodePresentation.test.ts \
  canvasNodeInlinePrimaryAction.test.ts \
  canvasMediaNodeReplacement.test.ts \
  useCanvasMediaInputQuickActions.test.tsx
```

Expected: PASS，输出无 React act 警告和未处理 Promise。

- [x] **Step 2: 运行静态验证**

Run:

```bash
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop lint
```

Expected: PASS。

- [x] **Step 3: 运行 desktop build**

Run: `pnpm --filter @spark/desktop build`

Expected: PASS。

- [x] **Step 4: 核对变更范围并刷新文档状态**

执行 `git diff --check`、直接调用点 `rg` 和 GitNexus detect-changes（CLI/MCP 可用时）。实现与验证完成后，把设计与计划文档状态改为 `已落地`，日期保持 `2026-08-01`。

- [x] **Step 5: 更新 GitNexus 索引**

Run:

```bash
node .gitnexus/run.cjs analyze
node .gitnexus/run.cjs status
```

Expected: 索引为最新；若 CLI/数据库异常，按仓库降级规则记录原因并以测试、`rg`、`git diff` 完成核对。

## 计划自检

- 需求覆盖：节点内文字按钮、任务输入选择/上传、图片/视频比例尺寸、现有参数面板聚合、Schema 语义不变均有对应任务。
- 文件边界：新增业务逻辑位于独立 helper/hook；`CanvasOperationPanel.tsx` 和 `CanvasWorkspaceView.tsx` 仅接线。
- 类型一致：节点动作传递 `File`；参数值保持字符串；媒体输入继续写入现有 binding 状态。
- 无占位实现：每项均给出目标文件、测试、失败原因、最小实现和验证命令。

## 实施验收

- 定向回归：13 个 Vitest 文件、94 项测试通过。
- 静态验证：desktop typecheck 通过；本次变更文件定向 ESLint 为 0 错误。全量 lint 仍受既有 `AppControlBridge.ts` 的 `no-useless-assignment` 错误影响，与本改造无关。
- 生产构建：desktop build 通过；migration 静态校验通过，better-sqlite3 的 Node ABI 干跑按构建脚本既有策略跳过。
- 视觉核验：本地预览端口未运行，未额外启动桌面进程；组件回归和生产构建已覆盖 DOM 结构与样式编译。
- 比例行为：画幅变更通过现有草稿自动保存链路一次性持久化节点尺寸；手动缩放后不持续覆盖，再次修改合法画幅时重新适配。
