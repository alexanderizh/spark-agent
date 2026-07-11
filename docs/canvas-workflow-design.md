# 画布工作流（Canvas Workflow）规划设计

> 状态: 待开发 | 最后核对: 2026-07-12

> 本文档是「画布工作流」新功能的全场景前后端规划设计。基于对现有画布能力的 4 轮深度调研 + 业界方案（ComfyUI / Dify / n8n / tldraw）对照 + 关键架构决策后产出。本文是规划，不含实现代码。

---

## 0. 背景与边界澄清

### 0.1 这是什么 / 不是什么

| 维度 | 是（本功能） | 不是 |
|------|------------|------|
| 工作流类型 | **画布工作流**：以画布 AI 操作节点为最小单元、画布内可见可编辑可运行、产物回写画布的轻量创作工作流 | 顶层 Agent 工作流（`workflows` 表 / `workflow-executor.ts`，面向 agent 自动化编排，11 种节点 kind，session 绑定） |
| 编排对象 | 画布上的 AI 操作节点（text_to_image / image_edit / text_generate …）及其连线 | 通用 SaaS 集成（n8n 式 webhook/API 连接器） |
| 运行产物 | 画布上的新节点 + 资产 + 血缘边（与现有创作体验一致） | 画布外的独立运行报告 |

**关键边界**：本项目已存在两套"工作流/pipeline"体系，本功能是第三套，且与前两者**解耦**：
1. 画布内 `canvasPipeline`（影视生产流水线，按 `pipelineRole` 推导下一步的状态机）—— 已落地，本功能**复用其状态机思想但不绑定影视语义**。
2. 顶层 `workflows` / `workflow_runs`（Agent 编排 DAG，强绑定 session）—— 本功能**不复用其表与 dispatch**，但**参考其拓扑调度算法**。
3. **本功能：画布工作流**——画布内独立体系，新建表 + 新建运行引擎。

### 0.2 已确认的架构决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 与顶层 workflow 关系 | **画布内独立体系**（新建 `canvas_workflows` / `canvas_workflow_runs` 表 + 画布专属运行引擎） | 顶层 `workflow_runs.session_id NOT NULL` 强绑定会话、dispatch 派发 agent 而非画布媒体/文本任务，复用需大改且耦合深；画布工作流需与节点/产物/血缘/stale 级联深度耦合，独立体系更清晰 |
| 提取粒度 | **AI 操作节点(Operation)为最小单元** | 仿 ComfyUI 范式，素材/文本/组节点降级为工作流的输入端口或变量；图清晰可复用 |
| 工作流位置 | **画布内生成与运行** | 与"画布即创作工作台"的产品定位一致；工作流在画布上可见、可编辑、可运行、产物直接落地 |
| 运行模式 | **单节点 / 从某节点向后 / 全流程 / 批量参数网格** 四种全要 | 覆盖从"调试单步"到"批量变体"全场景 |

---

## 1. 现状基线（调研结论速览）

### 1.1 已有的可复用资产

| 资产 | 位置 | 复用方式 |
|------|------|----------|
| 节点/边/任务/资产数据模型 | `canvas.types.ts` | 工作流节点定义直接派生自 `CanvasNode`（剔除坐标/锁/隐藏等画布专属字段，保留 operation/runtime/端口） |
| 15 种 AI 操作 + 能力注册表 | `canvas.capabilities.ts` (`CANVAS_CAPABILITIES`) | 工作流节点的"能力契约"（inputTypes/outputTypes）直接来自此表 |
| 模板蓝图结构 | `canvasTemplates.ts` (`NodeBlueprint`/`EdgeBlueprint`) | **工作流定义的现成数据结构雏形**：相对坐标 + ref 引用 + applyTemplate 落地机制 |
| 管线操作目录 | `canvasPipelineOps.ts` (13 个 op) | 右键"下一步"编排的数据源，可接入工作流编排器作为"插入节点"建议 |
| 生产状态机 | `canvasPipeline.ts` (confirm/stale/级联) | 工作流运行时的 stale 传播、断点续跑复用此思想 |
| 单任务执行链路 | `canvas:task:create-media` / `generate-text` IPC | 工作流节点执行的原子单元（dispatch 到此） |
| 后台任务并发写回 | `mergeCanvasBackgroundTaskSnapshot` | 工作流多节点并发运行的并发安全基础 |
| 事件回流 | `stream:canvas:media-task` / `text-task` | 工作流节点完成事件的现成通道 |
| 顶层 DAG 调度算法 | `workflow-executor.ts` (`orderWorkflowNodes`/`isWorkflowNodeReady`/断点续跑/`onSnapshot`) | **画布运行引擎的核心算法参照**（拓扑排序 + 就绪判定 + 快照） |
| JSON 提取范式 | `canvasEntityExtract.ts` (`buildEntityExtractionPrompt`/`tryParseJsonObject`) | **自动提取工作流的现成范式**：prompt 给 schema+example + 容错解析 |
| canvas MCP 工具 | `canvas.tools.ts` (50 个工具，含 `canvas_batch_create_nodes`/`canvas_query_nodes`/`canvas_run_operation`) | 自动提取 agent 可调用的画布操作原语 |
| 预设系统 | `canvasOperationPresets.ts` (localStorage 三层合并) | 工作流节点的默认参数来源 |

