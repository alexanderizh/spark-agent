# Canvas 多媒体产物节点缩略图切换器 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为选中的多图片或多视频操作节点增加位于节点下方、聚合全部历史运行的单行缩略图切换器，并与节点主预览和默认产物选择保持同步。

**Architecture:** 新建纯模型文件负责把 `CanvasOperationRunView[]` 展平为可预览图片/视频条目，新建 React 组件负责缩略项渲染、活动态、加载失败和滚动。`CanvasNode` 将运行/产物索引提升为受控状态，同时驱动现有 `OperationOutputDeck` 与新切换器；组件样式独立导入，不把更多规则堆入已很大的画布全局样式文件。

**Tech Stack:** React 19、TypeScript、@xyflow/react、Less、Vitest、react-dom test utilities。

---

### Task 1: 锁定跨历史运行的媒体聚合契约

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputThumbnails.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts`

- [x] **Step 1: 写聚合排序与过滤的失败测试**

```ts
expect(buildCanvasOperationMediaThumbnailItems(runs)).toEqual([
  { key: 'new:image-new', runIndex: 0, outputIndex: 1, output: imageNew, previewUrl: 'new.png' },
  { key: 'new:video-new', runIndex: 0, outputIndex: 2, output: videoNew, previewUrl: 'video.mp4' },
  { key: 'old:image-old', runIndex: 1, outputIndex: 0, output: imageOld, previewUrl: 'old-thumb.png' },
])
expect(buildCanvasOperationMediaThumbnailItems(singleMediaRun)).toHaveLength(1)
```

测试数据必须包含：最新运行中的文本产物、使用 `url` 的图片、使用 `thumbnailUrl` 的图片、带/不带 `thumbnailUrl` 的视频、最早运行的图片，以及没有 URL 的媒体产物。

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts`

Expected: FAIL，提示模块或 `buildCanvasOperationMediaThumbnailItems` 尚不存在。

- [x] **Step 3: 实现最小聚合模型**

```ts
export type CanvasOperationMediaThumbnailItem = {
  key: string
  runIndex: number
  outputIndex: number
  output: CanvasOperationOutputView
  previewUrl: string
}

export function buildCanvasOperationMediaThumbnailItems(
  runs: CanvasOperationRunView[],
): CanvasOperationMediaThumbnailItem[] {
  return runs.flatMap((run, runIndex) =>
    run.outputs.flatMap((output, outputIndex) => {
      const previewUrl = output.thumbnailUrl ?? output.url
      return (output.type === 'image' || output.type === 'video') && previewUrl
        ? [{ key: `${run.taskId}:${output.id}`, runIndex, outputIndex, output, previewUrl }]
        : []
    }),
  )
}
```

- [x] **Step 4: 运行测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts`

Expected: PASS，图片/视频按已有 runs 新到旧顺序展平，非媒体与无预览 URL 媒体被过滤。

### Task 2: 实现独立缩略图组件

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.less`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx`

- [x] **Step 1: 写显示条件、活动态与点击回调的失败测试**

```tsx
const onSelect = vi.fn()
root.render(
  <CanvasOperationOutputThumbnailSwitcher
    items={items}
    activeOutputId="image-old"
    onSelect={onSelect}
  />,
)
expect(container.querySelectorAll('[data-output-thumbnail-id]')).toHaveLength(2)
expect(container.querySelector('[aria-current="true"]')?.getAttribute('data-output-thumbnail-id'))
  .toBe('image-old')
button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
expect(onSelect).toHaveBeenCalledWith(items[0])
```

另加测试：不足 2 项时返回空内容；图片与视频分别渲染正确媒体元素；触发媒体 `error` 后出现类型对应的占位图标且按钮仍可点击。

- [x] **Step 2: 运行组件测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx`

Expected: FAIL，提示组件模块尚不存在。

- [x] **Step 3: 实现组件结构与交互**

```tsx
export function CanvasOperationOutputThumbnailSwitcher({ items, activeOutputId, onSelect }: Props) {
  if (items.length < 2) return null
  return (
    <div className="canvas-operation-output-thumbnail-switcher nodrag nopan nowheel" aria-label="历史媒体产物">
      <div className="canvas-operation-output-thumbnail-track">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            data-output-thumbnail-id={item.output.id}
            aria-current={item.output.id === activeOutputId ? 'true' : undefined}
            onClick={(event) => { event.stopPropagation(); onSelect(item) }}
          >
            {item.output.type === 'video' && !item.output.thumbnailUrl
              ? <video src={normalizeEduAssetUrl(item.previewUrl)} muted preload="metadata" />
              : <img src={normalizeEduAssetUrl(item.previewUrl)} alt={item.output.title} />}
          </button>
        ))}
      </div>
    </div>
  )
}
```

实现中使用每项本地错误集合切换 `Icons.Image` / `Icons.Play` 占位；活动项 ref 在 `useEffect` 中调用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`。

- [x] **Step 4: 添加节点外单行样式**

```less
.canvas-operation-output-thumbnail-switcher {
  position: absolute;
  top: calc(100% + 12px);
  left: 50%;
  z-index: 12;
  width: 80%;
  transform: translateX(-50%);
}

.canvas-operation-output-thumbnail-track {
  display: flex;
  overflow-x: auto;
  flex-wrap: nowrap;
  scrollbar-width: none;
}
```

补齐主题表面色、大圆角、间距、固定缩略图尺寸、`object-fit: cover`、活动项底座、焦点环和 WebKit 滚动条隐藏。

- [x] **Step 5: 运行组件测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx`

