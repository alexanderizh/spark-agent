# 画布提示词插入菜单与节点改名 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为操作节点增加独立的自动保存改名 Tab，并把提示词“+”与 `@` 统一为带搜索、角色/场景筛选和外置悬浮预览的插入菜单。

**Architecture:** 工作台只负责节点级名称设置，任务面板继续负责运行参数；两者通过独立的 rename callback 避免任务草稿覆盖节点名称。提示词编辑器抽出 `CanvasPromptInsertMenu`，工具栏与 Lexical typeahead 共享同一菜单展示、过滤和预览逻辑，仅保留各自的锚点与插入位置控制。

**Tech Stack:** React 19、TypeScript、Lexical、Ant Design、Vitest、Less。

---

### Task 1: 扩展工作台状态并新增节点设置 Tab

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchState.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchState.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationNodeSettings.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less`

- [x] **Step 1: 写工作台 Tab 与名称提交的失败测试**

在 reducer 测试中断言 `'settings'` 可被选择且在无产物时不会被重置；在组件测试中挂载名称输入框，覆盖 Enter、blur、Esc、空白值、未变化不提交和失败后保留草稿：

```tsx
it('saves a changed title on Enter and skips unchanged blur', async () => {
  const onRename = vi.fn().mockResolvedValue(undefined)
  const mounted = await mountSettings({ title: '旧名称', onRename })
  await changeValue(mounted.input, '新名称')
  await pressKey(mounted.input, 'Enter')
  expect(onRename).toHaveBeenCalledWith('新名称')
  mounted.input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
  expect(onRename).toHaveBeenCalledTimes(1)
})

it('restores the saved title on Escape', async () => {
  const mounted = await mountSettings({ title: '旧名称', onRename: vi.fn() })
  await changeValue(mounted.input, '未保存名称')
  await pressKey(mounted.input, 'Escape')
  expect(mounted.input.value).toBe('旧名称')
})
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasOperationWorkbenchState.test.ts src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx`

Expected: FAIL，原因是 `'settings'` 类型和 `CanvasOperationNodeSettings` 尚不存在。

- [x] **Step 3: 实现节点设置组件与工作台入口**

将 Tab 联合类型扩展为：

```ts
export type CanvasOperationWorkbenchTab = 'output' | 'history' | 'config' | 'settings'
```

无产物状态允许 `config` 和 `settings` 保持选中；只把 `output` / `history` 回退到 `config`。新增组件接口：

```tsx
export function CanvasOperationNodeSettings({
  nodeId,
  title,
  disabled = false,
  onRename,
}: {
  nodeId: string
  title: string | null
  disabled?: boolean
  onRename(title: string | null): Promise<void> | void
})
```

组件使用本地 `draft`、`savedTitle` 和 `saving` 状态；`commit()` 将 trim 后的空字符串转为 `null`，成功后更新 savedTitle，失败时调用 `message.error` 且保留 draft。工作台按顺序渲染：

```tsx
{
  tabButton('output', '产物', <Icons.File size={13} />, outputCount)
}
{
  tabButton('history', '运行历史', <Icons.RotateCcw size={13} />, runs.length)
}
{
  tabButton('config', '任务配置', <Icons.Settings size={13} />)
}
{
  tabButton('settings', '节点设置', <Icons.Edit size={13} />)
}
```

`output` / `history` 在无产物时禁用，`config` / `settings` 始终可用。内容区在 settings 时渲染节点设置组件。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasOperationWorkbenchState.test.ts src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx`

Expected: PASS。