### 1.2 明确的设计空白（本功能要补）

1. 画布→工作流的**自动提取**完全缺失。
2. 画布内**可命名/可保存/可复用/可版本化**的工作流对象数据模型未落表。
3. 工作流**运行实例**的持久化与恢复（类似 `workflow_runs`）缺失。
4. 工作流的**输入/输出端口契约**与**变量引用**机制缺失。
5. 工作流的**编排交互**（创建/编辑/保存/命名/复用）缺失。
6. **批量/参数网格运行**与结果组织（对比墙/版本树）缺失。

---

## 2. 数据模型设计

### 2.1 核心类型（`canvas.types.ts` 新增）

#### 2.1.1 工作流定义 `CanvasWorkflow`

```ts
/** 工作流端口类型契约（仿 ComfyUI slot + Dify 变量类型） */
type CanvasWorkflowPortType = 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file' | 'any'

/** 工作流节点端口 */
type CanvasWorkflowPort = {
  id: string              // 端口稳定 id（工作流内唯一）
  name: string            // 显示名（如 "图像"、"提示词"、"主产物"）
  type: CanvasWorkflowPortType
  /** 端口语义：input=可被外部/上游填充；output=产物供下游引用 */
  direction: 'input' | 'output'
  /** 是否为该类型操作自动派生的端口（从 CANVAS_CAPABILITIES 推导），还是用户手填 */
  derived?: boolean
}

/**
 * 工作流节点（CanvasNode 的"纯逻辑投影"）。
 * 剥离画布坐标/锁/隐藏等，保留 operation + runtime 配置 + 端口契约。
 * 仿 ComfyUI 的 execute 图节点 + Dify 的节点参数。
 */
type CanvasWorkflowNode = {
  /** 工作流内稳定 ref（跨保存/加载保持引用，对应 NodeBlueprint.ref） */
  ref: string
  /** 节点标题（如 "生成角色立绘"） */
  title?: string
  /** 节点种类：media=媒体生成 / text=文本生成 / input=输入参数 / output=产物出口 / transform=变量转换 */
  kind: 'media' | 'text' | 'input' | 'output' | 'transform'
  /** AI 操作类型（media/text kind 必填，input/output/transform 为空） */
  operation?: CanvasOperationType
  /** 流水线语义角色（可选，用于着色与编排建议） */
  pipelineRole?: CanvasPipelineRole
  /** 输入端口（operation 时由 CANVAS_CAPABILITIES 自动派生 + 可追加自定义变量端口） */
  inputs: CanvasWorkflowPort[]
  /** 输出端口（operation 时按 outputMode 派生：single=1个 / candidates=多个 / collection=多组） */
  outputs: CanvasWorkflowPort[]
  /** runtime 配置（与 CanvasNodeData 同构的子集） */
  runtime: {
    prompt?: string
    negativePrompt?: string
    modelParams?: Record<string, unknown>
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    agentId?: string
    skillIds?: string[]
    reasoningEffort?: SessionReasoningEffort
    outputMode?: CanvasOperationOutputMode
  }
  /** 该节点是否标记为工作流入口（手动指定，用于"从入口运行"） */
  isEntry?: boolean
}

/**
 * 工作流连线（数据流边）。
 * 仿 ComfyUI link（origin_slot→target_slot 精确端口连接），比现有 CanvasEdge 更精确。
 */
type CanvasWorkflowEdge = {
  id: string
  /** 源节点 ref + 源端口 id（精确到端口，支持一个节点多输出分别连不同下游） */
  from: { nodeRef: string; portId: string }
  /** 目标节点 ref + 目标端口 id */
  to: { nodeRef: string; portId: string }
}

/** 工作流输入参数声明（仿 Dify Start 节点，定义工作流"对外接口"） */
type CanvasWorkflowInputField = {
  key: string             // 参数键（如 "character_desc"）
  label: string           // 显示名
  type: CanvasWorkflowPortType
  required: boolean
  defaultValue?: string
  /** 绑定到哪个 input 节点的哪个端口 */
  boundNodeRef?: string
  boundPortId?: string
}

/** 完整工作流定义 */
type CanvasWorkflow = {
  id: string
  projectId: string       // 归属项目（工作流存于项目维度，可跨 board 复用）
  userId: number
  name: string
  description?: string
  /** 版本号（语义化版本，变更结构时递增） */
  version: number
  /** 节点 */
  nodes: CanvasWorkflowNode[]
  /** 连线 */
  edges: CanvasWorkflowEdge[]
  /** 输入参数声明（对外接口） */
  inputs: CanvasWorkflowInputField[]
  /** 输出声明（运行结束后导出哪些产物） */
  outputs?: Array<{ nodeRef: string; portId: string; label: string }>
  /** 布局元信息（可选，用于"应用模板到画布"时的初始排版） */
  layout?: { nodePositions: Record<string, { x: number; y: number }> }
  /** 缩略图（最近一次运行的代表产物） */
  thumbnailUrl?: string
  /** 标签（便于管理/检索） */
  tags?: string[]
  status: 'draft' | 'published' | 'archived'
  /** 来源：手动编排 / 从画布提取 / 从模板创建 / 导入 */
  source: 'manual' | 'extracted' | 'template' | 'imported'
  /** 提取来源（source=extracted 时记录原画布快照 hash） */
  extractedFrom?: { snapshotHash: string; nodeIds: string[] }
  createdAt: string
  updatedAt: string
}
```

