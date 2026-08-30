# 无限画布工作流第一阶段实施计划

> 状态: 已落地 | 最后核对: 2026-07-23

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前分支交付画布工作流的第一阶段纵向切片：独立协议与存储、项目/个人双作用域 CRUD、无限画布首页工作流库、项目内工作流抽屉，以及从当前选区提取工作流草稿。

**Architecture:** 画布工作流继续与 Agent 工作流完全隔离。定义持久化到 `canvas_workflows`，协议和 IPC 使用 `CanvasWorkflow*` / `canvas:workflow:*`；渲染端通过独立 `canvasWorkflowApi` 访问，不向超长 `canvas.api.ts` 继续追加功能。项目画布只在现有工作区做薄接线，库、表单、提取和状态逻辑全部拆到独立模块。

**Tech Stack:** TypeScript、React、Electron typed IPC、Zod、SQLite/better-sqlite3、Vitest、Testing Library、Ant Design、@lobehub/ui。

---

## 交付边界

本计划只实现第一阶段可用闭环：

- 创建、查询、更新、复制、归档和删除画布工作流定义。
- 项目工作流、个人工作流和内置模板的作用域区分。
- 无限画布首页以“画布项目 / 画布工作流”二级导航承载全局管理。
- 项目画布底部工具坞打开工作流抽屉。
- 当前选区通过确定性拓扑分析生成可编辑草稿，并保留来源节点。
- 个人工作流应用到项目时生成项目副本，运行与产物仍留在项目。

本阶段不伪装实现尚未接入的能力：

- AI 语义增强、模型调用和自动命名放到第二阶段。
- DAG 执行器、失败续跑和成本预算放到后续运行阶段。
- 条件、循环、子工作流和人工检查点不在本计划内。

## 文件结构

- `packages/protocol/src/canvas-workflow.ts`：领域类型、IPC Channel Map、Zod 请求 schema。
- `packages/protocol/src/canvas-workflow-ipc-augmentation.ts`：扩展现有 `IpcChannelMap`，避免修改超长 IPC 类型文件。
- `packages/storage/migrations/058_canvas_workflows.sql`：独立定义表和索引。
- `packages/storage/src/repositories/canvas-workflow.repository.ts`：SQLite CRUD 和行映射。
- `apps/desktop/src/main/ipc/registerCanvasWorkflowIpc.ts`：画布工作流 IPC 注册。
- `apps/desktop/src/renderer/design/views/canvas/canvasWorkflow.api.ts`：渲染端 typed IPC 封装。
- `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowExtraction.ts`：选区拓扑快照与草稿生成纯函数。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowLibraryView.tsx`：全局管理页。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.tsx`：项目内搜索、创建和应用入口。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.tsx`：提取确认与契约编辑。
- `apps/desktop/src/renderer/design/views/canvas/canvas-workflow.less`：工作流页面、卡片、抽屉和对话框样式。

### Task 1: 协议和输入校验

**Files:**

- Create: `packages/protocol/src/canvas-workflow.ts`
- Create: `packages/protocol/src/canvas-workflow-ipc-augmentation.ts`
- Create: `packages/protocol/src/__tests__/canvas-workflow.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`

- [x] **Step 1: 写失败测试**

覆盖创建项目工作流必须带 `projectId`、个人库工作流不能携带项目作用域、包版本必须为 `1`、列表筛选和更新请求的边界。

- [x] **Step 2: 运行协议测试确认 RED**

Run: `pnpm --filter @spark/protocol exec vitest run src/__tests__/canvas-workflow.test.ts`

Expected: FAIL，提示模块或 schema 尚不存在。

- [x] **Step 3: 实现最小协议**

定义以下稳定边界：

```ts
type CanvasWorkflowScope = 'project' | 'library' | 'builtin'
type CanvasWorkflowStatus = 'draft' | 'published' | 'archived'

