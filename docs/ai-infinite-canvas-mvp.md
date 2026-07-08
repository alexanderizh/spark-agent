# AI 无限画布 MVP 功能范围与开发设计

> 状态: 已落地（核心闭环已上线，详见 apps/desktop/src/renderer/design/views/canvas/） | 最后核对: 2026-07-02
>
> 目标落地位置：
>
> - 首发前端：`G:\spark\spark-agent`，作为核心菜单功能。
> - 首发后端：`G:\spark\spark-edugen\edu-server`。
> - 后续 Web 端：`G:\spark\spark-edugen\edu-web`。
> - 关键产品约束：项目管理页是入口；每个项目进入一个无限画布；画布内 AI 能力优先复用 Spark Agent 的 agents 与 providers 配置。

## 1. 产品定位

AI 无限画布不是单一生图页，而是一个以项目为单位的多模态创作工作台。

用户先进入“画布项目管理页”，创建或选择一个项目，再进入该项目的无限画布。画布里可以放置图片、视频、文本、Prompt、参考素材、AI 任务结果和生成历史；用户可选择画布中的一个或多个资源，调用 AI 进行生成、编辑、合成、改写、图生视频等操作。

MVP 的核心闭环：

1. 创建画布项目。
2. 进入项目画布。
3. 上传或创建文本/图片节点。
4. 选择节点并发起 AI 操作。
5. 后端创建画布任务，调用 agent/provider 能力。
6. 任务进度回写画布。
7. AI 输出自动成为新画布节点。
8. 节点保留来源关系，可继续派生。

## 2. 与现有系统的关系

### 2.1 spark-agent

当前 `spark-agent` 具备：

- 一级菜单：`apps/desktop/src/renderer/App.tsx` 中的 `NAV_ITEMS`。
- 全局视图状态：`apps/desktop/src/renderer/design/AppContext.tsx` 中的 `ViewId`。
- Agents 管理：`packages/storage/src/repositories/agent.repository.ts`。
- Providers 管理：`packages/agent-runtime/src/services/provider.service.ts`。
- 本地 SQLite repository 分层：`packages/storage/src/repositories/*`。
- Workflow/Board 视图基础，可借鉴但不要把无限画布直接塞进现有 Board。

MVP 建议新增一级菜单：

- 菜单 id：`canvas`
- 菜单名：`Canvas`
- 入口视图：`CanvasProjectsView`
- 项目内视图：`CanvasWorkspaceView`

注意：菜单点进去先是项目管理页，不是直接进入空画布。

### 2.2 edu-server

当前 `edu-server` 已有可复用能力：

- `MaterialTask` / `MaterialTaskOutput`：图片生成、图片编辑、输出、编辑链。
- `TaskDispatcherService`：优先桌面 agent，失败回退云端 agent。
- `AgentClientService`：调用 agent 服务。
- `StorageService`：对象存储与静态 URL。
- `/api/v1/internal/agent-callback`：agent 任务回调。
- WebSocket：任务进度推送。

MVP 不建议强行复用 `material_tasks` 作为画布项目表。它更像一个具体 AI 任务。无限画布需要独立项目、节点、资产、任务、边关系。可以复用素材任务的调用与输出处理思路，但数据模型应独立。

### 2.3 edu-web

后续 `edu-web` 可复用同一套 `edu-server` API：

- 新增 `/app/canvas-projects`
- 新增 `/app/canvas-projects/:projectId`
- 复用已有素材工坊的图片任务、素材库、任务轮询、WebSocket 模式。

## 3. MVP 功能范围

### 3.1 必做功能

项目管理页：

- 创建项目：名称、描述、封面可后置。
- 项目列表：最近更新、项目状态、资源数量、任务数量。
- 搜索项目。
- 重命名项目。
- 删除或归档项目。
- 点击项目进入无限画布。

画布基础：