### Task 2: 接入节点改名持久化并移除任务配置中的重复标题

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.ts`

- [x] **Step 1: 写任务配置不再编辑标题的失败测试**

为 `CanvasOperationPanel` 增加断言：任务配置只出现“备注 / 展示文本”，不存在标题输入；保存草稿时 `title` 取最新 `node.title`：

```tsx
expect(container.querySelector('input[placeholder$="节点"]')).toBeNull()
await clickSave(container)
expect(onSaveDraft).toHaveBeenCalledWith(
  expect.objectContaining({ title: '已保存节点名称', message: '节点说明' }),
)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasOperationPanel.test.ts`

Expected: FAIL，当前面板仍渲染标题字段。

- [x] **Step 3: 接入 rename callback 并精简任务面板**

为工作台增加：

```ts
onRenameNode(title: string | null): Promise<void> | void
```

工作区传入只更新节点 patch 的回调：

```tsx
onRenameNode={async (title) => {
  await patchNodes([opNode.id], { title })
}}
```

从 `CanvasOperationPanel` 删除 `titleDraft` 状态及两处标题输入；inline 模式保留备注输入，panel 模式的“节点信息”收敛为单个备注字段。`handleSaveDraft` 保持协议兼容，但传递 `title: node.title?.trim() || null`，防止保存任务配置覆盖已改名节点。

- [x] **Step 4: 运行工作台与任务面板测试**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasOperationPanel.test.ts src/renderer/design/views/canvas/canvasOperationWorkbenchState.test.ts src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx`

Expected: PASS。

### Task 3: 抽出可搜索、可筛选、可预览的统一插入菜单

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptInsertMenu.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptInsertMenuModel.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptInsertMenu.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptLexicalNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptComposer.less`

- [x] **Step 1: 写过滤、快捷宫格、预览和外部关闭的失败测试**

覆盖名称/正文搜索、角色/场景切换、五个快捷项、文本预览、图片预览、鼠标离开隐藏预览以及 document pointerdown 关闭：

```tsx
it('combines search with the character filter', async () => {
  const mounted = await mountMenu({ items: [characterItem, sceneItem, textItem] })
  await clickByText(mounted.container, '添加角色')
  await changeValue(mounted.search, '小满')
  expect(resultLabels(mounted.container)).toEqual(['小满'])
})

it('opens a text preview beside the highlighted item', async () => {
  const mounted = await mountMenu({ items: [textItem] })
  mounted.result.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  expect(mounted.container.querySelector('.canvas-prompt-insert-preview')?.textContent).toContain(
    '镜头从门口推进',
  )
})

it('requests close after an outside pointer down', async () => {
  const onRequestClose = vi.fn()
  await mountMenu({ items: [textItem], onRequestClose })
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(onRequestClose).toHaveBeenCalledOnce()
})
```

- [x] **Step 2: 运行菜单测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasPromptInsertMenu.test.tsx`

Expected: FAIL，菜单组件尚不存在。

- [x] **Step 3: 实现菜单模型与外置预览**

导出并复用 `CanvasPromptLexicalNode` 中的文本/媒体预览 helpers。新组件接口：

```tsx
export type CanvasPromptInsertFilter = 'all' | 'character' | 'scene'

export function CanvasPromptInsertMenu({
  items,
  assetById,
  query,
  selectedIndex,
  onQueryChange,
  onHighlight,
  onInsertParameter,
  onInsertReference,
  onRequestClose,
}: CanvasPromptInsertMenuProps)
```

过滤规则使用 label、`canvasPromptNodeTypeLabel(node)` 与 `previewCanvasPromptNodeContent(node, assetById)` 的小写文本；角色、场景按 `node.data.pipelineRole` 判断。预览定位读取菜单矩形与 `window.innerWidth`：

```ts
const previewSide = menuRect.right + PREVIEW_WIDTH + 12 <= window.innerWidth ? 'right' : 'left'
```

菜单根元素监听捕获阶段 pointerdown 边界；document listener 仅在目标不属于菜单、预览或传入 trigger element 时请求关闭。搜索框处理 ArrowUp、ArrowDown、Enter 和 Escape，并调用统一高亮/选择回调。

- [x] **Step 4: 添加紧凑五宫格、滚动列表和左右预览样式**

Less 使用 320px 主菜单、260px 预览、`grid-template-columns: repeat(5, minmax(0, 1fr))`；结果区 `max-height: 260px; overflow-y: auto`。预览通过 `.is-left` / `.is-right` 放置在主菜单外侧，并为正文设置 `max-height: 280px; overflow-y: auto`。

- [x] **Step 5: 运行菜单测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasPromptInsertMenu.test.tsx`

Expected: PASS。

### Task 4: 让“+”与 `@` 复用统一菜单

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptComposer.less`