interface CanvasWorkflowDefinition {
  id: string
  projectId: string | null
  name: string
  description: string | null
  scope: CanvasWorkflowScope
  status: CanvasWorkflowStatus
  version: number
  tags: string[]
  package: CanvasWorkflowPackage
  createdAt: string
  updatedAt: string
}
```

IPC 首期提供 `list/get/create/update/duplicate/archive/delete` 七个 channel。

- [x] **Step 4: 运行协议测试确认 GREEN**

Run: `pnpm --filter @spark/protocol exec vitest run src/__tests__/canvas-workflow.test.ts`

Expected: PASS。

### Task 2: SQLite migration 与 Repository

**Files:**

- Create: `packages/storage/migrations/058_canvas_workflows.sql`
- Create: `packages/storage/src/repositories/canvas-workflow.repository.ts`
- Create: `packages/storage/src/repositories/canvas-workflow.repository.test.ts`
- Modify: `packages/storage/src/repositories/index.ts`
- Modify: `packages/storage/src/index.ts`

- [x] **Step 1: 写失败测试**

使用临时数据库运行 migration，验证项目作用域过滤、个人库过滤、复制时版本与 id 隔离、归档不进入默认列表、删除不影响 Agent `workflows` 表。

- [x] **Step 2: 运行 Repository 测试确认 RED**

Run: `pnpm --filter @spark/storage exec vitest run src/repositories/canvas-workflow.repository.test.ts`

Expected: FAIL，提示表或 Repository 不存在。

- [x] **Step 3: 实现 migration 和 Repository**

表字段使用独立命名：`id/user_id/project_id/name/description/scope/status/version/tags_json/package_json/created_at/updated_at`。约束项目作用域必须有 `project_id`，个人库和内置模板必须没有 `project_id`。

- [x] **Step 4: 运行 Repository 测试确认 GREEN**

Run: `pnpm --filter @spark/storage exec vitest run src/repositories/canvas-workflow.repository.test.ts`

Expected: PASS。

### Task 3: 主进程 IPC 和渲染端 API

**Files:**

- Create: `apps/desktop/src/main/ipc/registerCanvasWorkflowIpc.ts`
- Create: `apps/desktop/src/main/ipc/registerCanvasWorkflowIpc.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflow.api.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`

- [x] **Step 1: 写失败测试**

验证七个 channel 全部注册，创建时生成 UUID 和时间戳，项目作用域不允许缺失项目，内置模板不可更新或删除。

- [x] **Step 2: 运行 IPC 测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/ipc/registerCanvasWorkflowIpc.test.ts`

Expected: FAIL，提示注册器不存在。

- [x] **Step 3: 实现独立注册器和渲染端 API**

`registerAllIpcHandlers()` 只增加一次 `registerCanvasWorkflowIpc()` 调用。所有业务逻辑留在新文件，避免继续增大主 IPC 文件和 `canvas.api.ts`。

- [x] **Step 4: 运行 IPC 测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/ipc/registerCanvasWorkflowIpc.test.ts`

Expected: PASS。

### Task 4: 选区提取纯逻辑

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowExtraction.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowExtraction.test.ts`

- [x] **Step 1: 写失败测试**

验证只保留选区内部边，外部流入边生成输入，流出边生成输出，节点坐标归一化，来源项目/画板/节点写入 provenance，空选区和跨项目选区返回明确错误。

- [x] **Step 2: 运行提取测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasWorkflowExtraction.test.ts`

Expected: FAIL，提示提取器不存在。

- [x] **Step 3: 实现确定性拓扑分析**

函数只生成草稿，不调用模型、不修改源画布。名称默认使用主要操作节点名称或“未命名画布工作流”，输入输出允许确认对话框继续编辑。

- [x] **Step 4: 运行提取测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasWorkflowExtraction.test.ts`

Expected: PASS。

### Task 5: 无限画布首页工作流库

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowLibraryView.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowLibraryView.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvas-workflow.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx`

- [x] **Step 1: 写失败测试**

通过可访问角色查询验证“画布项目 / 画布工作流”导航、作用域筛选、搜索、空态、新建草稿、查看摘要和归档操作。

- [x] **Step 2: 运行组件测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowLibraryView.test.tsx`

Expected: FAIL，提示组件不存在。

- [x] **Step 3: 实现专业创作型管理页**

使用真实内容导向的信息密度：范围与依赖作为辅助状态，输入/输出契约和版本作为主信息；不展示虚构成功率，不使用营销型 Hero，不用纯色渐变或装饰性大卡片。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowLibraryView.test.tsx`

Expected: PASS。

### Task 6: 项目工作流抽屉与工具坞入口

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasBottomDock.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [x] **Step 1: 写失败测试**

验证底部工具坞存在“画布工作流”按钮、打开抽屉后展示当前项目与个人库、个人库工作流应用时创建项目副本、关闭与焦点恢复可通过键盘完成。

- [x] **Step 2: 运行组件测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx`