- 无限平移、缩放。
- 节点拖拽、选中、多选、框选。
- 节点基础操作：复制、删除、锁定、置顶、分组。
- 节点常驻头部工具栏：复制、确认、标记待更新、锁定、置顶、删除等高频动作直接可见；图片节点补充图片标注、本地宫格切分、裁剪、扩图、提取风格，图片/文本/Prompt 节点支持右键创建"细节设定图（九宫格）"操作节点（统一收纳在右键"AI 操作"子菜单的"上下文专属"段，与本地宫格切分区分），全景节点补充全景预览，节点专属能力仍保留右键菜单兜底。
- 底部工具栏补充“角色库”入口：聚合展示项目内角色资产，支持在角色参考图上定义可复用的“子视图”（脸部 / 全身 / 表情 / 服装等裁切区域），并把所选角色图或子视图直接应用到当前画布。
- 节点双击进入内联激活态：节点卡片内部向下展开编辑 / 配置面板；编辑态可临时扩展节点宽度，内部配置区可滚动，展开态仅用于 UI，不污染节点持久化尺寸。
- 节点尺寸策略：新建节点默认加宽以容纳常驻头部工具栏，文本/Prompt/媒体/AI 操作/分组节点均设置可用的最小宽高；旧节点不批量迁移，避免破坏用户既有排版。
- 自动保存画布视口与节点布局。
- 画布右侧属性面板显示选中节点信息；节点级编辑优先使用双击内联面板，复杂专用编辑器（3D 导演台、全景预览、图片标注、全屏 Prompt）继续使用专用弹窗。

节点类型：

- 图片节点：上传图片、AI 输出图片。
- 文本节点：文案、Prompt、脚本、备注。
- 视频节点：AI 输出视频，MVP 可先只展示和预览。
- 任务节点：显示进行中的 AI 任务。
- 分组节点：将多个节点编组。

AI 操作：

- 文生图：从空画布或文本节点发起。
- 图生图：选中一张或多张图片发起。
- 图片编辑：选中图片 + 文本指令。
- 多图合成：选中多图 + 文本指令。
- 文本生成/改写：选中文本或空白发起。
- 图片转视频：选中图片发起，MVP 可做接口和任务节点，视频模型能力按 provider/agent 实际支持逐步接入。
- Prompt 优化：对文本节点或输入框内容优化。
- 文本类操作节点的运行配置支持选择 Agent、文本模型和多选 Skills；图片/视频类操作继续只暴露媒体模型和模型参数，避免把文本 Skill 注入媒体任务。

任务与结果：

- 创建任务后在画布产生任务节点。
- 任务节点展示状态：pending、running、completed、failed、cancelled。
- 任务完成后自动创建结果节点。
- 任务与产物节点默认名称使用节点类型 + 顺序号（如“图片 #3”“文本生成 #2”），不再用 provider/model 拼接，方便后续选择与引用。
- 结果节点和输入节点之间建立 lineage 边。
- 支持取消任务。
- 支持失败后重试。

资产管理：

- 项目内资产侧栏：图片、视频、文本、任务。
- 支持按类型、状态、关键词筛选。
- 资产可拖回画布。
- 每个资产可查看来源任务、prompt、模型、参数。

### 3.2 暂不做

- 多人实时协作。
- 复杂时间线剪辑。
- 精细蒙版编辑器。
- Photoshop 级图层系统。
- 复杂 DAG 工作流编排器。
- 跨项目资产库。
- 模型市场和计费策略重构。
- 完整视频编辑，只做生成结果预览和下载。

## 4. 核心信息架构

推荐信息结构：

```text
Canvas
├─ 项目管理页
│  ├─ 项目列表
│  ├─ 新建项目
│  └─ 最近项目
└─ 项目画布页
   ├─ 顶部栏
   ├─ 左侧工具栏
   ├─ 无限画布
   ├─ 右侧属性 / 资产 / 项目面板
  ├─ 节点常驻头部工具栏 + 节点内编辑 / AI 操作配置扩展区
   ├─ 底部任务队列
   └─ 资产抽屉
```

## 5. 数据模型