#### 2.1.2 工作流运行实例 `CanvasWorkflowRun`

```ts
type CanvasWorkflowRunStatus =
  | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'

/** 单个节点的一次执行记录 */
type CanvasWorkflowNodeExecution = {
  nodeRef: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  /** 对应的真实 CanvasTask.id（dispatch 后回填） */
  taskId?: string
  /** 对应的画布节点 id（运行时实例化的承载节点） */
  canvasNodeId?: string
  startedAt?: string
  endedAt?: string
  errorMsg?: string
  /** 该节点本次执行的产物端口值（portId → 产物引用） */
  outputValues?: Record<string, { nodeId?: string; assetId?: string; value?: string }>
  /** 批量运行时的批次索引 */
  batchIndex?: number
}

/** 工作流运行实例（仿 workflow_runs，支持断点续跑） */
type CanvasWorkflowRun = {
  id: string
  workflowId: string
  projectId: string
  userId: number
  /** 运行时的图快照（拷贝当时的 workflow.nodes/edges，避免定义后续修改影响运行） */
  graphSnapshot: { nodes: CanvasWorkflowNode[]; edges: CanvasWorkflowEdge[] }
  /** 运行输入（实际填入的参数值） */
  inputValues: Record<string, unknown>
  status: CanvasWorkflowRunStatus
  /** 运行模式 */
  mode: 'single' | 'from_node' | 'full' | 'batch'
  /** batch 模式的参数网格（每项 = 一次独立运行的输入覆盖） */
  batchGrid?: Array<{ label: string; overrides: Record<string, unknown> }>
  /** 节点执行状态（断点续跑的核心） */
  executions: CanvasWorkflowNodeExecution[]
  /** 已完成节点 ref 集合（拓扑推进依据） */
  completedNodeRefs: string[]
  /** 失败节点 ref（续跑起点） */
  failedNodeRef?: string
  /** 运行时变量池（portId → 值，仿 Dify 变量池） */
  variablePool: Record<string, unknown>
  /** 运行产生的画布节点 id（便于定位产物） */
  outputCanvasNodeIds: string[]
  /** 运行起点（mode=from_node 时的起始 nodeRef） */
  startNodeRef?: string
  startedAt: string
  updatedAt: string
  endedAt?: string
}
```

### 2.2 持久化层（新增 migration）

#### 表 `canvas_workflows`
```sql
-- Migration: canvas_workflows
CREATE TABLE IF NOT EXISTS canvas_workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL,        -- { nodes, edges, inputs, outputs, layout }
  thumbnail_url TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source TEXT NOT NULL DEFAULT 'manual',
  extracted_from_json TEXT,             -- { snapshotHash, nodeIds[] }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_canvas_workflows_project
  ON canvas_workflows(project_id, status, updated_at);
```

#### 表 `canvas_workflow_runs`
```sql
-- Migration: canvas_workflow_runs（仿 workflow_runs，project_id 外键非 session_id）
CREATE TABLE IF NOT EXISTS canvas_workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  graph_snapshot_json TEXT NOT NULL,    -- 运行时图快照
  input_values_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','paused','completed','failed','canceled')),
  mode TEXT NOT NULL DEFAULT 'full'
    CHECK (mode IN ('single','from_node','full','batch')),
  batch_grid_json TEXT,                 -- batch 模式参数网格
  executions_json TEXT NOT NULL DEFAULT '[]',
  completed_node_refs_json TEXT NOT NULL DEFAULT '[]',
  failed_node_ref TEXT,
  variable_pool_json TEXT NOT NULL DEFAULT '{}',
  output_canvas_node_ids_json TEXT NOT NULL DEFAULT '[]',
  start_node_ref TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES canvas_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_canvas_workflow_runs_project
  ON canvas_workflow_runs(project_id, status, started_at);
CREATE INDEX IF NOT EXISTS idx_canvas_workflow_runs_resume
  ON canvas_workflow_runs(workflow_id, status, updated_at);
```

