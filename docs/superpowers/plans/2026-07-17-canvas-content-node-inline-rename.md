# 画布普通资产节点内联改名 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文本、分镜、剧本、图片、视频、音频、人物和组等普通画布节点都能点击底部工具栏标题原地改名。

**Architecture:** 新建独立的 `CanvasInlineNodeTitleEditor` 管理展示态、编辑草稿、键盘交互、异步保存和错误恢复，避免继续扩大超过 9000 行的工作区文件。`CanvasFloatingNodeToolbar` 仅负责为普通节点渲染该组件并把回调接到现有 `patchNodes`；操作节点继续使用原来的静态标题和“节点设置”。

**Tech Stack:** React 19、TypeScript、Ant Design Input/message、Vitest、jsdom、Less。

---

## 文件结构

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.tsx` — 独立的工具栏标题展示与异步内联编辑状态机。
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx` — 覆盖进入编辑、保存、取消、同步和失败重试。
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.less` — 内联标题组件的按钮态和输入态样式。
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts` — 锁定普通节点改名接线、操作节点分流和样式约束。
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx` — 导入组件、增加稳定改名回调并接入普通节点工具栏。
- Modify: `docs/superpowers/specs/2026-07-17-canvas-content-node-inline-rename-design.md` — 实施完成后更新为已落地。

### Task 1: 实现内联节点标题编辑组件

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx`

- [x] **Step 1: 写进入编辑、Enter/失焦保存和 Esc 取消的失败测试**

测试通过 React root 渲染组件，点击 `[aria-label="重命名节点"]` 后断言出现 `[aria-label="节点名称"]`，再分别触发 Enter、blur 和 Escape：

```tsx
it('enters edit mode and saves a normalized title on Enter', async () => {
  const mounted = await mountEditor({ title: '旧名称' })
  await click(mounted.renameButton())
  expect(mounted.input()).toBe(document.activeElement)
  await changeValue(mounted.input(), '  新名称  ')
  await pressKey(mounted.input(), 'Enter')
  expect(mounted.onRename).toHaveBeenCalledWith('新名称')
})

it('cancels on Escape without letting the following blur save', async () => {
  const mounted = await mountEditor({ title: '旧名称' })
  await click(mounted.renameButton())
  await changeValue(mounted.input(), '未保存名称')
  await pressKey(mounted.input(), 'Escape')
  expect(mounted.onRename).not.toHaveBeenCalled()
  expect(mounted.renameButton().textContent).toContain('旧名称')
})
```

- [x] **Step 2: 运行组件测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx`

Expected: FAIL，模块 `CanvasInlineNodeTitleEditor` 尚不存在。

- [x] **Step 3: 实现最小可用的展示态和编辑状态机**

组件接口固定为：

```tsx
export function CanvasInlineNodeTitleEditor({
  nodeId,
  title,
  fallbackTitle,
  onRename,
}: {
  nodeId: string
  title: string | null
  fallbackTitle: string
  onRename(title: string | null): Promise<void> | void
})
```

展示态渲染可聚焦按钮；点击、Enter 或 Space 后进入编辑。输入框使用 `ref` 在 `useLayoutEffect` 中执行 `focus()` 与 `select()`。`commit()` 将 `draft.trim() || null` 传给 `onRename`，未变化时直接退出；Escape 先设置跳过 blur 的 ref，再恢复已保存名称并退出。

- [x] **Step 4: 写空标题、重复提交、失败重试和外部标题同步测试**

```tsx
it('normalizes blank input to null and deduplicates Enter plus blur', async () => {
  const save = deferredRename()
  const mounted = await mountEditor({ title: '旧名称', onRename: save.fn })
  await click(mounted.renameButton())
  await changeValue(mounted.input(), '   ')
  await pressKey(mounted.input(), 'Enter')
  await blur(mounted.input())
  expect(save.fn).toHaveBeenCalledTimes(1)
  expect(save.fn).toHaveBeenCalledWith(null)
  save.resolve()
})

it('keeps the draft open after failure and allows retry', async () => {
  const onRename = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(undefined)
  const mounted = await mountEditor({ title: '旧名称', onRename })
  await click(mounted.renameButton())
  await changeValue(mounted.input(), '重试名称')
  await pressKey(mounted.input(), 'Enter')
  expect(mounted.input().value).toBe('重试名称')
  await pressKey(mounted.input(), 'Enter')
  expect(onRename).toHaveBeenCalledTimes(2)
})
```

重渲染测试分别确认：非编辑态接受新的 `title`；编辑态保留草稿；`nodeId` 改变时退出编辑并切换到新节点标题。

- [x] **Step 5: 完成异步与错误处理实现**

使用 `savingRef` 防止 Enter 与 blur 双重提交，`saving` 控制输入框禁用。失败时调用：

```tsx
message.error(error instanceof Error ? error.message : '保存节点名称失败')
```

失败后保持编辑状态和草稿；成功后更新已保存值并退出。用 mounted ref 阻止异步完成后更新已卸载组件。

- [x] **Step 6: 运行组件测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx`