### 5.1 画布项目

后端表：`canvas_projects`

```ts
type CanvasProjectStatus = 'active' | 'archived' | 'deleted'

interface CanvasProject {
  id: string
  userId: number
  title: string
  description?: string | null
  coverAssetId?: string | null
  status: CanvasProjectStatus
  nodeCount: number
  assetCount: number
  taskCount: number
  lastOpenedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}
```

### 5.2 画布

MVP 可先一个项目一个画布，但仍保留 `canvas_boards`，方便后续一个项目多个画布。

```ts
interface CanvasBoard {
  id: string
  projectId: string
  userId: number
  name: string
  viewport: {
    x: number
    y: number
    zoom: number
  }
  settings: {
    grid?: boolean
    snap?: boolean
    background?: string
  }
  createdAt: Date
  updatedAt: Date
}
```

### 5.3 节点

后端表：`canvas_nodes`

```ts
type CanvasNodeType = 'image' | 'video' | 'text' | 'prompt' | 'task' | 'group'

interface CanvasNode {
  id: string
  projectId: string
  boardId: string
  userId: number
  type: CanvasNodeType
  title?: string | null
  assetId?: string | null
  taskId?: string | null
  parentNodeId?: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked: boolean
  hidden: boolean
  selected?: boolean
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
```

节点 `data` 示例：

```ts
type TextNodeData = {
  text: string
  format?: 'plain' | 'markdown' | 'prompt'
}

type ImageNodeData = {
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  mimeType?: string
}

type TaskNodeData = {
  operation: CanvasOperationType
  status: CanvasTaskStatus
  progress: number
  message?: string
}
```

### 5.4 资产

后端表：`canvas_assets`

```ts
type CanvasAssetType = 'image' | 'video' | 'text' | 'prompt' | 'file'
type CanvasAssetSource = 'upload' | 'ai_generated' | 'ai_edited' | 'imported' | 'manual'

interface CanvasAsset {
  id: string
  projectId: string
  userId: number
  type: CanvasAssetType
  source: CanvasAssetSource
  title?: string | null
  mimeType?: string | null
  storageKey?: string | null
  url?: string | null
  thumbnailKey?: string | null
  thumbnailUrl?: string | null
  contentText?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  sizeBytes?: number | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
```

### 5.5 AI 任务

后端表：`canvas_tasks`

```ts
type CanvasOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'image_to_video'

type CanvasTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface CanvasTask {
  id: string
  projectId: string
  boardId: string
  userId: number
  operation: CanvasOperationType
  status: CanvasTaskStatus
  progress: number
  title?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  inputNodeIds: string[]
  inputAssetIds: string[]
  outputNodeIds: string[]
  outputAssetIds: string[]
  providerProfileId?: string | null
  modelId?: string | null
  agentId?: string | null
  agentMode?: 'local' | 'cloud' | null
  agentUrl?: string | null
  modelParams: Record<string, unknown>
  errorMsg?: string | null
  errorDetail?: string | null
  createdAt: Date
  updatedAt: Date
  completedAt?: Date | null
}
```

### 5.6 血缘关系

后端表：`canvas_edges`

```ts
type CanvasEdgeType =
  | 'derived_from'
  | 'used_as_input'
  | 'generated'
  | 'group_contains'
  | 'references'

interface CanvasEdge {
  id: string
  projectId: string
  boardId: string
  userId: number
  sourceNodeId: string
  targetNodeId: string
  type: CanvasEdgeType
  taskId?: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}
```

MVP 只需要显示 `derived_from` 和 `generated`，但表结构要能支撑后续关系图。

### 5.7 操作日志

后端表：`canvas_events`

```ts
interface CanvasEvent {
  id: string
  projectId: string
  boardId?: string | null
  userId: number
  eventType: string
  entityType: 'project' | 'board' | 'node' | 'asset' | 'task' | 'edge'
  entityId?: string | null
  payload: Record<string, unknown>
  createdAt: Date
}
```