#### Repository 层（`packages/storage/src/repositories/`）
- `canvas-workflow.repository.ts`：`CanvasWorkflowRepository`（CRUD + listByProject + duplicate + 版本管理）。
- `canvas-workflow-run.repository.ts`：`CanvasWorkflowRunRepository`（CRUD + `findLatestResumable(workflowId)` + `markStaleAsFailed`，**完全参照现有 `WorkflowRunRepository`**）。
- 在 `packages/storage/src/repositories/index.ts` 导出工厂 `getCanvasWorkflowRepo()` / `getCanvasWorkflowRunRepo()`。

---

## 3. 三大功能设计

### 3.1 功能一：直接编排画布工作流

#### 3.1.1 编排交互设计

**入口**：画布工具栏新增「工作流」模式切换（与现有"创作模式"并列），或右侧面板新增「工作流」tab。

**编排画布**（复用现有 CanvasStage 画布，不另起画布）：
- 工作流节点 = 画布上的 AI 操作节点，但在工作流模式下高亮显示端口（输入/输出 handle）。
- **从节点端口拖出连线** → 弹出能力感知菜单（复用 `getOpsForRole` / `CANVAS_CAPABILITIES`），自动建议可接的下游操作节点。
- **input/output 节点**：新增两种特殊节点类型（kind:'input'/'output'），分别定义工作流的"对外输入参数"和"导出产物"，仿 Dify 的 Start/End 节点。
- 节点配置复用现有 `CanvasOperationPanel`（提示词/模型/参数/agent/skills），新增"端口"配置区。

**三种工作流编辑粒度**（参考业界方案给用户选择）：

| 方案 | 描述 | 适合场景 |
|------|------|----------|
| **A. 画布即工作流（推荐主力）** | 在现有画布上选中一组操作节点+连线 → 右键「保存为工作流」→ 弹出命名/输入输出绑定对话框 → 落库。零学习成本，所见即所得 | 80% 场景：用户先在画布上跑通一遍，再固化复用 |
| **B. 工作流编辑面板（进阶）** | 右侧/独立面板呈现工作流图（节点卡片+端口+连线），可拖拽配置。仿 ComfyUI 独立编辑器视图，但节点配置面板复用现有 | 需要精细编排端口/变量引用、批量参数化时 |
| **C. 右键一键编排增强（轻量）** | 扩展现有 `canvasPipelineOps` 右键菜单，支持"插入到工作流""连接到工作流入口"等动作 | 快速搭建、教学引导 |

**建议落地顺序**：A（MVP）→ C（提效）→ B（高阶）。

#### 3.1.2 端口契约自动推导

操作节点的端口**不要求用户手填**，由系统从 `CANVAS_CAPABILITIES` + `outputMode` 自动派生：

```
operation: text_to_image
  → inputs: [{ name:'提示词', type:'text|prompt', derived:true }, { name:'参考图(可选)', type:'image', derived:true }]
  → outputs: outputMode=single ? [{name:'主产物', type:'image'}] : [{name:'候选1',...},{name:'候选2',...}]
```

用户可在此基础上**追加自定义变量输入端口**（如"风格描述"变量，手动绑定到 prompt 模板的某个槽位），这是"参数网格运行"的基础。

#### 3.1.3 变量引用机制（仿 Dify 变量池）

- 工作流节点 prompt/modelParams 支持 `{{nodeRef.portId}}` 占位符。
- 运行时引擎解析占位符 → 从 `variablePool` 取值替换。
- input 节点的端口值 → 运行开始时由 `inputValues` 填充进 variablePool。
- 上游节点产物 → 完成时写入 variablePool，供下游引用。

---

### 3.2 功能二：现成画布自动提取为工作流

#### 3.2.1 提取流程（两段式）

```
用户选中画布节点（或全选）→ 右键「提取为工作流」
  ↓
【阶段1：结构提取】纯本地算法，不调 agent
  - 遍历选中节点，筛出 AI 操作节点（isOperationNode）
  - 遍历这些节点间的 used_as_input/generated 边，构建子图
  - 素材/文本/组节点 → 降级为"输入源"：分析它们连入哪个操作节点的哪个输入端口
  - 产出一份"候选工作流草稿"（CanvasWorkflow draft）
  ↓
【阶段2：智能精炼】（可选，调平台 agent）复用 canvasEntityExtract 范式
  - 调 canvas:task:generate-text，modelParams: { workflow:'extract_canvas_workflow', responseFormat:'json' }
  - prompt 给出工作流 JSON schema + example + 当前草稿 + 节点摘要
  - 让 agent 做三件事：
    ① 命名 + 描述（根据节点标题/operation/pipelineRole 语义归纳）
    ② 识别输入参数（哪些上游素材应暴露为工作流的"对外输入字段"）
    ③ 优化端口连接（合并冗余、补全缺失的输入契约）
  - tryParseJsonObject 容错解析 → 合并回草稿
  ↓
弹出"提取结果确认"对话框（用户可编辑命名/输入/端口）→ 保存为 CanvasWorkflow
```

#### 3.2.2 大画布的兜底路径