Expected: PASS。

- [x] **Step 7: 提交独立组件与测试**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.tsx apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx
git commit -m "feat(canvas): add inline node title editor"
```

### Task 2: 接入普通节点工具栏和持久化回调

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts`

- [x] **Step 1: 写普通节点与操作节点分流的失败测试**

在现有源码集成测试中读取 `CanvasWorkspaceView.tsx`，断言工具栏声明包含 `onRenameNode`，普通节点分支包含 `<CanvasInlineNodeTitleEditor`，操作节点分支仍渲染 `operationTitle`：

```ts
expect(workspace).toContain('onRenameNode: (title: string | null) => Promise<void> | void')
expect(workspace).toContain('<CanvasInlineNodeTitleEditor')
expect(workspace).toContain('isOperation ? operationTitle')
expect(workspace).toContain("patchNodes([nodeId], { title })")
```

- [x] **Step 2: 运行集成测试并确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts`

Expected: FAIL，普通节点工具栏尚未接入内联标题组件。

- [x] **Step 3: 增加稳定改名回调**

在现有 `inlinePanelNodeRef` 稳定回调区新增：

```tsx
const renameInlinePanelNodeStable = useCallback(async (title: string | null) => {
  const nodeId = inlinePanelNodeRef.current?.id
  if (!nodeId) return
  await patchNodes([nodeId], { title })
}, [patchNodes])
```

并将它作为 `onRenameNode` 传给 `CanvasFloatingNodeToolbar`。回调始终读取 ref，确保异步交互不会把名称写到已切换的旧闭包节点。

- [x] **Step 4: 在普通节点标题分支接入组件**

为 `CanvasFloatingNodeToolbar` 增加：

```tsx
onRenameNode: (title: string | null) => Promise<void> | void
```

标题区域按节点类型分流：

```tsx
{isOperation ? (
  <span>{operationTitle}</span>
) : (
  <CanvasInlineNodeTitleEditor
    nodeId={node.id}
    title={node.title}
    fallbackTitle={title}
    onRename={onRenameNode}
  />
)}
```

所有文本、Prompt、剧本、分镜、图片、视频、音频、人物与组节点都经过非操作节点分支，因此无需为资产类型复制改名逻辑。

- [x] **Step 5: 运行组件和集成测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts`

Expected: PASS。

- [x] **Step 6: 提交工具栏接线**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx apps/desktop/src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts
git commit -m "feat(canvas): enable inline rename for content nodes"
```

### Task 3: 完成工具栏样式、回归验证和文档收尾

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.less`
- Modify: `docs/superpowers/specs/2026-07-17-canvas-content-node-inline-rename-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-canvas-content-node-inline-rename.md`

- [x] **Step 1: 增加工具栏标题按钮和输入框样式**

在组件同名 Less 文件中增加不改变工具栏高度的样式：

```less
.canvas-inline-node-title-trigger {
  min-width: 0;
  max-width: 100%;
  padding: 2px 4px;
  overflow: hidden;
  color: inherit;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: text;
}

.canvas-inline-node-title-input.ant-input {
  width: clamp(120px, 22vw, 260px);
  height: 28px;
  font-size: 12px;
}
```

按钮 hover/focus-visible 使用现有 `--border-strong` 和轻微表面色，保持暗色主题一致。

- [x] **Step 2: 运行定向测试、类型检查和 diff 检查**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx src/renderer/design/views/canvas/canvasInlineNodeRenameIntegration.test.ts src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

Expected: PASS。

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

Run: `git diff --check && git diff --stat`

Expected: 无空白错误；变更只包含内联改名组件、测试、最小工作区接线、样式和本功能文档。

- [x] **Step 3: 更新文档状态与计划勾选**

将设计文档状态更新为：

```markdown
> 状态: 已落地 | 最后核对: 2026-07-17
```

同步勾选本计划全部步骤，保留实施命令与结果作为交付记录。

- [x] **Step 4: 提交样式与文档收尾**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.less docs/superpowers/specs/2026-07-17-canvas-content-node-inline-rename-design.md docs/superpowers/plans/2026-07-17-canvas-content-node-inline-rename.md
git commit -m "docs(canvas): finish inline node rename rollout"
```

## 实施记录

- 组件测试先以缺少模块失败，接线测试先以缺少工具栏组件失败，样式测试先以缺少组件样式文件失败，随后分别转绿。
- 定向回归结果：4 个测试文件、18 个测试全部通过。
- `pnpm --filter @spark/desktop typecheck` 通过。
- GitNexus MCP 未在当前会话暴露，按仓库降级规则使用直接调用点检索、定向测试和 Git diff 完成影响核对。
- 工具栏接线与同一工作区已有导演台修改由并发进程共同提交为 `f7a55a893`；未回退或重写用户修改。