MVP 用于调试、恢复和后续审计，不必先做完整时间旅行。

## 6. 后端 API 设计

统一前缀建议：

```text
/api/v1/canvas
```

项目：

```text
GET    /projects
POST   /projects
GET    /projects/:projectId
PUT    /projects/:projectId
DELETE /projects/:projectId
POST   /projects/:projectId/archive
```

画布：

```text
GET /projects/:projectId/board
PUT /projects/:projectId/board/viewport
GET /projects/:projectId/snapshot
```

节点：

```text
POST   /projects/:projectId/nodes
PATCH  /projects/:projectId/nodes/:nodeId
POST   /projects/:projectId/nodes/batch
DELETE /projects/:projectId/nodes/:nodeId
```

资产：

```text
GET  /projects/:projectId/assets
POST /projects/:projectId/assets/upload
POST /projects/:projectId/assets/text
GET  /projects/:projectId/assets/:assetId
```

AI 任务：

```text
POST /projects/:projectId/tasks
GET  /projects/:projectId/tasks
GET  /projects/:projectId/tasks/:taskId
POST /projects/:projectId/tasks/:taskId/cancel
POST /projects/:projectId/tasks/:taskId/retry
```

任务创建请求：

```ts
interface CreateCanvasTaskRequest {
  boardId: string
  operation: CanvasOperationType
  prompt?: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputAssetIds?: string[]
  outputPlacement?: {
    x?: number
    y?: number
    strategy?: 'near_selection' | 'viewport_center' | 'right_of_selection'
  }
  modelParams?: Record<string, unknown>
  agentId?: string
  providerProfileId?: string
  modelId?: string
}
```

WebSocket：

```text
/ws/canvas/:projectId?token=...
```

事件类型：

```ts
type CanvasSocketEvent =
  | { type: 'canvas_task_created'; taskId: string; nodeId?: string }
  | { type: 'canvas_task_progress'; taskId: string; progress: number; message?: string }
  | {
      type: 'canvas_task_output_ready'
      taskId: string
      assets: CanvasAsset[]
      nodes: CanvasNode[]
      edges: CanvasEdge[]
    }
  | { type: 'canvas_task_completed'; taskId: string }
  | { type: 'canvas_task_failed'; taskId: string; errorMsg: string }
  | { type: 'canvas_nodes_updated'; nodes: CanvasNode[] }
```

## 7. Agent 与 Provider 调用设计

### 7.1 能力来源

画布 AI 能力不要直接硬编码 provider，而是走能力注册表：

```ts
interface CanvasCapability {
  id: string
  label: string
  operation: CanvasOperationType
  inputTypes: CanvasNodeType[]
  outputTypes: CanvasAssetType[]
  agentId?: string
  providerProfileId?: string
  modelId?: string
  enabled: boolean
  paramsSchema: Record<string, unknown>
}
```

来源优先级：

1. 用户在画布任务请求中指定 `agentId`。
2. 项目默认 agent。
3. 全局默认 agent。
4. 根据 operation 从 providers/model capabilities 中选择。

### 7.2 spark-agent 本地侧

在 `spark-agent` 中建议新增：

- `canvas_projects` / `canvas_nodes` 等 SQLite 表，支持本地缓存和离线草稿。
- `CanvasProjectRepository`
- `CanvasNodeRepository`
- `CanvasTaskRepository`
- `CanvasAssetRepository`
- `CanvasService`
- `CanvasAgentBridgeService`

如果首版所有真实数据都在 `edu-server`，本地 repository 也可以先只做缓存。但界面状态、未提交节点、视口信息建议本地保留，体验会稳很多。

### 7.3 edu-server 侧

新增：

- `canvas-project.entity.ts`
- `canvas-board.entity.ts`
- `canvas-node.entity.ts`
- `canvas-asset.entity.ts`
- `canvas-task.entity.ts`
- `canvas-edge.entity.ts`
- `canvas-event.entity.ts`
- `canvas.controller.ts`
- `canvas.service.ts`
- `canvas-task.service.ts`
- `canvas-agent.service.ts`