当选中节点过多（>30 个操作节点），全量塞 prompt 会超限。此时走 **agent 会话路径**：
- 复用 `CanvasAgentModal` 机制：attach session + canvas-studio skill + spark_canvas MCP 工具。
- 让 agent 通过 `canvas_list_nodes` / `canvas_query_nodes` / `canvas_get_node` **主动读取**画布节点，再在对话里输出工作流 JSON。
- 这条路径支持流式、工具调用，但成本更高，作为大图兜底。

#### 3.2.3 提取的语义规则（本地算法，确定性）

| 画布元素 | 提取为 | 规则 |
|----------|--------|------|
| AI 操作节点 | `CanvasWorkflowNode`（kind: media/text） | 直接映射，operation/runtime 从 CanvasNodeData 提取 |
| 素材节点(image/audio/video) | **不作为工作流节点** | 若被操作节点引用 → 转为该操作节点的"静态输入端口默认值"；若无下游 → 丢弃 |
| 文本/prompt 节点 | **不作为工作流节点** | 内容提取为下游操作节点的 prompt 模板（或 input 字段） |
| group 节点 | 忽略结构，仅保留命名提示 | 提取时用 group.title 作为工作流分区的参考 |
| used_as_input 边 | `CanvasWorkflowEdge` | 源→目标端口精确映射（按节点 capability 推断端口） |
| generated 边 | `CanvasWorkflowEdge` | 任务节点产物 → 产物节点，转 from(operation 的 output port) → to(下游 input port) |
| 多次运行历史(CanvasTask) | 忽略 | 工作流定义只保留"最后一次有效配置"，运行历史不提取 |

#### 3.2.4 提取结果校验

提取后必须通过校验才能保存：
- **连通性**：所有非 input 节点的必填输入端口必须有来源（input 节点或上游 output）。
- **无环**（除显式 loop 外）：拓扑排序必须成功。
- **端口类型兼容**：`CanvasWorkflowPortType` 连接需兼容（image→image，text→text|prompt，any→any）。
- **至少一个 output 或下游终点**：空工作流不允许。

---

### 3.3 功能三：工作流的应用运行

#### 3.3.1 运行引擎设计（`packages/agent-runtime` 新增）

新增 **`CanvasWorkflowExecutor`**（`packages/agent-runtime/src/services/canvas-workflow-executor.ts`），**核心算法参照 `workflow-executor.ts`，但 dispatch 到画布任务而非 agent**：

```ts
// 执行器接口（伪代码，展示 dispatch 差异）
executeCanvasWorkflow(input: {
  graph: { nodes: CanvasWorkflowNode[]; edges: CanvasWorkflowEdge[] }
  inputValues: Record<string, unknown>
  mode: 'single' | 'from_node' | 'full' | 'batch'
  startNodeRef?: string
  batchGrid?: Array<{ label: string; overrides: Record<string, unknown> }>
  projectId: string
  boardId: string
  // dispatch：把一个工作流节点 dispatch 成画布任务（关键差异点）
  dispatch: (node: CanvasWorkflowNode, ctx: {
    resolvedInputs: ResolvedPortValue[]   // 已解析的输入（来自 variablePool/上游产物）
    canvasNodeId?: string                 // 复用已有承载节点，或新建
    placement: { x: number; y: number }   // 产物落点
    batchIndex?: number
  }) => Promise<{ taskId: string; canvasNodeId: string }>
  initialCompletedNodeRefs?: Iterable<string>   // 断点续跑
  onSnapshot?: (run: CanvasWorkflowRun) => void | Promise<void>
}): Promise<CanvasWorkflowRun>
```

**核心循环**（参照 workflow-executor.ts:356-410）：
1. `orderWorkflowNodes`（拓扑排序）。
2. `while (pendingNodes.size > 0)`：
   - 找 ready 节点（`isWorkflowNodeReady`：所有必填输入端口有值 + edge condition 满足）。
   - **并行可并行的 ready 节点**（无依赖关系的节点 `Promise.all`），串行执行有依赖的。
   - 解析变量占位符 `{{nodeRef.portId}}`。
   - `dispatch` 调画布单任务 IPC（media→`canvas:task:create-media`，text→`canvas:task:generate-text`）。
   - 等待任务完成（监听 `stream:canvas:media-task`/`text-task`）→ 产物写入 variablePool + executions。
   - `onSnapshot` 持久化运行状态（断点续跑点）。
   - 死锁检测（无 ready 节点但 pending 非空 → fail）。
3. batch 模式：外层再套一层循环，每个 batch item 独立跑一遍（或并行 N 个 run，受并发上限约束）。