Expected: PASS，无 React `act` 警告。

### Task 3: 将节点预览改为受控选择并接入切换器

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasUiuxV4Integration.test.ts`

- [x] **Step 1: 写节点集成失败断言**

```ts
expect(nodeSource).toContain('<CanvasOperationOutputThumbnailSwitcher')
expect(nodeSource).toContain('selected && operationOutputState.mode !== \'collection\'')
expect(nodeSource).toContain('runIndex={operationSelection.runIndex}')
expect(nodeSource).not.toContain('canvas-operation-output-dots')
```

同时断言切换器位于 `.canvas-node-core` 之后、source Handle 之前，保证它不会被 core 裁切。

- [x] **Step 2: 运行集成测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasUiuxV4Integration.test.ts`

Expected: FAIL，缺少切换器接入和受控索引。

- [x] **Step 3: 提升并同步运行/产物选择状态**

```tsx
const [operationSelection, setOperationSelection] = useState(() => ({
  runIndex: Math.max(0, operationOutputState.primaryRunIndex),
  outputIndex: Math.max(0, operationOutputState.primaryOutputIndex),
}))

useEffect(() => {
  setOperationSelection({
    runIndex: Math.max(0, operationOutputState.primaryRunIndex),
    outputIndex: Math.max(0, operationOutputState.primaryOutputIndex),
  })
}, [operationRunsFingerprint, operationOutputState.primaryRunIndex, operationOutputState.primaryOutputIndex])
```

从 `CanvasFlowNodeData` 解构 `operationRunsFingerprint = ''`。把 `OperationOutputDeck` 的 `useState`/同步 effect 移除，增加 `runIndex`、`outputIndex`、`onSelectCoordinates` 受控 props。运行按钮切换时选择该运行首个产物；所有选择路径复用一个 `selectOperationOutput(runIndex, outputIndex, output)` 回调并写回主产物。活动产物按受控坐标派生：

```ts
const activeOperationOutput =
  operationRuns[operationSelection.runIndex]?.outputs[operationSelection.outputIndex]
```

- [x] **Step 4: 在节点卡片外接入缩略图组件**

```tsx
{selected &&
operationOutputState.mode !== 'collection' &&
operationOutputState.mode !== 'bundle' ? (
  <CanvasOperationOutputThumbnailSwitcher
    items={operationMediaThumbnails}
    activeOutputId={activeOperationOutput?.id}
    onSelect={(item) => selectOperationOutput(item.runIndex, item.outputIndex, item.output)}
  />
) : null}
```

组件必须与 `.canvas-node-core` 同级，并保留现有工作区中的视频双击 `preventDefault` 改动。删除节点内部产物圆点 JSX，但保留运行历史左右按钮。

- [x] **Step 5: 运行模型、组件和集成测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx src/renderer/design/views/canvas/canvasUiuxV4Integration.test.ts`

Expected: PASS。

### Task 4: 验证、文档保鲜和变更范围核对

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-canvas-operation-output-thumbnail-switcher-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-operation-output-thumbnail-switcher.md`

- [x] **Step 1: 运行相关回归测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx src/renderer/design/views/canvas/CanvasOperationOutputPreview.test.tsx src/renderer/design/views/canvas/canvasUiuxV4Integration.test.ts src/renderer/design/views/canvas/canvasWheelInteraction.test.ts`

Expected: PASS，0 failures。

实际结果：本功能及视频节点尺寸相关 6 个测试文件共 22 个测试通过；`canvasUiuxV4Integration.test.ts` 的新增目标用例通过。该文件全量运行仍有一个工作区既有失败：底部 Agent 图标实现为 14px，旧断言仍要求 15px，与本功能无关。

- [x] **Step 2: 运行静态验证**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: exit 0。

Run: `pnpm exec eslint apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.tsx apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputThumbnails.ts apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputThumbnailSwitcher.test.tsx apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputThumbnails.test.ts`

Expected: exit 0，无 error。

实际结果：桌面端类型检查 exit 0；目标 ESLint 为 0 error，`CanvasNode.tsx` 保留 12 条既有 warning。

- [x] **Step 3: 核对工作区和 GitNexus 影响范围**

Run: `git diff --check`

Expected: exit 0。

执行 `gitnexus_detect_changes`；若 MCP 不可用，则按项目降级规则使用 `rg` 检索直接调用点并检查 `git diff --stat`、目标测试结果。随后运行 `npx gitnexus analyze` 更新索引记录。

- [x] **Step 4: 更新文档状态**

把设计文档和本计划的状态更新为：

```md
> 状态: 已落地 | 最后核对: 2026-08-01
```

- [x] **Step 5: 最终复验**

再次运行 Task 4 Step 1 的完整回归命令、`pnpm --filter @spark/desktop typecheck` 与 `git diff --check`，确认文档状态变化之后仍为最新验证证据。

### 追加修复：溢出导航按钮

- [x] 添加失败测试，复现隐藏滚动条后没有可见导航入口的问题。
- [x] 在内容溢出时显示左右按钮，并同步首尾禁用状态。
- [x] 点击按钮按轨道可视宽度约 80% 平滑滚动。
- [x] 使用滚动事件、`ResizeObserver` 和窗口 resize 更新可滚动状态。
