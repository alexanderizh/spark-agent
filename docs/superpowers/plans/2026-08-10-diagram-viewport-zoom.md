# Diagram Viewport Zoom Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-10

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会话内 Mermaid 与 markmap 图表默认按 100% 清晰尺寸显示，并提供按钮缩放、适应窗口、滚轮缩放、滚动与全屏拖拽平移。

**Architecture:** 新增独立 `DiagramViewport` 统一管理缩放状态、滚动位置和控件，两个图表渲染器只负责输出具有明确自然宽高的内容。内联模式仅在 Ctrl/Cmd + 滚轮时缩放；全屏模式直接滚轮缩放并允许拖拽平移。默认不自动适应窗口，只有用户点击“适应窗口”时才计算缩放率。

**Tech Stack:** React 19、TypeScript strict、LESS、Vitest/jsdom、Mermaid、markmap-view

---

### Task 1: 锁定缩放数学和视口交互

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/diagramViewportMath.ts`
- Create: `apps/desktop/src/renderer/design/views/chat/diagramViewportMath.test.ts`

- [x] **Step 1: 写失败测试**

覆盖缩放范围 50%–300%、按钮步进、滚轮方向、适应窗口不放大小图，以及指针中心缩放后的滚动位置计算。

- [x] **Step 2: 运行测试确认红灯**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/diagramViewportMath.test.ts`

Expected: FAIL，因为 `diagramViewportMath.ts` 尚不存在。

- [x] **Step 3: 写最小实现**

导出 `clampDiagramZoom`、`getDiagramWheelZoom`、`getDiagramFitZoom` 和 `getZoomedScrollPosition`，所有函数保持纯函数，DOM 组件只负责读取尺寸并应用结果。

- [x] **Step 4: 运行测试确认绿灯**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/diagramViewportMath.test.ts`

Expected: PASS。

### Task 2: 实现统一图表视口

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/DiagramViewport.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/DiagramViewport.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/RenderDiagramBlock.less`

- [x] **Step 1: 写失败测试**

使用 jsdom 挂载视口，断言默认显示 `100%`，加减按钮改变倍率，100% 按钮复位，内联普通滚轮不缩放、Ctrl/Cmd + 滚轮缩放，全屏普通滚轮缩放。

- [x] **Step 2: 运行测试确认红灯**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/DiagramViewport.test.tsx`

Expected: FAIL，因为组件尚不存在。

- [x] **Step 3: 写最小实现**

组件维护 `zoom` 与拖拽状态；通过 `ResizeObserver` 记录自然内容尺寸；用固定大小 surface + `transform: scale(...)` 保证滚动范围与视觉尺寸一致；缩放时按鼠标位置补偿 `scrollLeft/scrollTop`。控件包含缩小、100% 复位、放大、适应窗口。

- [x] **Step 4: 运行测试确认绿灯**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/DiagramViewport.test.tsx`

Expected: PASS。

### Task 3: 恢复两个渲染器的自然尺寸

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/RenderMarkmapDiagram.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/RenderMermaidDiagram.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/RenderDiagramBlock.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/RenderDiagramBlock.less`
- Modify: `apps/desktop/src/renderer/design/views/chat/RenderDiagramHostIsolation.test.tsx`

- [x] **Step 1: 写失败测试**

静态回归检查 markmap 不再调用 `fit()`，并锁定渲染器输出的宿主隔离结构；视口组件测试锁定内联和全屏均由独立 `DiagramViewport` 包裹。

- [x] **Step 2: 运行测试确认红灯**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/RenderDiagramHostIsolation.test.tsx src/renderer/design/views/chat/RenderDiagramBlock.test.tsx`

Expected: FAIL，当前 markmap 仍在手动 `fit()`，且主组件还没有统一视口。

- [x] **Step 3: 写最小实现**

markmap 使用布局 `state.rect` 设置 SVG `viewBox` 和自然宽高，关闭内部 pan/zoom，不再调用 `fit()`；Mermaid 从 SVG `viewBox` 写入明确像素宽高并移除 max-width；内联与全屏预览分别包进独立视口。

- [x] **Step 4: 运行聚焦测试和类型检查**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/diagramViewportMath.test.ts src/renderer/design/views/chat/DiagramViewport.test.tsx src/renderer/design/views/chat/RenderDiagramHostIsolation.test.tsx src/renderer/design/views/chat/RenderDiagramBlock.test.tsx`

Run: `pnpm --filter @spark/desktop typecheck`

Expected: 全部 PASS，无 TypeScript 错误。

### Task 4: 真实界面验证与复核

**Files:**

- Modify: `docs/superpowers/plans/2026-08-10-diagram-viewport-zoom.md`
- Modify: `.spark-agent/task-state/diagram-viewport-zoom.md`

- [x] **Step 1: 启动或复用真实渲染环境**

在 Vite + Chromium 中挂载实际 DiagramViewport、Mermaid 与 markmap 组件，检查默认 100% 可读、内联横纵滚动、按钮缩放、Ctrl/Cmd + 滚轮、全屏滚轮和拖拽平移；临时验证入口完成后删除。

- [x] **Step 2: 三遍源码复核**

第一遍检查行为与需求；第二遍检查 React DOM 所有权和清理；第三遍检查并行改动隔离、`git diff` 与测试证据。

- [x] **Step 3: 更新状态**

完成后把本计划与任务状态改为“已落地”，刷新最后核对日期。

## 实测结果

- Chromium 真实渲染中，Mermaid 在 718px 视口保留 1640px 自然宽度，视口 `scrollWidth=1688`，默认 100% 未压缩。
- markmap 使用 `state.rect` 输出 707×401 自然尺寸；不再经过静态 `create(data)` 的隐式 `fit()`。
- 按钮缩放、100% 复位、主动适应窗口、内联 Ctrl/Cmd + 滚轮、全屏直接滚轮与拖拽平移均已验证。
- 真实浏览器发现并修复 React passive wheel 监听问题，改用 `{ passive: false }` 的原生监听器。