**与顶层 workflow-executor 的关键差异**：
| 维度 | 顶层 workflow-executor | 画布 CanvasWorkflowExecutor |
|------|----------------------|---------------------------|
| dispatch 目标 | team member agent（LLM 推理） | 画布媒体/文本单任务（IPC） |
| 持久化外键 | session_id (NOT NULL) | project_id |
| 节点 kind | 11 种（agent/approval/verify…） | 5 种（media/text/input/output/transform） |
| 产物 | agent 消息/artifact | 画布节点+资产+血缘 |
| 端口 | 无显式端口，靠 edge + state | 显式 port（仿 ComfyUI slot） |
| 变量 | state dict | variablePool + `{{}}` 占位符 |
| 并发安全 | 单 session 串行 | 复用 `mergeCanvasBackgroundTaskSnapshot` |

#### 3.3.2 四种运行模式

| 模式 | 触发 | 行为 |
|------|------|------|
| **单节点运行** | 右键工作流节点「运行此节点」 | 仅 dispatch 该节点（输入从 variablePool/默认值取），复用现有 `runOperationNode` |
| **从某节点向后运行** | 右键「从此节点向后运行」 | 以该节点为起点，拓扑向后执行所有下游（仿 ComfyUI "run from here"），`mode:'from_node'` + `startNodeRef` |
| **全流程运行** | 工作流面板「运行」按钮 | 从 input 节点/入口开始，拓扑全执行，`mode:'full'` |
| **批量/参数网格运行** | 「批量运行」对话框（填参数矩阵） | 外层循环 N 次，每次用不同 overrides，`mode:'batch'` + `batchGrid`；结果按 batchIndex 组织成"对比墙" |

#### 3.3.3 运行实例化：工作流 → 画布节点

工作流运行不是"无中生有"，而是**在画布上实例化**：
1. 根据 `workflow.layout` 或自动布局算法（复用 `canvasAutoLayout.ts`），在工作流运行区生成承载节点。
2. 每个 `CanvasWorkflowNode` → 一个真实 `CanvasNode`（type=operation，data.runtime 来自 workflow node）。
3. `CanvasWorkflowEdge` → 真实 `CanvasEdge`（used_as_input/generated）。
4. 运行产出的新产物节点 → 自动连线 + 写入 run.outputCanvasNodeIds。
5. run 完成后，这些画布节点**保留**（用户可继续在画布上二次创作），与"画布即工作台"一致。

#### 3.3.4 断点续跑与失败处理

- 每个节点 dispatch 完成后 `onSnapshot` → 更新 `canvas_workflow_runs`（executions/completedNodeRefs/variablePool）。
- 失败时记录 `failedNodeRef`，run 状态 `failed`。
- 用户可「从失败节点续跑」：新建 run，`initialCompletedNodeRefs` = 已完成节点，从 failed 节点重试。
- 复用 `canvasPipeline` 的 **stale 级联**：工作流中某节点参数变更 → 下游节点标 stale → 提示重跑。

---

## 4. 工作流管理（CRUD + 检索 + 复用）

### 4.1 管理 UI

- **工作流面板**（右侧新增 tab 或画布工具栏入口）：列出当前项目所有工作流卡片（缩略图/名称/标签/最近运行），支持搜索/标签筛选/排序。
- **工作流详情对话框**：编辑名称/描述/标签/输入输出声明，查看节点图预览。
- **操作**：新建（空白）、从画布提取、从模板创建、复制、删除（软删 status=archived）、导出（JSON）、导入。
- 参照现有 `CanvasProjectsView.tsx`（项目管理）的交互模式。

### 4.2 复用机制

- **应用工作流到画布**（apply）：选工作流 → 选落点 → 实例化为画布节点组合（复用 `canvasApi.applyTemplate` 机制，扩展为 workflow blueprint）。
- **跨 board/项目复用**：工作流定义存于 project 维度，可通过"导出 JSON + 导入"或未来的"工作流市场"跨项目共享。
- **嵌套引用（Phase 2）**：一个工作流节点可以是"子工作流"调用（kind 扩展 'subworkflow'），递归执行。

### 4.3 CRUD API（渲染进程 `canvas.api.ts` 新增）

```ts
// canvasApi 新增方法
listWorkflows(projectId): Promise<CanvasWorkflow[]>
getWorkflow(workflowId): Promise<CanvasWorkflow | null>
createWorkflow(input: { projectId; name; description?; nodes; edges; inputs }): Promise<CanvasWorkflow>
updateWorkflow(workflowId, patch): Promise<CanvasWorkflow>
deleteWorkflow(workflowId): Promise<void>           // 软删 status=archived
duplicateWorkflow(workflowId, newName): Promise<CanvasWorkflow>
extractWorkflowFromCanvas(input: { projectId; nodeIds; refineWithAgent?: boolean }): Promise<CanvasWorkflow>
applyWorkflowToCanvas(workflowId, { boardId; x; y; inputValues? }): Promise<{ canvasNodeIds: string[] }>
runWorkflow(workflowId, { mode; inputValues; startNodeRef?; batchGrid? }): Promise<CanvasWorkflowRun>
listWorkflowRuns(workflowId): Promise<CanvasWorkflowRun[]>
resumeWorkflowRun(runId): Promise<CanvasWorkflowRun>
cancelWorkflowRun(runId): Promise<void>
```

