# 画布工作流 ComfyUI 式落图修正实施计划

> 状态: 实施中 | 最后核对: 2026-07-24

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复侧栏工作流缺失和删除能力，并让工作流像 ComfyUI 模板一样拖入后成为可自由编辑的真实画布节点与连线。

**Architecture:** 侧栏统一加载当前设备资料域内全部可用工作流，再在 UI 标明来源。新增纯函数把 `CanvasWorkflowPackage` 转为现有 `applyTemplate` 蓝图，CanvasStage 只负责解析拖放载荷和坐标转换，canvas API 负责一次性落盘；落图结果不写工作流来源或版本。

**Tech Stack:** React 19、TypeScript、React Flow、Vitest、现有 canvas hot-store / `applyTemplate`。

---

### Task 1: 修复侧栏数据范围与删除

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx`

- [x] 先写失败测试：默认侧栏请求不携带当前项目过滤，且能同时显示当前项目、个人库和内置模板。
- [x] 写失败测试：项目/个人工作流显示删除按钮，确认后调用 `canvasWorkflowApi.delete` 并移出列表；内置模板不显示删除。
- [x] 实现 `all/project/library/builtin` 侧栏范围；`project` 只过滤当前项目，`all` 展示全部可拖入模板。
- [x] 删除失败时保留列表并展示后端错误；已有运行历史的后端约束继续返回可读错误。

### Task 2: 工作流包转换为真实画布蓝图

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowMaterialization.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowMaterialization.test.ts`

- [x] 写失败测试：转换保留相对坐标、`sourceNodeType`、标题和完整可编辑配置。
- [x] 写失败测试：边重映射保留 edge type、`sourceHandle` / `targetHandle`，但输出不包含 workflow id、version 或 provenance。
- [x] 写失败测试：重复节点 ID、缺失端点和不支持节点类型在落盘前抛出可读错误。
- [x] 实现 `buildCanvasWorkflowTemplateBlueprint(workflowPackage)`，只返回现有画布模板 API 所需的节点与边结构。

### Task 3: 原子落图与句柄保真

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowMaterialization.test.ts`

- [x] 扩展 `applyTemplate` edge blueprint，允许传入 edge type、`sourceHandle` / `targetHandle` 并写入 `CanvasEdge.metadata`。
- [x] 在 store 增加薄封装 `materializeWorkflow(position, package)`，一次调用 `applyTemplate` 并应用返回快照。
- [x] 确认节点、资产、任务和边只执行一次 `writeDb`，任一预检失败时不触发 API。

### Task 4: 侧栏拖拽与画布落点

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.test.tsx`

- [x] 定义私有 MIME `application/x-spark-canvas-workflow`，拖拽只传 workflow id；落图前通过 API 读取当前定义包内容。
- [x] 侧栏列表项设为 draggable，并提供“添加到画布”按钮作为键盘可访问等价操作。
- [x] CanvasStage 在文件拖放之外识别工作流拖放，使用 `screenToFlowPosition` 计算落点并调用 `onDropWorkflow`。
- [x] Workspace 调用 `materializeWorkflow`，成功后关闭侧栏并提示已添加；失败时保留侧栏并显示错误。
- [x] 移除“添加到当前项目=复制定义”和“运行项目工作流=主要应用动作”的旧入口语义。

### Task 5: 回归、文档与发布门禁

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-canvas-workflow-execution-loop.md`
- Modify: `docs/superpowers/specs/2026-07-21-canvas-workflow-uiux.html`

- [x] 跑工作流 materialization、Drawer、CanvasStage drop 分发定向测试并确认 red-green 过程。
- [x] 跑 protocol、storage、desktop 全量测试、typecheck、lint、production build 与 `git diff --check`。
- [x] 更新 HTML 文稿中的侧栏按钮、拖拽反馈和真实节点落图说明。
- [x] 运行 `npx gitnexus analyze` 与 `npx gitnexus detect-changes`；全工作树因并发的主进程/认证等改动报告 critical，本功能逐项 impact 为 LOW。
- [ ] 在不重启或抢占用户 dev 实例的前提下完成真实 Electron 拖入、落图和删除视觉验收；本轮 Mac 锁屏，无法取得可信 UI 证据。

## 2026-07-24 验证记录

- desktop：329 个测试文件，1937 passed、4 todo、0 failed。
- protocol：16 个测试文件，118 passed；storage：18 个测试文件，195 passed，并实际跑完 60 个迁移。
- 全仓 typecheck、desktop/protocol lint（0 error）、隔离输出目录 production build、`git diff --check` 均通过。
- 工作流聚焦回归：5 个测试文件，24 passed，覆盖侧栏范围/删除、拖放分发、包转换、edge type/handle、typed task、输入绑定 ID 重映射和无来源落图。
- 未启动第二个 dev/Electron；生产构建输出到 `/tmp`，没有覆盖运行中的 dev `out`。