`CanvasAgentService` 复用 `TaskDispatcherService.dispatchUserAction` 或新增同风格方法：

```ts
dispatchCanvasTask(userId, action, payload, cloudFallback, timeoutMs)
```

建议 action 命名：

```text
canvas_text_to_image
canvas_image_to_image
canvas_image_edit
canvas_image_compose
canvas_text_generate
canvas_prompt_optimize
canvas_image_to_video
canvas_cancel_task
```

### 7.4 与现有 material 的关系

MVP 可以先让以下操作内部复用 material agent 协议：

- `text_to_image` -> material `image_gen`
- `image_to_image` -> material `image_gen` + `source_image_urls`
- `image_edit` -> material `image_edit`
- `image_compose` -> material `image_gen` + 多 `source_image_urls`

但画布侧仍然创建自己的 `canvas_tasks`、`canvas_assets`、`canvas_nodes`。material 可作为执行适配层，不作为画布业务主表。

## 8. 前端交互原型结构

### 8.1 spark-agent 菜单入口

需要修改：

- `apps/desktop/src/renderer/design/AppContext.tsx`
  - `ViewId` 增加 `canvas`。
- `apps/desktop/src/renderer/App.tsx`
  - `NAV_ITEMS` 增加 `{ id: 'canvas', label: 'Canvas', icon: Icons.Canvas }`。
  - `renderView` 增加 `case 'canvas': return <CanvasProjectsView />`。
- `apps/desktop/src/renderer/design/Icons.tsx`
  - 增加 Canvas 图标。

建议新文件：

```text
apps/desktop/src/renderer/design/views/canvas/
├─ CanvasProjectsView.tsx
├─ CanvasProjectsView.less
├─ CanvasWorkspaceView.tsx
├─ CanvasWorkspaceView.less
├─ CanvasStage.tsx
├─ CanvasToolbar.tsx
├─ CanvasNode.tsx
├─ CanvasInspector.tsx
├─ CanvasAssetDrawer.tsx
├─ CanvasTaskQueue.tsx
├─ CanvasAiPanel.tsx
├─ canvas.types.ts
├─ canvas.store.ts
└─ canvas.api.ts
```

### 8.2 项目管理页

页面布局：

```text
┌──────────────────────────────────────────────┐
│ Canvas Projects                 [新建项目]   │
│ 搜索项目...        最近更新 / 创建时间筛选   │
├──────────────────────────────────────────────┤
│ 项目卡片 │ 项目卡片 │ 项目卡片 │ 项目卡片    │
│ 项目卡片 │ 项目卡片 │ 项目卡片 │ 项目卡片    │
└──────────────────────────────────────────────┘
```

项目卡片信息：

- 项目标题
- 最近更新时间
- 资源数量
- 任务数量
- 缩略封面
- 状态：进行中、已归档
- 操作：打开、重命名、复制、归档、删除

点击卡片后进入：

```text
CanvasWorkspaceView(projectId)
```

如果 `spark-agent` 仍然是单页 `view` 状态，不使用路由，可以用本地 state：

```ts
type CanvasViewMode = { mode: 'projects' } | { mode: 'workspace'; projectId: string }
```

### 8.3 项目画布页

