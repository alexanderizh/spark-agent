# 无限画布产物工作台响应式工具栏实施计划

> 状态: 已落地 | 最后核对: 2026-07-23

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除产物工作台头部在可用宽度不足时的文字挤压和逐字换行，并把低频产物操作收纳到统一的“更多”菜单。

**Architecture:** 保持现有 reducer 与产物数据模型不变，只调整 `CanvasOperationWorkbench` 的操作分组和对应 LESS 布局。运行导航与产物列表组成可水平滚动的弹性区域；首层操作只保留多选、更多、资源库和编辑，其他操作在 Popover 内完整保留。

**Tech Stack:** React、TypeScript、Ant Design Popover、LESS、Vitest + jsdom

---

### Task 1: 用组件测试锁定操作分组

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

- [x] **Step 1: 写失败测试**

新增一组包含两个输出节点的快照，渲染工作台后断言：

```tsx
expect(container.querySelector('[aria-label="产物操作"]')).not.toBeNull()
expect(container.querySelector('[aria-label="可横向滚动的本次运行产物"]')).not.toBeNull()
expect(container.querySelector('.canvas-operation-workbench-actions')?.textContent).not.toContain(
  '展开当前',
)
expect(container.querySelector('.canvas-operation-more-menu')?.textContent).toContain(
  '展开当前产物',
)
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm --dir apps/desktop exec vitest run src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

Expected: FAIL，缺少新的 aria-label、更多菜单结构或操作文案。

### Task 2: 重组工作台操作层级

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`

- [x] **Step 1: 实现统一更多菜单**

将状态、产物模式、设为主产物、展开当前/本次/全部、全景预览、下载和删除放入 `.canvas-operation-more-menu`；首层保留多选、更多、资源库与编辑产物。所有既有回调、loading、disabled 和危险操作确认逻辑保持不变。

- [x] **Step 2: 为滚动区域补充语义**

给产物列表添加 `aria-label="可横向滚动的本次运行产物"` 和 `tabIndex={0}`，给首层按钮组添加 `aria-label="产物操作"`。

- [x] **Step 3: 运行定向测试并确认通过**

Run: `pnpm --dir apps/desktop exec vitest run src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

Expected: PASS。

### Task 3: 实现不挤压的响应式布局

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less`

- [x] **Step 1: 固定不可换行元素**

运行导航和每个产物按钮使用 `flex: 0 0 auto`、`white-space: nowrap`；产物列表使用 `overflow-x: auto` 承接溢出，不允许按钮被压缩。

- [x] **Step 2: 增加容器级两行布局**

头部采用 `grid-template-columns: auto minmax(0, 1fr) auto`。容器变窄时，Tab 占首行，运行/产物上下文与首层操作进入第二行；Tab 自身也允许水平滚动。

- [x] **Step 3: 打磨更多菜单**

增加状态摘要、分组分隔、危险操作和 hover/focus 样式，保持现有深色主题变量。

### Task 4: 验证与范围核对

**Files:**

- Verify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`
- Verify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less`
- Verify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

- [x] **Step 1: 运行定向测试**

Run: `pnpm --dir apps/desktop exec vitest run src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx`

Expected: PASS，0 failures。

- [x] **Step 2: 运行类型检查或桌面端构建检查**

Run: `pnpm --dir apps/desktop typecheck`

Expected: exit 0；若仓库无该脚本，则使用 `pnpm --dir apps/desktop exec tsc --noEmit` 并记录结果。

- [x] **Step 3: 核对差异**

Run: `git diff --check && git diff -- apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx docs/superpowers/plans/2026-07-23-canvas-operation-workbench-responsive-toolbar.md`

Expected: 无空白错误，变更只涉及工作台交互、样式、测试和本计划。
