# 无限画布编组折叠修复与增强 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放大折叠编组卡，保证展开无损恢复原组状态，并增加预设颜色切换与标题双击编辑。

**Architecture:** 折叠尺寸继续只存在于 Flow 展示投影；`canvasStageLayout` 在持久化边界保留折叠组真实宽高。颜色使用节点数据中的稳定预设 key，独立折叠卡组件负责色板和标题编辑，`CanvasNode` 仅负责动作接线。

**Tech Stack:** React 19、TypeScript、`@xyflow/react`、Less、Vitest。

---

### Task 1: 修复折叠尺寸污染真实组布局

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasStageLayout.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasStageLayout.test.ts`

- [x] **Step 1: 写失败测试**

构造真实组 `560×360` 与展示投影 `420×300`，并令 Flow data 带 `collapsedGroupPresentation`。断言 dimensions 结束事件不改变真实宽高；位置结束事件仍更新 x/y。

```ts
expect(nextNodes?.[0]).toMatchObject({ x: 48, y: 72, width: 560, height: 360 })
```

- [x] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasStageLayout.test.ts
```

Expected: 折叠组宽高错误变成展示尺寸。

- [x] **Step 3: 最小修复持久化边界**

`fromFlowNodes` 在 `flow.data.collapsedGroupPresentation` 存在时沿用 `node.width` 与 `node.height`，位置仍读取 Flow position。普通节点和真实 NodeResizer 行为保持不变。

- [x] **Step 4: 运行测试确认 GREEN**

执行 Task 1 Step 2 命令，Expected: PASS。

### Task 2: 放大折叠投影并增加预设颜色模型

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts`

- [x] **Step 1: 写失败测试**

断言 `COLLAPSED_GROUP_SIZE` 为 `420×300`，缺省颜色为 `blue`，合法颜色透传，非法历史值降级为 `blue`。

- [x] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasGroupCollapse.test.ts
```

- [x] **Step 3: 实现颜色契约**

导出 10 个稳定 key：`blue | indigo | purple | pink | red | orange | yellow | green | cyan | gray`，并在 `CanvasNodeData` 增加 `groupColor`。折叠 presentation 返回规范化后的颜色。

- [x] **Step 4: 运行测试确认 GREEN**

执行 Task 2 Step 2 命令，Expected: PASS。

### Task 3: 独立折叠卡、色板与标题双击编辑

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasCollapsedGroup.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasCollapsedGroup.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasStageDoubleClick.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasStageDoubleClick.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [x] **Step 1: 写失败组件测试**

覆盖标题双击进入输入框、单击标题不展开、颜色按钮打开 10 色面板、选择颜色调用 `onColorChange('purple')`，以及按钮/输入事件不会冒泡到文件夹双击展开。

- [x] **Step 2: 运行测试确认 RED**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasCollapsedGroup.test.tsx src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx
```

- [x] **Step 3: 实现独立组件与动作链路**

`CanvasInlineNodeTitleEditor` 增加默认值为 `click` 的 `activation`，折叠卡传 `doubleClick`。`CanvasStage` 的双击捕获层遇到折叠组时交还节点内部处理，并新增重命名回调、复用现有 `onUpdateNodeData` 保存颜色；Workspace 用 `patchNodes([nodeId], { title })` 保存标题。

- [x] **Step 4: 运行测试确认 GREEN**

执行 Task 3 Step 2 命令，Expected: PASS。

### Task 4: 响应式文件夹视觉与完整验证

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasCollapsedGroup.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-canvas-collapsible-groups-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-collapsible-groups-polish.md`

- [x] **Step 1: 写失败样式契约测试**

断言 CSS 变量驱动后壳、前挡板、文字和图标颜色，右下角色板按钮可见，插页尺寸随 `420×300` 卡片同步放大。

- [x] **Step 2: 实现并验证样式**

保持三层插入结构和左高右低边缘，将各坐标按新 viewBox 比例调整；为 10 色预设提供 CSS 变量，不复制 10 套完整规则。

- [x] **Step 3: 运行定向验证**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/canvas/canvasStageLayout.test.ts \
  src/renderer/design/views/canvas/canvasGroupCollapse.test.ts \
  src/renderer/design/views/canvas/CanvasCollapsedGroup.test.tsx \
  src/renderer/design/views/canvas/CanvasInlineNodeTitleEditor.test.tsx \
  src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop build
```

- [x] **Step 4: 更新状态和 GitNexus**

把设计与计划状态改为 `已落地`，运行 `npx gitnexus analyze`，再用 `git diff --check` 和调用点检索核对范围。