- [x] **Step 1: 写统一菜单与关闭行为的失败测试**

扩展现有编辑器测试：点击“+”和输入 `@` 都出现 `.canvas-prompt-insert-menu`；`@门口` 将搜索值设为“门口”；两种入口均支持搜索后插入；外部 pointerdown 与 Esc 关闭；结果超过可视数量时列表仍为滚动容器。

```tsx
it('uses the shared insert menu for toolbar and mention triggers', async () => {
  const mounted = await mountComposer({ version: 2, blocks: [] }, [textNode()])
  await clickAdd(mounted.container)
  expect(mounted.container.querySelector('.canvas-prompt-insert-menu')).not.toBeNull()
  await closeWithEscape()
  await replaceEditorText(mounted.getEditor(), '@门口')
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索节点与资源"]')?.value).toBe(
    '门口',
  )
})
```

- [x] **Step 2: 运行编辑器测试并确认失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx`

Expected: FAIL，当前两个入口仍使用不同菜单 DOM。

- [x] **Step 3: 替换工具栏旧菜单**

`CanvasPromptToolbar` 使用共享组件，保留 `insertParameter` / `insertReference`。删除旧的 `InsertMenuButton` 与 `.canvas-prompt-parameter-menu` DOM；工具栏用 trigger ref 传入外部点击边界。打开时重置 query 和 highlighted index。

- [x] **Step 4: 替换 Lexical mention 菜单并保持插入位置**

`CanvasPromptMentionPlugin` 保留 `LexicalTypeaheadMenuPlugin` 负责锚点、文本节点切分和编辑器命令，`menuRenderFn` 改为渲染共享组件。`onQueryChange` 同步菜单 query；搜索框 ArrowUp/ArrowDown/Enter 调用 Lexical menu props；外部点击通过：

```ts
onRequestClose={() => editor.dispatchCommand(KEY_ESCAPE_COMMAND, undefined)}
```

选择时继续删除 `textNodeContainingQuery`、插入 `CanvasPromptAtomicNode` 并 `node.selectNext()`，保证 `@` 文本不会残留且引用插入原位置。

- [x] **Step 5: 运行编辑器及菜单测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx src/renderer/design/views/canvas/CanvasPromptInsertMenu.test.tsx`

Expected: PASS。

### Task 5: 文档保鲜、影响复核与完整验证

**Files:**

- Modify: `docs/design/canvas-prompt-composer.md`
- Modify: `docs/superpowers/specs/2026-07-17-canvas-prompt-insert-menu-and-node-rename-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-canvas-prompt-insert-menu-and-node-rename.md`

- [x] **Step 1: 更新文档状态与当前行为**

把设计规格与本计划状态更新为 `已落地`，刷新 `最后核对: 2026-07-17`；在 `docs/design/canvas-prompt-composer.md` 补充统一菜单、搜索、角色/场景筛选、外置预览和点击外部关闭，并刷新其核对日期。

- [x] **Step 2: 运行相关测试集**

Run:

```bash
pnpm --filter @spark/desktop test:unit -- \
  src/renderer/design/views/canvas/canvasOperationWorkbenchState.test.ts \
  src/renderer/design/views/canvas/CanvasOperationNodeSettings.test.tsx \
  src/renderer/design/views/canvas/CanvasOperationPanel.test.ts \
  src/renderer/design/views/canvas/CanvasPromptInsertMenu.test.tsx \
  src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx
```

Expected: 全部 PASS。

- [x] **Step 3: 运行类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: 两个 TypeScript 项目均退出码 0。

- [x] **Step 4: 检查 diff 与影响范围**

GitNexus 当前未暴露 MCP 工具，按仓库降级规则使用直接调用点检索、相关测试和：

```bash
git diff --check
git diff --stat
git diff -- apps/desktop/src/renderer/design/views/canvas docs/design docs/superpowers
```

Expected: 无空白错误；变更只涉及工作台节点设置、任务配置标题去重、提示词统一菜单、测试与对应文档。

- [x] **Step 5: 交付前记录验证结果**

在最终交付中列出通过的测试和类型检查；若全仓已有无关错误，给出精确命令、首个错误位置并注明与本次 diff 的关系，不修改用户的无关改动。