### 4.4 IPC 通道新增（主进程）

```
canvas:workflow:list / get / create / update / delete / duplicate
canvas:workflow:extract          # 触发提取（含可选 agent 精炼）
canvas:workflow:apply            # 应用到画布
canvas:workflow:run              # 启动运行
canvas:workflow:run:list / get
canvas:workflow:run:resume       # 断点续跑
canvas:workflow:run:cancel
stream:canvas:workflow-run       # 运行进度事件流（{runId, status, nodeRef, progress, ...}）
```

---

## 5. 前端文件拆分规划

遵循"单文件不超过 3000 行"规范，新增模块独立成文件：

```
apps/desktop/src/renderer/design/views/canvas/
├── workflow/                              # 新建子目录
│   ├── canvasWorkflow.types.ts            # CanvasWorkflow / CanvasWorkflowRun 类型
│   ├── canvasWorkflowApi.ts               # 渲染端 API 封装（调 IPC）
│   ├── canvasWorkflowStore.ts             # 工作流列表/运行状态 hooks（参照 canvas.store.ts）
│   ├── canvasWorkflowPorts.ts             # 端口契约自动推导（CANVAS_CAPABILITIES → ports）
│   ├── canvasWorkflowTopology.ts          # 拓扑排序/就绪判定/校验（纯逻辑，易测试）
│   ├── canvasWorkflowExtractor.ts         # 画布→工作流 提取算法（本地结构提取）
│   ├── canvasWorkflowExtractorPrompt.ts   # agent 精炼 prompt（仿 canvasEntityExtract）
│   ├── canvasWorkflowRunner.ts            # 渲染端运行协调（建节点/监听回流/更新 run）
│   ├── canvasWorkflowVariablePool.ts      # 变量池 + {{}} 占位符解析
│   ├── canvasWorkflowBatch.ts             # 批量/参数网格运行逻辑
│   ├── CanvasWorkflowPanel.tsx            # 工作流管理面板（列表/卡片）
│   ├── CanvasWorkflowEditorModal.tsx      # 工作流编辑对话框（命名/输入输出/端口）
│   ├── CanvasWorkflowRunDialog.tsx        # 运行对话框（模式选择/输入填写/批量网格）
│   ├── CanvasWorkflowRunHistory.tsx       # 运行历史列表
│   ├── CanvasWorkflowNodePorts.tsx        # 节点端口可视化（工作流模式下的 handle）
│   └── canvasWorkflowTemplates.ts         # 内置工作流模板（扩展现有 canvasTemplates.ts）
```

**主进程 / 运行时**：
```
packages/agent-runtime/src/services/
├── canvas-workflow-executor.ts            # 运行引擎（参照 workflow-executor.ts）

packages/storage/src/repositories/
├── canvas-workflow.repository.ts          # CanvasWorkflowRepository
├── canvas-workflow-run.repository.ts      # CanvasWorkflowRunRepository

packages/storage/migrations/
├── 041_canvas_workflows.sql
├── 042_canvas_workflow_runs.sql

apps/desktop/src/main/ipc/index.ts         # 新增 canvas:workflow:* handler（不膨胀，考虑拆 ipc/canvas-workflow-handlers.ts）
```

**现有文件改动（最小侵入）**：
- `canvas.types.ts`：新增工作流类型（追加，不改动现有）。
- `canvas.tools.ts`：新增 `canvas_save_workflow` / `canvas_extract_workflow` / `canvas_run_workflow` 等 MCP 工具（让 agent 也能驱动工作流）。
- `CanvasWorkspaceView.tsx`：工作流模式切换入口、右键菜单追加「保存为工作流」「提取为工作流」（该文件已超大，改动要克制，逻辑尽量下沉到 workflow/ 子目录）。
- `canvasContextMenuModel.ts`：右键菜单模型追加工作流分组。

---

## 6. 实施分期建议

| 阶段 | 目标 | 关键交付 | 验收标准 |
|------|------|----------|----------|
| **P0 基座** | 数据模型 + CRUD + 基本编排 | migration + repository + types + 管理面板 + 画布即工作流（方案 A：选中节点保存为工作流） | 能创建/编辑/删除/列表工作流；能从画布选中操作节点保存为命名工作流 |
| **P1 运行** | 全流程 + 单节点 + 从节点向后运行 | CanvasWorkflowExecutor + 运行对话框 + 运行实例持久化 + 断点续跑 | 能运行工作流，产物落地画布，失败可续跑，运行历史可查 |
| **P2 提取** | 自动提取（本地 + agent 精炼） | 提取算法 + agent 精炼 prompt + 提取校验 | 能从任意画布选区提取工作流，agent 精炼命名/输入，校验通过可保存 |
| **P3 批量** | 参数网格运行 + 结果对比 | batchGrid 运行 + 对比墙 UI | 能以参数矩阵批量运行，结果按批次对比呈现 |
| **P4 进阶**（可选） | 工作流编辑面板（方案 B）+ 嵌套子工作流 + 模板市场 | 独立工作流图编辑器 + subworkflow kind + 导入导出/分享 | 支持脱离画布精细编排端口，工作流可嵌套复用 |

