# 无限画布网格划选持久化与自动整理复用 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留网格划选高亮、缩小应用按钮，并让右上角自动整理复用网格列数选择。

**Architecture:** 将拖动态与已提交选区分离，`CanvasGridSelectionMatrix` 持久显示最近一次鼠标划选区域，并继续用受控 `columns` 驱动实际布局。`CanvasToolbar` 在宫格模式复用 `CanvasGridArrangePanel`，可选 `columns` 沿现有自动整理调用链下传。

**Tech Stack:** React、TypeScript、Ant Design、@lobehub/ui、Vitest、jsdom、Less。

---

### Task 1: 网格选区持久化

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasGridSelectionMatrix.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasGridSelectionMatrix.test.ts`

- [x] 写 jsdom 失败测试：拖选 6×2 区域并触发 `window.mouseup` 后仍有 12 个 `.is-active`。
- [x] 运行 `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasGridSelectionMatrix.test.ts`，确认测试因选区被清空而失败。
- [x] 新增 committed selection；拖动时优先显示临时选区，松开后保存最终选区。
- [x] 保留用户实际划出的矩形；数值输入继续通过受控 `columns` 同步布局列数。
- [x] 重跑定向测试并确认通过。

### Task 2: 共享面板与小号应用按钮

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasGridArrangePanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasGridArrangePanel.less`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasGridArrangePanel.test.tsx`

- [x] 写失败测试，断言应用按钮为 small，并支持自动整理自定义文案。
- [x] 给按钮传入 `size="small"`；为右上角复用增加可选标题、说明、提交文案与铺满容器模式。
- [x] 重跑面板测试并确认通过。

### Task 3: 自动整理接入网格划选

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasToolbar.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceChrome.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasToolbar.test.tsx`

- [x] 写失败测试：宫格模式显示网格矩阵，应用时 `onArrange` 收到 `{ mode: 'grid', spacing, columns }`。
- [x] 在工具栏维护宫格列数，并在宫格模式渲染共享面板；横向、纵向保留原 UI。
- [x] 扩展 `onArrange` 的可选 `columns` 类型并透传到现有 `CanvasStageViewportControls.arrangeNodes`。
- [x] 重跑工具栏和自动布局定向测试并确认通过。

### Task 4: 文档、范围与整体验证

**Files:**

- Modify: `docs/design/infinite-canvas-ui-css-optimization-plan.md`
- Modify: `docs/superpowers/specs/2026-08-01-canvas-grid-selection-persistence-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-grid-selection-persistence.md`

- [x] 更新画布 UI 进度与文档日期。
- [x] 运行画布相关 Vitest、桌面 TypeScript 检查和格式检查。
- [x] 运行 `git diff --check`、直接调用点检索和 `git diff --stat` 核对范围。
- [x] 运行 `node .gitnexus/run.cjs analyze` 更新索引记录。

## 验证结果

- 相关 5 个测试文件共 26 个测试全部通过。
- 桌面 TypeScript 检查通过；目标文件 ESLint 无错误，仅保留原有 Fast Refresh 导出警告。
- 完整桌面单测受当前工作区既有失败影响：2656 通过、9 失败、1 个未处理错误；失败不涉及本计划新增或修改的交互测试。
- GitNexus 索引更新成功：53,516 nodes、95,441 edges、1,413 clusters、300 flows。