Expected: FAIL，提示抽屉或入口不存在。

- [x] **Step 3: 实现独立抽屉和薄接线**

抽屉与画布 Agent 等浮层互斥。`CanvasWorkspaceView` 只增加 open state、当前项目 id 和回调，不在超长文件中实现列表、筛选或保存逻辑。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx`

Expected: PASS。

### Task 7: 提取确认对话框

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [x] **Step 1: 写失败测试**

验证不足两个节点时禁用提取、确认页展示来源节点/内部边/输入输出、默认保存为项目草稿、保存后不删除或修改源节点。

- [x] **Step 2: 运行组件测试确认 RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.test.tsx`

Expected: FAIL，提示对话框不存在。

- [x] **Step 3: 实现提取入口与确认交互**

入口放在选区上下文动作中，同时在工作流抽屉提供“从当前选区提取”。保存调用 `canvasWorkflowApi.create`，成功后刷新抽屉列表。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.test.tsx`

Expected: PASS。

### Task 8: 集成验证和文档同步

**Files:**

- Modify: `docs/superpowers/specs/2026-07-21-canvas-workflow-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-canvas-workflow-phase-1.md`

- [x] **Step 1: 运行定向测试**

Run: `pnpm --filter @spark/protocol test:unit`

Run: `pnpm --filter @spark/storage test:unit`

Run: `pnpm --filter @spark/desktop exec vitest run src/main/ipc/registerCanvasWorkflowIpc.test.ts src/renderer/design/views/canvas/canvasWorkflowExtraction.test.ts src/renderer/design/views/canvas/CanvasWorkflowLibraryView.test.tsx src/renderer/design/views/canvas/CanvasWorkflowDrawer.test.tsx src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.test.tsx`

- [x] **Step 2: 运行类型与格式检查**

Run: `pnpm --filter @spark/protocol typecheck`

Run: `pnpm --filter @spark/storage typecheck`

Run: `pnpm --filter @spark/desktop typecheck`

Run: `pnpm exec prettier --check packages/protocol/src/canvas-workflow.ts packages/protocol/src/canvas-workflow-ipc-augmentation.ts packages/protocol/src/__tests__/canvas-workflow.test.ts packages/storage/src/repositories/canvas-workflow.repository.ts packages/storage/src/repositories/canvas-workflow.repository.test.ts apps/desktop/src/main/ipc/registerCanvasWorkflowIpc.ts apps/desktop/src/main/ipc/registerCanvasWorkflowIpc.test.ts apps/desktop/src/renderer/design/views/canvas/canvasWorkflow.api.ts apps/desktop/src/renderer/design/views/canvas/canvasWorkflowExtraction.ts apps/desktop/src/renderer/design/views/canvas/canvasWorkflowExtraction.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowLibraryView.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowDrawer.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkflowExtractDialog.tsx apps/desktop/src/renderer/design/views/canvas/canvas-workflow.less docs/superpowers/specs/2026-07-21-canvas-workflow-design.md docs/superpowers/plans/2026-07-23-canvas-workflow-phase-1.md`

- [x] **Step 3: 运行视觉验收**

启动桌面开发环境，在 1440x900 和最小支持窗口宽度检查：首页二级导航、空态、卡片密度、抽屉、焦点环、长名称换行、浅色/深色主题，不允许横向溢出和悬浮层遮挡。

- [x] **Step 4: 核对变更影响**

Run: `node .gitnexus/run.cjs detect-changes --repo /Users/zhangyang/spark_ai_project/Spark-Agent`

Run: `git diff --check`

确认只影响画布工作流协议、存储、IPC 和画布 UI；不触碰 Agent 工作流运行表和用户已有画布节点删除改动。

## 计划自检

- 设计中的项目/个人双作用域、独立存储、首页库、项目内入口和选区提取均有对应任务。
- AI 语义增强与 DAG 运行明确不在第一阶段，页面不会用假状态冒充已接入能力。
- 协议字段、Repository 字段和 UI 使用统一的 `CanvasWorkflow*` 命名。
- 超过 3,000 行的文件只做模块导入与薄接线，不承载新增业务实现。