---

## 7. 风险与质疑校验

### 7.1 关键风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `CanvasWorkspaceView.tsx` 已 8000+ 行，工作流功能易使其进一步膨胀 | 高 | 所有工作流 UI/逻辑下沉到 `workflow/` 子目录，主文件只接入口和右键菜单项 |
| 并发运行多节点时的快照竞态 | 高 | 复用 `mergeCanvasBackgroundTaskSnapshot` 按 id 合并机制；运行引擎串行 dispatch 或受限并行（并发上限） |
| agent 提取结果不可预测（JSON 解析失败/结构错误） | 中 | 本地结构提取先产出确定草稿，agent 仅做"精炼"非"生成"；tryParseJsonObject 容错；强制校验才允许保存 |
| 端口类型契约过严导致连线困难 | 中 | 引入 `any` 类型兜底；提供"自动连接"建议（按 capability 推荐可连端口）；不兼容时给 warning 而非 hard block |
| batch 运行 N 次的 token/费用爆炸 | 中 | 运行前预估总任务数 + 预估耗时/费用提示；设并发上限；支持随时取消 |

### 7.2 已校验的反向质疑

- **Q: 为什么不直接复用顶层 workflow-executor？**
  A: 已验证 `workflow_runs.session_id NOT NULL` 强绑定会话、dispatch 派发 agent（LLM 推理）而非画布媒体/文本任务。复用需：解除 session 绑定 + 重写 dispatch 签名 + 新增 5 种节点 kind + 打通 CanvasNode↔workflow node 转换。改动量 ≥ 新建，且耦合深，故选独立体系。但**拓扑/就绪/快照算法直接移植**，非重复造轮子。

- **Q: 工作流定义为什么要独立存表，而不是塞进 canvas_snapshots 的 JSON blob？**
  A: 工作流需跨 board 复用、需版本管理、需独立检索、运行实例需断点续跑（频繁更新），塞进大 JSON blob 会与画布节点编辑互相干扰且性能差。独立表 + project_id 外键是正确范式（与顶层 workflows 表设计一致）。

- **Q: 提取粒度选"操作节点为最小单元"，那画布上的文本提示词怎么办？**
  A: 文本/prompt 节点**降级**为下游操作节点的 prompt 模板内容（或暴露为 input 字段），不作为独立工作流节点。这与 ComfyUI 把 prompt 作为 widget value 而非独立节点一致，保持工作流图简洁。

- **Q: 工作流运行产物为什么要留在画布上，而不是独立结果区？**
  A: 已确认"画布内生成与运行"。产物留画布与现有创作体验一致（用户可继续二次创作/派生），且血缘/资产/任务复用现有写回机制，无需新建产物存储。

---

## 8. 待用户进一步确认的开放问题

> 这些不阻塞规划落地，但影响 P1 之后的体验细节，建议实施前对齐。

1. **工作流是否需要"发布/版本"机制？**（draft→published，published 版本不可改，改则升版本）—— 当前设计预留了 version 字段，但未强制不可变。
2. **工作流的共享范围？**（仅项目内 / 跨项目 / 未来云端市场）—— 当前设计存 project 维度 + 导入导出。
3. **是否需要工作流的"定时/触发"运行？**（仿 n8n trigger）—— 当前设计未包含，属自动化场景，与"创作工作流"定位不同。
4. **agent 精炼提取时，是否允许 agent 修改操作节点的 runtime 配置（如换模型）？**—— 当前设计 agent 仅做命名/输入识别/端口优化，不改 runtime。

---

## 附：调研证据索引

详细调研笔记见 `.spark-artifacts/canvas-workflow-research-notes.md`。关键事实出处：
- 数据模型：`canvas.types.ts:10-416`
- 现有 pipeline：`canvasPipeline.ts` / `canvasPipelineOps.ts:37-155` / `canvasOperationPresets.ts`
- 后端持久化：`packages/storage/migrations/027/031/035/036` / `canvas.repository.ts`
- 任务执行：`apps/desktop/src/main/ipc/index.ts:3210/3291` / `media-task-runtime.service.ts`
- 顶层 workflow 引擎：`packages/agent-runtime/src/services/workflow-executor.ts:183/251/264/333`
- workflow_runs 表：`packages/storage/migrations/040_workflow_runs.sql`（session_id NOT NULL）
- JSON 提取范式：`canvasEntityExtract.ts:329/390`
- canvas MCP 工具：`canvas.tools.ts`（50 个工具）
- 业界方案：ComfyUI（双 JSON 格式，`docs.comfy.org/specs/workflow_json`）/ Dify（节点+变量池，`docs.dify.ai/en/guides/workflow/node`）/ n8n（trigger+connection）/ tldraw（workflow starter kit）
