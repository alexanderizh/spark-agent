# 无限画布折叠编组追加优化 Implementation Plan

> 状态: 待开发 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为展开组增加头部折叠按钮，把折叠文件夹高度调整为 360px，并修复画布外部点击无法结束标题编辑的问题。

**Architecture:** 继续通过 `CanvasNode` 的既有 `updateNodeData` 动作切换折叠状态；折叠高度仅修改 presentation 与独立文件夹组件。标题编辑器增加捕获阶段的文档外部指针监听，以绕过 React Flow 对默认聚焦行为的拦截。

**Tech Stack:** React 19、TypeScript、`@xyflow/react`、Less、Vitest。

---

### Task 1: 展开组头部折叠按钮

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts`

- [ ] **Step 1: 写失败的集成契约测试**

在 `canvasGroupCollapseIntegration.test.ts` 断言组头部渲染可访问按钮并调用现有动作：

```ts
expect(nodeSource).toContain('aria-label="折叠编组"')
expect(nodeSource).toContain("actions.updateNodeData?.(node.id, { collapsed: true })")
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
```

Expected: FAIL，源码尚未包含头部按钮。

- [ ] **Step 3: 实现按钮和事件隔离**

在 `nodeMetaBar` 的右侧区域仅为展开组加入按钮：

```tsx
{isGroup ? (
  <button
    type="button"
    className="canvas-node-group-collapse-trigger nodrag nopan"
    aria-label="折叠编组"
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      actions.updateNodeData?.(node.id, { collapsed: true })
    }}
    onDoubleClick={(event) => event.stopPropagation()}
  >
    <Icons.ChevronUp size={13} />
  </button>
) : null}
```

同时把 `.canvas-node-meta-bar` 的 `pointer-events` 保持为默认不可交互，只为 `.canvas-node-group-collapse-trigger` 设置 `pointer-events: auto`，并提供 hover、focus-visible 样式。

- [ ] **Step 4: 运行测试确认 GREEN**

执行 Step 2 命令，Expected: PASS。

### Task 2: 折叠文件夹高度增加 60px

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasCollapsedGroup.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasCollapsedGroup.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts`

- [ ] **Step 1: 写失败尺寸测试**

```ts
expect(COLLAPSED_GROUP_SIZE).toEqual({ width: 420, height: 360 })
```

并把集成契约改为：

```ts
expect(collapsedGroupSource).toContain('viewBox="0 0 420 360"')
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/canvasGroupCollapse.test.ts \
  src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
```

Expected: FAIL，收到的高度仍为 300。

- [ ] **Step 3: 调整投影和 SVG 下半部**

把展示尺寸改为：

```ts
export const COLLAPSED_GROUP_SIZE = { width: 420, height: 360 } as const
```

把 SVG viewBox 改为 `0 0 420 360`，前挡板路径保持顶部曲线坐标不变，只把底部坐标从 `300` 延伸到 `360`、圆角控制点同步下移。Less 中数量、标题和颜色控件继续使用 bottom 定位，无需移动顶部插页与图标。

- [ ] **Step 4: 运行测试确认 GREEN**

执行 Step 2 命令，Expected: PASS。

### Task 3: 外部点击保存并退出标题编辑

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx`

- [ ] **Step 1: 写失败的外部 pointerdown 测试**

进入编辑并修改标题后，模拟画布没有让输入框产生 blur：

```ts
await act(async () => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})

expect(mounted.onRename).toHaveBeenCalledWith('外部点击保存')
expect(mounted.renameButton().textContent).toBe('外部点击保存')
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx \
  -t "outside pointer"
```

Expected: FAIL，`onRename` 没有调用且输入框仍存在。

- [ ] **Step 3: 增加捕获阶段外部提交**

为组件根交互元素保留 ref；编辑期间注册文档监听：

```ts
useEffect(() => {
  if (!editing) return
  const commitFromOutsidePointer = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node && inputRef.current?.input?.contains(target)) return
    void commit()
  }
  document.addEventListener('pointerdown', commitFromOutsidePointer, true)
  return () => document.removeEventListener('pointerdown', commitFromOutsidePointer, true)
}, [commit, editing])
```

保留 `onBlur` 作为键盘 Tab 和真实焦点切换的后备；`savingRef` 继续避免重复提交。

- [ ] **Step 4: 运行标题编辑器完整测试**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx
```

Expected: PASS；若现有 Ant notification teardown 仍出现，记录环境问题并另跑 focused 测试确认新增行为。

### Task 4: 文档与完整验证

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-canvas-collapsed-group-followup-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-collapsed-group-followup.md`

- [ ] **Step 1: 运行定向测试**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/canvasStageLayout.test.ts \
  src/renderer/design/views/canvas/canvasStageDoubleClick.test.ts \
  src/renderer/design/views/canvas/canvasGroupCollapse.test.ts \
  src/renderer/design/views/canvas/CanvasCollapsedGroup.test.tsx \
  src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts \
  src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx
```

- [ ] **Step 2: 运行静态验证**

```bash
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop build
git diff --check
```

- [ ] **Step 3: 更新文档状态**

把本设计与计划状态更新为：

```md
> 状态: 已落地 | 最后核对: 2026-08-01
```

并勾选所有完成步骤。

- [ ] **Step 4: 更新 GitNexus 或按项目规则降级**

运行：

```bash
npx gitnexus analyze
```

若继续因既有解析器问题失败，不重试；使用调用点检索、定向测试和 `git diff` 完成影响范围核对并记录原因。