布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ 返回项目  项目名        [运行任务] [资产] [导出] [设置]      │
├───────┬───────────────────────────────────────┬─────────────┤
│ 工具栏 │ 无限画布                              │ AI/属性面板 │
│       │  图片节点 文本节点 任务节点 结果节点   │             │
│       │                                       │             │
├───────┴───────────────────────────────────────┴─────────────┤
│ 任务队列：生成中 2 / 失败 1 / 已完成 18                      │
└─────────────────────────────────────────────────────────────┘
```

左侧工具栏：

- 选择
- 平移
- 文本
- 上传图片
- 新建 Prompt
- 框选
- 对齐
- 缩放重置

右侧面板按选中状态变化：

- 未选中：项目级 AI 输入框、最近任务、推荐能力。
- 选中文本：改写、优化 Prompt、文生图。
- 选中图片：图生图、局部编辑、图片转视频、加入合成。
- 选中多图：多图合成、统一风格、生成视频分镜。
- 选中任务：查看输入、参数、日志、取消/重试。

### 8.4 推荐组件库

无限画布建议使用成熟库，不手写完整 pan/zoom/selection：

- 首选：`reactflow`，优点是节点、边、拖拽、缩放、选择、minimap 都成熟。
- 如果更偏自由设计工具：`tldraw`，但自定义 AI 节点和业务面板会更重。

MVP 推荐 `reactflow`，把节点定制为图片/文本/任务卡片。后续如果要做更强编辑器，再评估 tldraw 或自研 canvas layer。

### 8.5 电影制作提示词库

节点编辑弹窗内置面向 AI 电影制作人的提示词库，作为项目提示词库的补充。内置库以「短语积木」方式插入节点文本，不改变画布节点协议，便于后续把来源追踪到 prompt metadata。

前端实现为公用组件 `CanvasPromptLibraryPanel`：采用顶部分类 + 卡片式示例图布局，在项目资产中心的「提示词库」Tab 中用于浏览、检索、把内置提示词加入项目库或把项目提示词插入画布；在文本 / Prompt / 任务节点编辑弹窗中用于快速追加到当前节点内容或任务指令。

提示词库分类：

- 镜头语言：景别、构图、机位角度、镜头焦段、焦点、运镜、剪辑节奏。
- 摄影质感：光影、色彩、曝光纹理、胶片颗粒、变形宽银幕、体积光等。
- 美术与氛围：雨、雾、烟、蒸汽、反光地面、未来实验室、废弃走廊等可复用生产设计元素。
- 类型片风格：经典黑色电影、新黑色电影、赛博朋克、恐怖片、爱情片、史诗片、纪录片、心理惊悚、科幻片、复古年代剧。
- 生成约束：图像/视频通用反向词、电影感净化词、角色/场景/动作/风格连贯性词。

类型片风格项配套一组同内容示例图，统一使用「雨夜唐人街巷口的疲惫女侦探」作为对照场景，用风格化差异帮助用户选择提示词。非风格类内置提示词按提示词组配套组级示例图，覆盖景别、角度、运镜、构图、焦段、焦点、光影、色彩、质感、曝光、美术、氛围、表演、反向词与连贯性等卡片，避免内置库出现纯文字占位。示例资产放在：

```text
apps/desktop/src/renderer/assets/canvas-prompt-examples/
```

## 9. 前端状态设计

```ts
interface CanvasState {
  project: CanvasProject | null
  board: CanvasBoard | null
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  selectedNodeIds: string[]
  viewport: { x: number; y: number; zoom: number }
  assetDrawerOpen: boolean
  rightPanelMode: 'inspector' | 'ai' | 'task'
}
```

关键行为：

- 节点移动本地立即更新，防抖保存。
- 创建 AI 任务时先创建 optimistic task node。
- WebSocket 回调后合并真实 task、asset、node、edge。
- 任务失败不删除 task node，只标红并允许重试。
- 删除节点不默认删除资产，资产仍保留在项目资产库。

## 10. MVP 开发阶段

### Phase 1：项目与静态画布

目标：项目管理页可以创建项目并进入画布，画布可添加/拖动/保存文本和图片节点。

交付：

- `CanvasProjectsView`
- `CanvasWorkspaceView`
- `canvas_projects`
- `canvas_boards`
- `canvas_nodes`
- 基础 API
- 本地或服务端保存布局

验收：

- 创建项目后进入空画布。
- 添加文本节点、上传图片节点。
- 刷新后节点位置保留。

### Phase 2：AI 任务闭环

目标：选中节点发起 AI，结果回到画布。

交付：

- `canvas_tasks`
- `canvas_assets`
- `canvas_edges`
- `CanvasAiPanel`
- `CanvasTaskQueue`
- WebSocket 任务进度
- 文生图、图生图、图片编辑、Prompt 优化

验收：

- 文本生成图片，输出图自动出现在画布。
- 图片编辑生成新图片，显示输入输出血缘。
- 任务失败可重试。

### Phase 3：资产库与项目体验

目标：项目内资源可管理、搜索、复用。

交付：

- `CanvasAssetDrawer`
- 资产筛选/搜索
- 拖资产到画布
- 项目封面自动取最近图片
- 项目卡片展示统计

验收：

- 所有 AI 输出进入资产库。
- 资产可以重新拖回画布。
- 项目页能看到资源数量、任务数量、最近更新时间。

### Phase 4：多模态扩展

目标：接入视频与更强 agent 指令。

交付：

- 图片转视频
- 多图合成
- 画布自然语言指令
- agent 根据选区决定操作

验收：

- 选中图片可生成视频节点。
- 选中多图可合成新图。
- 输入“把选中的图统一成科技风格”可创建对应任务。

## 11. 技术风险与约束

主要风险：

- AI 能力来源复杂：providers、agents、edu-server material、桌面 agent 都可能执行任务。
- 大量节点性能：需要虚拟化或只渲染视口附近节点。
- 任务回调一致性：agent 输出、storage、canvas node 创建需要事务化。
- 文件权限：spark-agent 本地缓存与 edu-server 云端数据要明确同步边界。
- 图片/视频资源体积：必须走对象存储，不要把 base64 长期存 DB。

MVP 约束：

- DB 只存 storage key、URL、元数据，不存大文件。
- 画布节点只保存布局和引用，不复制资产。
- AI 任务所有输入输出都要落 `canvas_tasks` 和 `canvas_edges`。
- 项目页必须先于画布页开发。
- 画布能力必须允许绑定 agent，不要只绑定 provider。

## 12. 推荐第一版接口与文件清单

spark-agent：

```text
apps/desktop/src/renderer/design/views/canvas/*
packages/protocol/src/ipc/index.ts
packages/storage/migrations/027_canvas.sql
packages/storage/src/repositories/canvas-project.repository.ts
packages/storage/src/repositories/canvas-node.repository.ts
packages/storage/src/repositories/canvas-task.repository.ts
packages/storage/src/repositories/canvas-asset.repository.ts
packages/agent-runtime/src/services/canvas.service.ts
```

edu-server：

```text
src/entity/canvas-project.entity.ts
src/entity/canvas-board.entity.ts
src/entity/canvas-node.entity.ts
src/entity/canvas-asset.entity.ts
src/entity/canvas-task.entity.ts
src/entity/canvas-edge.entity.ts
src/entity/canvas-event.entity.ts
src/controller/canvas.controller.ts
src/service/canvas.service.ts
src/service/canvas-task.service.ts
src/service/canvas-agent.service.ts
```

edu-web 后续：

```text
src/pages/canvas/CanvasProjectsPage.tsx
src/pages/canvas/CanvasWorkspacePage.tsx
src/services/canvasService.ts
```

## 13. MVP 成功标准

第一版完成后，用户应该能做到：

1. 在核心菜单进入 Canvas。
2. 创建一个项目。
3. 进入该项目的无限画布。
4. 上传图片、写文本、整理资源。
5. 用选中的文本生成图片。
6. 用选中的图片继续编辑或变体。
7. 看到任务进度和失败原因。
8. 看到 AI 结果自动进入画布和资产库。
9. 追溯某个结果来自哪些节点、哪个 prompt、哪个 agent/model。

最小可演示路径：

```text
Canvas 菜单
-> 新建项目“618 商品主图”
-> 进入画布
-> 上传产品图
-> 新建文本节点“做一张红色促销主图”
-> 选中文本 + 产品图
-> 点击“多图合成 / 商品主图”
-> 任务节点生成中
-> 输出 4 张图片节点
-> 选择其中一张“图片转视频”
-> 生成视频节点
```
