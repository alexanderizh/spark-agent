# 画布工作流（Canvas Workflow）规划设计

> 状态: 待开发 | 最后核对: 2026-07-12

> 本文档是「画布工作流」新功能的全场景前后端规划设计。基于对现有画布能力的 **8 轮深度调研**（项目结构 → 数据模型 → 隐式工作流体系 → 后端持久化 → agent-runtime/平台能力 → 已有文档 → 业界对照 → **算法级实现细节**：输入解析/产物组织/连线交互/参数继承/运行回写/产物投影/风格注入/stale 级联）+ 关键架构决策后产出。本文是规划，不含实现代码，但所有设计决策都锚定到现有实现的精确语义规则（见 §9 算法级规约）。

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

> **端口设计锚点**（基于 §9.1 调研结论）：现有 `CANVAS_CAPABILITIES` 已定义每个 operation 的 `inputTypes/outputTypes`，且产物有 4 种 `outputMode`（single/candidates/collection/bundle），媒体输入有角色（first_frame/last_frame/reference_image）。端口契约必须精确表达这些，否则工作流运行时的输入解析会与单任务运行不一致。

```ts
/** 工作流端口类型契约（仿 ComfyUI slot + Dify 变量类型） */
type CanvasWorkflowPortType = 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file' | 'any'

/**
 * 媒体输入角色（锚定 canvasMediaInputRoles.ts 的语义）。
 * 仅 type=image/video 的端口有意义；决定 dispatch 时该端口值映射到 task inputFile 的哪个 role。
 * 仿 ComfyUI slot 的 role 限定，而非简单类型匹配。
 */
type CanvasWorkflowPortRole =
  | 'first_frame'      // image_to_video / video_edit 的首帧
  | 'last_frame'       // 尾帧
  | 'reference_image'  // 参考图（多张可重复）
  | 'input_video'      // 输入视频（video_edit/video_extend）
  | 'reference_video'  // 参考视频
  | 'audio'            // 音频输入
  | 'text_context'     // 文本上下文（注入 prompt 的「画布节点内容」段，锚定 mergePromptWithNodeContext）
  | 'primary_output'   // output 端口：主产物
  | 'candidate_output' // output 端口：候选产物
  | 'collection_item'  // output 端口：集合单项

/** 工作流节点端口 */
type CanvasWorkflowPort = {
  id: string              // 端口稳定 id（工作流内唯一，如 "in_image_0" / "out_primary"）
  name: string            // 显示名（如 "首帧"、"提示词"、"主产物"）
  type: CanvasWorkflowPortType
  /** 端口语义：input=可被外部/上游填充；output=产物供下游引用 */
  direction: 'input' | 'output'
  /** 媒体角色（锚定 canvasMediaInputRoles），决定 dispatch 时该端口值如何映射到 task input */
  role?: CanvasWorkflowPortRole
  /** 是否为该操作自动派生的端口（从 CANVAS_CAPABILITIES + outputMode 推导），还是用户自定义变量端口 */
  derived?: boolean
  /** 是否必填（input 端口）；output 端口恒为可选 */
  required?: boolean
  /** 多值端口（如 reference_image 可重复接入多个上游；collection 产出多个） */
  multiple?: boolean
  /** 该 input 端口的值来源：static（默认值）/ runtime（运行时填）/ upstream（上游 output 绑定） */
  source?: 'static' | 'runtime' | 'upstream'
  /** 静态默认值（source=static 时，如固定参考图 url 或 prompt 文本） */
  defaultValue?: string
}
```

**端口自动推导算法**（见 §9.1 规约 R1-R4）：
- `derivePorts(operation)` → `{ inputs: Port[], outputs: Port[] }`
- inputs：遍历 `capability.inputTypes`，每个 type 生成一个 derived input 端口；若 operation ∈ {image_to_video, video_edit} 额外生成 first_frame/last_frame 端口；text/prompt 类型端口标记 `role:'text_context'`。
- outputs：按 `node.runtime.outputMode`（或继承自 capability 默认）生成——single→1 个 primary_output；candidates→1 primary + N candidate；collection/bundle→collection_item(multiple:true)。
- 用户可在 derived 端口基础上**追加自定义变量输入端口**（source=runtime，运行时由 `inputValues` 填充），这是参数网格运行的基础。

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
【阶段2：智能精炼】（可选，调平台 agent）完全照搬 canvasEntityExtract 范式
  - 调 canvas:task:generate-text，modelParams: { workflow:'extract_canvas_workflow', responseFormat:'json' }
  - prompt 结构严格仿 buildEntityExtractionPrompt（canvasEntityExtract.ts:329）：
    ① 任务定位 + 硬性格式要求（只输出 JSON，不要 Markdown/代码块/解释）
    ② JSON 顶层结构定义 {workflow:{name,description,nodes:[{ref,kind,operation,inputs,outputs,runtime}],edges,inputs}}
    ③ 字段约束 + **完整 example JSON（详尽示例对齐，照搬 entityExtract 的 example 模式）**
    ④ 精细化要求（命名要语义化、输入识别要准确、端口连接要完整）
    ⑤ 当前草稿 JSON（阶段1产物）+ 节点摘要列表
  - agent 做三件事：
    ① 命名 + 描述（根据节点标题/operation/pipelineRole 语义归纳）
    ② 识别输入参数（哪些上游素材应暴露为工作流的"对外输入字段"，仿 Dify Start 节点）
    ③ 优化端口连接（合并冗余、补全缺失的输入契约，按 §9.1 R1-R4 端口推导规则校验）
  - tryParseJsonObject（canvasEntityExtract.ts:390）三段容错解析 → 字段归一化 → 合并回草稿
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

**核心循环**（参照 workflow-executor.ts:356-410，遵守 §9 规约）：
1. `orderWorkflowNodes`（拓扑排序）。
2. `while (pendingNodes.size > 0)`：
   - 找 ready 节点（`isWorkflowNodeReady`：所有必填 input 端口在 variablePool 有值 + edge condition 满足）—— §9.9 R32。
   - **并行可并行的 ready 节点**（无依赖关系的节点 `Promise.all`，每节点 dispatch 到独立画布节点，§9.5 R21 隔离），串行执行有依赖的。
   - 解析变量占位符 `{{nodeRef.portId}}`（§9.2 R6）→ 填入 prompt/modelParams。
   - **dispatch 参数解析**（§9.3 R8-R12）：按优先级链合并 prompt/negativePrompt/modelParams/provider/...，必须复刻 createOperationNode + handleCreateTask 的合并逻辑，最后经 Contract V2 裁剪 + StyleContext 注入。
   - `dispatch` 调画布单任务 IPC（media→`canvas:task:create-media` bindToNodeId=实例化画布节点，text→`canvas:task:generate-text`）。
   - 等待任务完成（监听 `stream:canvas:media-task`/`text-task`）→ 产物经 `applyMediaTaskResult`/`applyTextTaskResult` 回写画布（§9.5 R18-R20）→ 取产物 outputPort 值写入 variablePool + executions。
   - `onSnapshot` 持久化运行状态（断点续跑点）。
   - 死锁检测（无 ready 节点但 pending 非空 → 先跳 inactive，再 fail，§9.9 R32）。
3. batch 模式：外层再套一层循环，每个 batch item 独立跑一遍（或并行 N 个 run，受并发上限 R31 约束），结果按 batchIndex 组织（§9.10 R33）。

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

## 9. 算法级实现规约（深挖产出，设计的语义锚点）

> 本章节是 8 轮深挖的核心产出。工作流的端口推导、变量池、dispatch、产物回写、连线扩展、并发、stale 集成**必须遵守这些规约**，否则工作流运行结果会与画布单任务运行不一致。每条规约标注现有实现的精确出处。

### 9.1 端口推导规约（R1-R4）

**R1（能力派生）**：`operation → inputTypes/outputTypes` 来自 `CANVAS_CAPABILITIES`（canvas.capabilities.ts:8-126）。端口类型映射：node type `text/prompt`→portType `text`；`image/audio/video`→同名；其余→`any`。

**R2（媒体角色派生）**：
- `image_to_video`/`video_edit` → 生成 `first_frame`(required) + `last_frame`(optional) + `reference_image`(multiple) 端口（锚定 `computeMediaInputRoleMap` 的 supportsFrameRoles 路径，canvasMediaInputRoles.ts:68）。
- `image_edit`/`image_compose`/`text_to_video`/`storyboard_grid` → 生成 `reference_image`(multiple) 端口（supportsImageRoles 纯参考图路径）。
- `text`/`prompt` 类型 input 端口统一标记 `role:'text_context'`，dispatch 时走 `mergePromptWithNodeContext` 注入（canvasWorkspaceTaskInput.ts:115）。

**R3（output 派生）**：按 `runtime.outputMode` 或 `inferCanvasOperationOutputMode`（canvasOperationOutputModel.ts:47）：
- single → 1 个 `primary_output`
- candidates → 1 `primary_output` + N `candidate_output`（N 由运行结果决定，端口定义为 multiple）
- collection/bundle → `collection_item`(multiple:true)
- 特例：`extract_character/extract_scene/script_breakdown` 等 workflow 标记强制 collection（COLLECTION_WORKFLOWS，canvasOperationOutputModel.ts:14）。

**R4（端口兼容性）**：连接判定 `portTypeCompatible(a, b)`：同类型兼容；`any` 兼容一切；`text↔prompt` 互通；image↔video 不互通（除非显式 role 兼容）。不兼容时给 warning 非 hard block（与现有 connectNodes 不校验端口类型一致）。

### 9.2 变量池与占位符解析规约（R5-R7）

**R5（variablePool 结构）**：`Record<string, PortValue>`，key = `${nodeRef}.${portId}`，value = `{ nodeId?, assetId?, text?, url?, files?: CanvasMediaTaskInputFile[] }`。

**R6（占位符语法）**：prompt/modelParams 内支持 `{{nodeRef.portId}}`。解析时：
- 文本类 port → 取 `value.text`
- 媒体类 port → 取 `value.url` 或 `value.files`
- 若该 port 是 text_context role → 走 `formatCanvasTextInputContext` 格式化（`【kind｜title】\ncontent`，canvasWorkspaceTaskInput.ts:271）
- 解析失败（引用不存在的 nodeRef.portId）→ 保留原占位符 + 记 warning，不阻断运行。

**R7（占位符 vs 文本上下文注入的优先级）**：
- 工作流节点的 prompt 若含 `{{}}` 占位符 → 用占位符解析（精确引用）。
- 若不含占位符但连接了 text_context 端口 → 退回现有 `mergePromptWithNodeContext`（整体追加「画布节点内容」段）。
- 二者不叠加，避免重复注入。

### 9.3 dispatch 参数解析规约（R8-R12）—— 必须复刻 createOperationNode + handleCreateTask 的合并链

**R8（prompt 解析，优先级高→低）**：
1. 工作流节点 runtime.prompt（已含占位符解析结果）
2. 连接的 text_context 端口值（`mergePromptWithNodeContext`）
3. 上游 task.prompt（仅当上游产物是文本类）
4. preset.prompt（`readCanvasResolvedPresetTarget`）
5. `fallbackPromptForOperation(operation)`
6. 最后经 `buildCanvasOperationPrompt(operation, prompt)` 按 operation 包装前缀（storyboard/panorama 有专属前缀）。

**R9（negativePrompt/modelParams 继承）**：完全复刻 §9.4 的 R13-R14 规约。**关键：modelParams 只继承白名单 12 字段**（aspectRatio/duration/durationSeconds/fps/height/imageCount/quality/resolution/seed/size/style/width），且最终经 `pruneModelParamsForCanvas` Contract V2 裁剪。

**R10（providerProfileId/manifestId/modelId/agentId/skillIds）**：仅两档——工作流节点 runtime 显式值 > preset。**不从 upstream 继承**（与现有 createOperationNode 一致）。

**R11（StyleContext 注入）**：若 operation ∈ `STYLE_AWARE_OPERATIONS`（10 种媒体生成）且项目有 productionBible → 自动 `applyCanvasStyleToTask`（appendStylePrompt + mergeStyleTaskParams）。**工作流运行必须尊重项目级视觉圣经**，否则产物风格不一致。

**R12（dispatch 执行）**：解析完参数后，调用现有单任务 IPC：
- media operation → `canvas:task:create-media`（bindToNodeId=实例化的画布节点）
- text operation → `canvas:task:generate-text`
- 等待 `stream:canvas:media-task`/`text-task` 事件 → 产物经 `applyMediaTaskResult`/`applyTextTaskResult` 回写。

### 9.4 参数继承精确规则（R13-R17）—— 锚定 canvasOperationInheritance.test

| 字段 | 优先级链（高>低） | 出处 |
|------|------|------|
| prompt | explicit > promptContext(连线文本拼接) > node.data.prompt > upstream task.prompt > project.settings.prompt > preset.prompt | canvas.api.ts:4226-4247 |
| negativePrompt | explicit > upstream task.negativePrompt > node.data.negativePrompt > project.settings.negativePrompt > preset.negativePrompt | canvas.api.ts:4248-4259 |
| modelParams | explicit(浅合并) > preset target > upstream task.modelParams(白名单) > upstream node.data.modelParams(白名单)；manifest 裁剪 | canvas.api.ts:4260-4279 |
| provider/manifest/model/agentId/skillIds | explicit > preset（仅两档） | canvas.api.ts:4271-4282 |
| reasoningEffort | explicit > upstream task.reasoningEffort | canvas.api.ts:4283-4288 |
| outputTitle/outputPipelineRole | node.data（随节点流转） | canvas.api.ts:4511 |

**R13（prompt 顺序差异）**：prompt 的"upstream task"优先级**低于** node.data.prompt 和 promptContext；而 negativePrompt 的"upstream task"优先级**高于** node.data。两者顺序不同，不可统一。

**R14（modelParams 白名单）**：`pickInheritedModelParams`（canvas.api.ts:1227）只保留 12 字段。`internalDebug`/`searchEnabled`/`output_format` 等不继承，防止上游旧配置污染。

**R15（浅合并）**：explicit modelParams 与 preset modelParams 是**浅合并**（同 key 覆盖，不同 key 保留 preset），非深合并。

**R16（node.data vs task 镜像）**：dispatch 后，prompt 只在 explicit 非空时写 node.data，但 task.prompt 写完整合并后值（经 preset + operation 包装）。

**R17（Contract V2 裁剪）**：所有合并完成后必须 `pruneModelParamsForCanvas({manifestId, providerProfileId, modelParams})` 二次裁剪（canvasMediaContract.ts:52），防旧字段污染新模型。

### 9.5 产物回写与组织规约（R18-R22）

**R18（media 产物回写）**：每个 response.asset → 新建 CanvasAsset(source=ai_generated/ai_edited) + output node + generated edge。outputTitle 命名：首产物=`outputTitle`，N>1=`${outputTitle} ${N}`（canvas.api.ts:5237）。node.data.pipelineRole 继承 outputPipelineRole。

**R19（taskId 覆盖解耦）**：runOperationNode 覆盖 node.taskId 后，旧 task 回写通过 generated edge 反查源节点（findCanvasTaskNode），ownsTask=false（taskId 不匹配）时**不 patch 节点状态**（防误改正在跑的新 task），但产物仍归旧 task。**工作流运行若复用同一画布节点多次运行，必须理解此解耦**。

**R20（幂等防重）**：completed task + requestId 匹配 + 已有 outputAssetIds → 不重写。迟到的 running ack 不降级 completed（markMediaTaskSubmitted 在终态时直接 return）。**工作流断点续跑复用此机制防重复执行**。

**R21（兄弟节点隔离）**：task 替换（replacedActiveTaskId）清理范围严格限定在 bindNode 自身 + 其旧 task 的 edges，绝不波及兄弟节点。**工作流并行运行多个无依赖节点时，每个 dispatch 到独立画布节点，天然隔离**。

**R22（产物投影）**：`buildCanvasOperationProjection` 把操作节点的 generated 产物节点"内嵌隐藏"，连线端点折叠到操作节点。**工作流模式下，工作流节点实例的产物默认内嵌显示（与单任务一致），用户可"展开产物为独立节点"（materializedOutput 复用）**。

### 9.6 连线扩展规约（R23-R26）—— 多端口必须改造的点

**R23（现状）**：CanvasNode 只渲染 2 个无 id Handle（左 target/右 source，CanvasNode.tsx:1051/1213）。CanvasEdge 无 sourceHandle/targetHandle 字段（canvas.types.ts:336）。PendingCanvasConnection 只有 {sourceNodeId}。onConnect 不传 handle id。

**R24（多端口改造清单）**：
1. CanvasEdge 类型加 `sourcePortId?/targetPortId?`（canvas.types.ts:336-347）。
2. PendingCanvasConnection 加 `sourcePortId?`（canvasPendingConnection.ts:1）。
3. CanvasNode 在工作流模式下按 `CanvasWorkflowNode.inputs/outputs` 渲染多个带 id 的 `<Handle id={port.id} />`（纵向排列，CSS 已支持 handle 逃逸，canvasNodeHandleStyles.test）。
4. `handleConnect`（CanvasStage.tsx:1474）透传 `connection.sourceHandle/targetHandle` → onConnectNodes → connectNodes。
5. `connectNodes`（canvas.api.ts:3590）入参加 sourcePortId/targetPortId，写入 CanvasEdge。

**R25（edge.type 推断不变）**：多端口不影响 edge.type 推断（仍按 target/source 是否 operation 决定 used_as_input/generated/references，canvas.api.ts:3611）。端口语义（role）在 dispatch 时按 portId 解析，不存进 edge.type。

**R26（拖线到空白复用）**：现有 `handleConnectEnd → openPaneContextMenuAt → runPaneCreateAction → connectPendingConnectionToNode`（CanvasStage.tsx:1494/1050/1269/1257）已成熟。工作流模式下，拖线到空白弹"可接的下游操作类型"菜单（按当前 source port 的 type+role 过滤 capability，复用 getOpsForRole 思想）。

### 9.7 stale/confirm/级联集成规约（R27-R29）

**R27（现状：纯渲染端逻辑）**：confirm/stale 机制在 CanvasWorkspaceView.tsx:4890-4904，**不在 canvas.api.ts**。confirm 一个节点 → `collectDownstream(nodeId, edges)`（canvasPipeline.ts:118）算下游 → 标 productionState='stale' + 记 staleFrom。

**R28（工作流运行的 stale 集成）**：
- 工作流全流程运行时，每个节点 dispatch 完成 → 产物回写。
- 若该节点被用户 confirm → 下游节点自动 stale（现有机制，无需改造）。
- 工作流"从某节点向后运行"时，**默认跳过 stale 节点**（除非用户显式"重跑 stale"）。
- 工作流参数变更（修改某节点 runtime）→ 该节点及下游标 stale（复用 stalePatch + collectDownstream），提示用户重跑。

**R29（断点续跑与 stale）**：续跑时，已完成节点（completedNodeRefs）的产物保留；failed 节点重试；stale 节点按用户选择（跳过/重跑）。run 状态与节点 productionState 解耦——run 记录执行轨迹，productionState 记录内容新鲜度。

### 9.8 输入解析递归展开规约（R30）

**R30（expandCanvasInputNodes，canvasWorkspaceTaskInput.ts:140）**：dispatch 时解析输入端口值的递归规则：
- 上游是 operation 节点 → `resolveCanvasOperationInputNodes` 取其主产物（按 outputMode）。
- 上游是 group 节点 → 展开成员（递归）。
- 上游是 image/video/audio → 直接用。
- 工作流端口的值若指向"操作节点"，必须经此展开，否则拿到的是操作节点本身而非其产物。

### 9.9 并发与死锁规约（R31-R32）

**R31（并发安全，复用现有机制）**：
- 工作流并行运行无依赖节点时，每个 dispatch 到独立画布节点（runId + nodeRef + batchIndex 命名）。
- 产物回写经 `mergeCanvasBackgroundTaskSnapshot`（canvas.store.ts:62）按 id 合并，避免并发覆盖。
- 同一 run 内，有依赖节点串行（等上游 outputPort 写入 variablePool 后再 dispatch）。
- batch 模式 N 个 run 之间，并发上限默认 3（可配），超出的排队。

**R32（死锁检测，移植 workflow-executor）**：
- 每轮循环：找 ready 节点（所有必填 input 端口在 variablePool 有值 + edge condition 满足）。
- 无 ready 但 pending 非空 → 先 `collectWorkflowInactiveNodeIds`（跳过 inactive，如 condition 不满足的分支）。
- 仍无 ready → deadlock，run 标 failed，记录 unresolvedNodeRefs。

### 9.10 批量运行结果组织规约（R33）

**R33（对比墙/版本树）**：batch 模式每个 batchIndex 产出一组画布节点。结果组织：
- 按 batchIndex 分组，每组用 batchGrid[i].label 命名（如 "seed=42"/"16:9"）。
- 产物节点 `data.batchIndex` 标记批次，便于筛选。
- UI 呈现"对比墙"：同一 outputPort 跨批次的产物横向对比（复用现有 candidates 对比 UI 思路）。
- 支持从某批次"分叉继续"（基于该批次产物继续派生新工作流运行）。

---

## 10. 关键实现风险（基于深挖的精确化）

| 风险 | 等级 | 精确化（基于深挖） |
|------|------|------|
| 工作流 dispatch 参数与单任务不一致 | **致命** | 必须严格按 §9.3-9.4 的 R8-R17 复刻合并链；建议 dispatch 直接复用 createOperationNode/runOperationNode 的内部 helper，而非重写 |
| modelParams 继承污染 | 高 | 必须走白名单 12 字段 + Contract V2 裁剪（R9/R14/R17） |
| StyleContext 漏注入 | 高 | media operation dispatch 必须检查 STYLE_AWARE_OPERATIONS + productionBible（R11） |
| 多端口连线与现有单端口冲突 | 中 | 工作流模式独立渲染多 Handle，非工作流模式保持单端口；CanvasEdge 加可选字段向后兼容（R24） |
| 产物投影与工作流节点显示冲突 | 中 | 工作流节点实例的产物默认内嵌（R22），与单任务一致；展开产物复用 materializedOutput |
| 大画布提取塞爆 prompt | 中 | >30 操作节点走 agent 会话路径（调 spark_canvas 工具自读，§3.2.2） |
| batch 运行费用爆炸 | 中 | 运行前预估总任务数 + 并发上限（R31/R33） |

---

## 11. 完整 API 契约（生产级）

> 所有 IPC 遵守现有 `IpcResult<T>` 契约（typed-ipc.ts:45：`{ok:true,data}|{ok:false,error:{code,message}}`），经 `typedIpcHandle` 注册，zod schema 校验 payload，错误经 `handleIpcError` 归一。**工作流主动用 SparkError 替代裸 Error**（现状画布抛裸 Error 会塌缩为 UNKNOWN，无法差异化处理）。

### 11.1 IPC Channel 注册表（新增，注册到 `IpcChannelMap`）

| Channel | 方向 | 请求 Schema | 响应 | 错误码 |
|---------|------|------------|------|--------|
| `canvas:workflow:list` | invoke | `{projectId: string, status?: 'draft'\|'published'\|'archived'\|'all'}` | `{workflows: CanvasWorkflowListItem[]}` | NOT_FOUND(project) |
| `canvas:workflow:get` | invoke | `{workflowId: string}` | `{workflow: CanvasWorkflow}` | NOT_FOUND |
| `canvas:workflow:create` | invoke | `{projectId, name, description?, definition, source?}` | `{workflow: CanvasWorkflow}` | VALIDATION_FAILED(图校验) |
| `canvas:workflow:update` | invoke | `{workflowId, patch: Partial<CanvasWorkflow>}` | `{workflow: CanvasWorkflow}` | NOT_FOUND / VALIDATION_FAILED |
| `canvas:workflow:delete` | invoke | `{workflowId, hard?: boolean}` | `{deleted: true}` | NOT_FOUND |
| `canvas:workflow:duplicate` | invoke | `{workflowId, newName}` | `{workflow: CanvasWorkflow}` | NOT_FOUND |
| `canvas:workflow:validate` | invoke | `{definition: CanvasWorkflowDefinition}` | `{valid: boolean, errors: ValidationError[], warnings: ValidationWarning[]}` | — |
| `canvas:workflow:extract` | invoke | `{projectId, nodeIds: string[], refineWithAgent?: boolean, agentConfig?}` | `{workflow: CanvasWorkflow, extractionReport}` | VALIDATION_FAILED / PROVIDER_*(agent) |
| `canvas:workflow:apply` | invoke | `{workflowId, boardId, placement: {x,y}, inputValues?}` | `{snapshot: CanvasSnapshot, canvasNodeIds: string[]}` | NOT_FOUND / WORKSPACE_PATH_OUTSIDE_ROOT |
| `canvas:workflow:run` | invoke | `{workflowId, mode, inputValues?, startNodeRef?, batchGrid?, runOptions?}` | `{run: CanvasWorkflowRun}` | NOT_FOUND / VALIDATION_FAILED / PERMISSION_DENIED |
| `canvas:workflow:run:list` | invoke | `{workflowId?, projectId?, status?, limit?, cursor?}` | `{runs: CanvasWorkflowRunListItem[], nextCursor?}` | — |
| `canvas:workflow:run:get` | invoke | `{runId: string}` | `{run: CanvasWorkflowRun}` | NOT_FOUND |
| `canvas:workflow:run:resume` | invoke | `{runId, fromFailedNode?}` | `{run: CanvasWorkflowRun}` | NOT_FOUND / ALREADY_EXISTS(已 running) |
| `canvas:workflow:run:cancel` | invoke | `{runId}` | `{run: CanvasWorkflowRun}` | NOT_FOUND |
| `canvas:workflow:run:retry-node` | invoke | `{runId, nodeRef}` | `{run: CanvasWorkflowRun}` | NOT_FOUND / VALIDATION_FAILED(节点非 failed) |
| `stream:canvas:workflow-run` | event | — | `{runId, projectId, event: WorkflowRunEvent}` | — |

### 11.2 WorkflowRunEvent 事件流（stream:canvas:workflow-run）

```ts
type WorkflowRunEvent =
  | { type: 'run_started'; runId; mode; totalNodes }
  | { type: 'node_started'; nodeRef; taskId?; canvasNodeId?; batchIndex? }
  | { type: 'node_progress'; nodeRef; progress; message? }
  | { type: 'node_completed'; nodeRef; taskId; outputPortValues: Record<string, PortValue> }
  | { type: 'node_failed'; nodeRef; error: { code; message }; retryable: boolean }
  | { type: 'node_skipped'; nodeRef; reason: 'stale' | 'condition_false' | 'already_completed' }
  | { type: 'wave_completed'; completedNodeRefs: string[]; nextReadyNodeRefs: string[] }
  | { type: 'run_progress'; completedNodes; totalNodes; percent; failedNodes }
  | { type: 'run_paused'; reason: 'approval_required' | 'user_request' | 'rate_limit_backoff' }
  | { type: 'run_resumed'; fromNodeRef? }
  | { type: 'run_completed'; outputCanvasNodeIds; totalDuration; totalCost? }
  | { type: 'run_failed'; failedNodeRef; error: { code; message }; partialOutputs }
  | { type: 'run_canceled'; completedNodeRefs; partialOutputs }
```

### 11.3 幂等与并发约定

- **run 创建幂等**：`canvas:workflow:run` 支持可选 `idempotencyKey`（客户端生成的 UUID），同 key 在 5 分钟内重复请求返回同一 run（防网络重试导致重复启动）。
- **run 状态机约束**：同一 workflowId 同时只允许 1 个 `running`/`paused` 态 run（ALREADY_EXISTS）；batch 模式作为单个 run 内部并发，不算多个 run。
- **resume 幂等**：resume 一个 `failed` run 时，先检查是否已有进行中的 resume（ALREADY_EXISTS）。
- **cancel 语义**：cancel 立即返回 `canceled`，但实际节点终止异步发生（dispatch 中的 IPC 已发出则等其完成/超时）。

### 11.4 校验错误码（VALIDATION_FAILED 的细分 context）

图校验失败统一抛 `SparkError('VALIDATION_FAILED', msg, {errors})`，context.errors 数组每项：
```ts
type ValidationError = {
  code: 'disconnected_node' | 'missing_required_input' | 'port_type_mismatch'
       | 'cycle_detected' | 'no_output' | 'duplicate_ref' | 'invalid_port_ref'
  nodeRef?: string       // 涉及的节点
  portId?: string        // 涉及的端口
  message: string
}
```

---

## 12. 状态机与异常处理（生产级）

### 12.1 WorkflowRun 状态机

```
pending ──start──► running ──all nodes done──► completed
                      │  │
              pause   │  │ node fail
            (approval/│  │
             backoff) │  ▼
                ▼     │  failed ──resume──► running
              paused ──resume──► running
                      │
              cancel  │
                      ▼
                   canceled
```

**转换规则**：
- `pending→running`：dispatch 首个 wave 后立即转。
- `running→paused`：approval 节点需确认 / rate_limit_backoff / 用户手动暂停。
- `running→failed`：任一节点失败且无 retry 余量；或死锁（R32）。
- `running→completed`：所有必达节点 completed，outputs 收集完毕。
- `failed→running`（resume）：用户触发，从 failedNodeRef 重试，保留 completedNodeRefs。
- `*→canceled`：用户取消，保留已完成产物（partialOutputs）。
- **终态不可逆**：completed/failed/canceled 不再转换（幂等防重 R20）。

### 12.2 节点级重试与超时

| 场景 | 策略 | 参数 |
|------|------|------|
| provider 瞬时错误（RATE_LIMITED/超时/5xx） | 指数退避重试 | maxRetries=3, backoff=[2s,8s,30s]（可配） |
| provider 永久错误（AUTH_FAILED/QUOTA_EXCEEDED/VALIDATION） | 不重试，标 failed | — |
| 任务执行超时 | 单节点 dispatch 超时 → 标 failed，可 resume | perNodeTimeoutMs（默认 media 5min, text 2min，可配） |
| 死锁（R32） | run failed，记录 unresolvedNodeRefs | — |
| 部分节点失败 | 默认 fail-fast（终止后续依赖该节点的分支）；可配 `continueOnError`（跳过失败节点继续无依赖分支） | runOptions.continueOnError |

### 12.3 补偿与降级

- **无自动回滚**：画布产物是创作资产，不自动删除失败 run 的已生成节点（与现有单任务一致）。
- **partialOutputs 保留**：failed/canceled run 的已完成节点产物全部保留在画布，用户可手动清理或从断点续跑。
- **stale 标记补偿**：失败的节点及下游自动标 `productionState:'stale'`（复用 stalePatch + collectDownstream，R28），提示用户内容不完整。
- **降级运行**：若某 provider 不可用，且 workflow 定义了 fallback provider/operation，自动降级（runOptions.allowFallback）；否则该节点 failed。

### 12.4 approval 节点（人机协作闸门）

- kind:'approval'（或 transform 子类型）节点触发 `run_paused`，推 `approval_required` 事件。
- 用户在 UI 确认/拒绝/修改后 → `canvas:workflow:run:resume`。
- 超时（默认 24h）自动 `failed`，记录 `approval_timeout`。
- 参考 workflow-executor.ts 的 approval 原子节点实现。

---

## 13. 迁移、兼容与回滚

### 13.1 Migration 顺序

```
041_canvas_workflows.sql       (canvas_workflows 表)
042_canvas_workflow_runs.sql   (canvas_workflow_runs 表)
```
- 均带 `IF NOT EXISTS`，支持重复执行（现有 migration 范式）。
- 外键 `project_id → canvas_projects(id) ON DELETE CASCADE`：删项目自动级联删工作流。
- 索引：`(project_id, status, updated_at)` / `(workflow_id, status, updated_at)`（断点续跑查询）。

### 13.2 向后兼容

- **CanvasNode/CanvasEdge/CanvasTask 类型扩展只加可选字段**：`sourcePortId?/targetPortId?`（R24），旧数据无该字段时按单端口处理。
- **canvas.api.ts 新增方法不改动现有方法签名**：工作流逻辑全部在 `workflow/` 子目录，主文件 CanvasWorkspaceView.tsx 仅追加入口。
- **localStorage key 新增**：`spark-canvas:workflows:v1`（工作流定义缓存），不污染现有 `spark-canvas:v1`。
- **旧画布无工作流**：首次打开不显示工作流面板（除非用户主动创建），零侵入。

### 13.3 回滚策略

- **feature flag**：`canvas.workflow.enabled`（设置项），关闭后工作流入口全部隐藏，已建工作流数据保留但不可访问。
- **migration 不可逆但安全**：两张新表与现有表通过外键关联，DROP 表需先确保无数据；回滚时只禁用 feature flag，不 DROP 表。
- **数据导出**：`canvas:project:export-package` 扩展为含工作流定义（workflow.definition_json 进导出包），导入时一并恢复。

### 13.4 版本演进

- CanvasWorkflow.version 字段：结构变更时递增。
- run 的 graphSnapshot 固化为运行时拷贝：workflow 定义后续修改不影响进行中/历史 run（R——断点续跑稳定性）。
- schema 迁移：definition_json 内加 `schemaVersion`，未来结构升级时按版本迁移（参照现有 snapshot 迁移范式）。

---

## 14. 性能与规模（生产级）

### 14.1 规模假设与限额

| 维度 | 软上限 | 硬上限（拒绝） | 降级策略 |
|------|--------|--------------|----------|
| 单工作流节点数 | 30 | 100 | >30 警告，>100 拒绝(VALIDATION_FAILED) |
| 单 run 总任务数 | 50 | 200 | 批量运行前预估并提示 |
| 单项目工作流数 | — | 500 | 列表分页 |
| 并发 run 数（同项目） | 1 | 1（单窗口单例约束） | 排队 |
| 并发 run 数（全局） | 3 | 5 | 超出排队 |
| batch 单次并行度 | 3 | 10 | 超出串行 |
| 单节点 dispatch 超时 | media 5min / text 2min | 可配 | 超时标 failed |
| undo 栈 | 50（现有） | — | 工作流 run 作为单条 undo 记录 |

### 14.2 性能优化

- **工作流定义懒加载**：列表只返回 CanvasWorkflowListItem（无 definition_json），打开编辑器才加载完整定义。
- **run 状态增量更新**：stream 事件流推送增量，不重传完整 run；前端按 runId 合并（复用 mergeCanvasBackgroundTaskSnapshot 思想）。
- **variablePool 内存态**：运行期间 variablePool 在内存，onSnapshot 时序列化到 DB（不每节点写 DB）。
- **拓扑缓存**：同一 workflow 多次运行时缓存拓扑序（definition hash → order）。
- **localStorage 隔离**：工作流定义默认不进 canvas 热缓存（避免撑爆 4MB），直接走 SQLite。

### 14.3 大规模产物处理

- **复用 normalizeSnapshotForHotStorage**：工作流产物若含 data:image base64，自动物化为 safe-file:// 文件（canvas.api.ts:1003）。
- **产物节点内嵌显示**：复用 buildCanvasOperationProjection（R22），避免画布节点爆炸。
- **批量结果按 batchIndex 分组渲染**：对比墙只渲染当前查看的批次，虚拟滚动。

---

## 15. 安全与权限（生产级）

> 锚定 §12-13 轮调研结论：画布 agent 现状是 bypass 权限（无 canUseTool）、无资源硬上限、写串行队列仅在渲染端。

### 15.1 工作流运行权限模型

| 操作 | 权限 | 实现 |
|------|------|------|
| 读工作流/历史 | 默认放行 | 只读 IPC |
| 创建/编辑/删除工作流 | 默认放行（项目内） | 写 IPC |
| 运行工作流（dispatch media/text） | 默认放行（复用现有单任务权限） | 现有 canvas:task:* 已校验 provider |
| 运行工作流（dispatch agent 会话） | **需审批**（不无脑 bypass） | 新增 permissionMode:'canvas-workflow'，写/删工具走 canUseTool |
| 跨项目资产引用 | **拒绝**（PERMISSION_DENIED） | run 启动时校验所有 input 来源在本项目 |
| 工作流产物写入 | 固定子目录（writeCanvasAssetDataUrl 范式） | 自定义路径过 isPathStrictlyInsideRoot |

### 15.2 路径安全

- 所有工作流产物写入 `<projectRoot>/assets/<subdir>/`（复用现有 sanitizeCanvasPathSegment + UUID）。
- 导出/自定义输出路径必须 `isPathStrictlyInsideRoot(target, projectRoot)`（R——现仅删除守卫用，工作流扩展到写入）。
- safe-file:// 协议天然防渲染进程拿绝对路径。

### 15.3 凭证安全

- 工作流 dispatch 时**按需 resolveProviderApiKeyForProfile**（复用 secretCache），不预解析全量 apiKey。
- apiKey 仅主进程内存，stream 事件/响应不携带 apiKey（现有 CanvasMediaTaskCreateResponse 已不含 apiKey）。
- provider 批量调用复用现有 resolveCanvasMediaProviders，不新增凭证暴露面。

### 15.4 资源耗尽防护

- §14.1 硬上限在 IPC handler 层强制校验（超限抛 VALIDATION_FAILED）。
- 工作流 run 启动前预估总任务数 + 总产物数，超阈值警告并要求确认（防 batch 费用爆炸，R33）。
- 磁盘写入监控：单 run 产物总大小超 500MB 警告（可配）。

### 15.5 多窗口/并发隔离

- **遵守单窗口单例**：工作流运行复用当前活跃画布窗口，不新建窗口。
- **主进程写互斥**：工作流引擎若在主进程运行，自建 projectId 级互斥锁（复刻渲染端 projectWriteQueues 到主进程）。
- **stream 事件 projectId 过滤**：所有 workflow-run 事件带 projectId，渲染端按 projectId 过滤（复用现有范式）。

---

## 16. 可观测性（生产级）

### 16.1 日志（复用现有 logger）

- IPC 层：`typedIpcHandle` 自动 log.debug 请求/响应（typed-ipc.ts:70）。
- 工作流引擎：每个 wave/node 状态转换 log.info（含 runId/nodeRef/taskId/batchIndex）。
- provider 调用：复用 `logCanvasMediaCall`（canvas.api.ts:1485）记录 method/url/body 摘要。
- 错误：log.warn（已知 SparkError）/ log.error（UNKNOWN），含完整 context。
- 敏感信息：apiKey 经 maskSecret，prompt/negativePrompt 截断预览（现有范式）。

### 16.2 运行指标（run 完成时记录）

```ts
type CanvasWorkflowRunMetrics = {
  runId; workflowId; projectId; mode
  totalNodes; completedNodes; failedNodes; skippedNodes
  totalDurationMs
  totalTasksDispatched  // 实际单任务数
  totalCost?            // 若 provider 返回费用
  retryCount            // 总重试次数
  providerBreakdown: Record<string, number>  // provider → 调用数
  endedReason: 'completed' | 'failed' | 'canceled' | 'deadlock'
}
```
存入 `canvas_workflow_runs`（扩展字段）或独立 metrics 日志，供"工作流运行历史"面板聚合展示。

### 16.3 调试面板

- 每个 run 详情页展示：图可视化（节点状态着色：绿=completed/黄=running/红=failed/灰=skipped）+ 每节点执行记录（taskId/耗时/产物/错误）+ variablePool 快照（可展开查看每个 port 值）。
- 失败节点：展示 requestCall/rawResponse/errorDetail（复用现有任务详情范式）。

---

## 17. 测试策略（生产级，复用现有 Vitest 范式）

> 锚定 §13 轮调研：Vitest 2.x，57 个 canvas 测试，jsdom+seedCanvasDb+mock window.spark 是 dispatch 测试权威范本，workflow-executor.test 是引擎测试金标准。

### 17.1 测试分层

| 层 | 范围 | 范式参照 | 工作流测试文件 |
|----|------|---------|--------------|
| **纯逻辑** | 端口推导/拓扑/校验/变量池解析/stale 计算 | canvasPipeline.test / canvasConnectionSemantics.test | canvasWorkflowTopology.test / canvasWorkflowPorts.test / canvasWorkflowVariablePool.test |
| **dispatch 副作用** | extract/apply/run 单节点→产生节点/边/任务 | canvasOperationInheritance.test（jsdom+seedCanvasDb） | canvasWorkflowExtractor.test / canvasWorkflowRunner.test |
| **运行引擎** | 拓扑执行/死锁/续跑/并行/重试/快照/batch | workflow-executor.test（注入 dispatch 回调） | canvas-workflow-executor.test |
| **React 组件** | 面板/编辑器/运行对话框 | CanvasOperationPanel.test（createRoot+act） | CanvasWorkflowPanel.test.tsx |
| **样式契约** | 多端口 handle 排列 | canvasNodeHandleStyles.test（readFileSync+正则） | canvasWorkflowHandleStyles.test |
| **IPC 守卫** | 路径/限额/权限校验纯函数 | canvas-project-delete.test | canvasWorkflowGuards.test |

### 17.2 关键测试场景（必须覆盖）

**纯逻辑**：
- 端口推导：15 种 operation × outputMode 组合的 input/output 端口正确性（R1-R4）。
- 拓扑：DAG 排序、环检测、孤立节点、条件分支跳过。
- 变量池：`{{}}` 占位符解析、文本上下文注入优先级（R5-R7）、循环引用检测。
- stale：confirm→下游 stale 传播、断点续跑与 stale 交互（R27-R29）。

**dispatch 副作用**（jsdom + seedCanvasDb）：
- extract：选中 N 个操作节点→提取为 workflow（节点映射/边映射/输入识别），agent 精炼路径 mock window.spark 返回 JSON。
- apply：workflow→画布节点实例化，产物落位、连线生成。
- run 单节点：dispatch 参数合并链（R8-R17 全覆盖）、产物回写、幂等防重。

**运行引擎**（注入 dispatch）：
- 全流程：3 节点线性、菱形依赖、并行 wave。
- 死锁：A↔B 互依赖 → failed。
- 断点续跑：initialCompletedNodeIds 跳过已完成。
- batch：3 组参数网格 → 3 组产物按 batchIndex 隔离。
- 失败+continueOnError：1 节点失败，无依赖分支继续。
- approval：暂停→resume。

**不变量**：dispatch 参数与单任务 createOperationNode 结果一致（最关键，R8-R17）。

### 17.3 质量门禁

- **无覆盖率硬门禁**（现状），但工作流模块建议 self-impose 80% lines。
- **本地**：`pnpm test:unit && pnpm lint && pnpm typecheck`（无 CI test gate，靠本地）。
- **GitNexus**：编辑前 `impact`、提交前 `detect_changes({scope:'compare',base_ref:'master'})`。
- **回归**：workflow 定义变更后，历史 run 的 graphSnapshot 不受影响（版本隔离测试）。

---

## 18. 详细 UX 旅程（生产级）

### 18.1 旅程 A：在画布上编排并保存工作流

```
1. 用户在画布上正常创作：上传图片 → 连线 → 创建 text_to_image 操作 → 运行 → 产物 → 继续派生 image_to_video
2. 跑通一遍后，框选这组操作节点（3个操作 + 连线 + 上游素材）
3. 右键 →「保存为工作流」
4. 弹出保存对话框：
   - 自动填充名称（如"角色立绘转视频"）+ 描述
   - 展示提取预览图（操作节点 + 端口 + 连线，素材降级为输入端口）
   - 输入参数识别："参考图"标为 runtime 输入，"提示词"标为可编辑
   - 用户可调整：改端口角色、标记哪些是必填输入、命名输入字段
5. 点击保存 → 进入工作流面板，卡片显示缩略图
6. （可选）打开工作流编辑器微调端口/变量引用
```

### 18.2 旅程 B：自动提取（agent 精炼）

```
1. 用户有一张内容丰富的画布（剧本→角色→分镜→关键帧→视频，20+ 节点）
2. 右键空白 →「提取整个画布为工作流」（或框选子区域）
3. 阶段1（本地）：秒级完成，弹出提取草稿预览
4. 勾选「智能优化」→ 阶段2（agent）：
   - 进度条显示"AI 正在分析画布结构并优化工作流…"
   - agent 产出：语义化命名、输入字段识别、端口补全
5. 提取结果确认对话框：
   - 左：原画布选区缩略图；右：提取后的工作流图
   - 高亮 agent 改动（新增端口、重命名、合并）
   - 校验结果：✅ 连通 / ⚠️ 某节点缺输入（标红）
6. 用户修正后保存
```

### 18.3 旅程 C：运行工作流（全流程 + batch）

```
1. 工作流面板点击「运行」
2. 运行对话框：
   - 模式选择：单节点 / 从某节点 / 全流程 / 批量
   - 输入参数填写（按 inputs 声明渲染表单：文本框/图片上传/下拉）
   - 批量模式：参数网格编辑器（行=变量，列=批次，如 seed=[42,100,200]）
   - 预估：总任务数 9（3节点×3批次），预计耗时 ~6min
3. 点击「开始运行」
4. 运行进度视图（画布上）：
   - 工作流节点实例高亮，状态实时着色
   - 右侧运行面板：进度条 + 节点列表（每节点 状态/耗时/产物缩略）
   - 失败节点可「重试此节点」或「跳过继续」
5. 完成后：产物留在画布，可继续二次创作；批量结果进入「对比墙」视图
6. 运行历史：随时查看/复用/对比历次 run
```

### 18.4 旅程 D：断点续跑

```
1. 一个 10 节点工作流，跑到第 7 节点失败（provider 超时）
2. 运行面板显示"失败于节点 G，前 6 节点已完成"
3. 用户：① 修复 provider 配置 → ② 点击「从失败节点续跑」
4. run 状态 failed→running，跳过前 6 节点（completedNodeRefs），从 G 重试
5. 续跑完成，产物与前 6 节点合并
```

### 18.5 旅程 E：工作流复用与分享

```
1. 项目 A 的好工作流 → 导出 JSON 文件
2. 项目 B → 导入 JSON → 工作流面板出现
3. （未来）工作流市场：发布/订阅/评分
```

---

## 19. MCP 工具扩展（让 agent 也能驱动工作流）

> 现有 canvas.tools.ts 有 50 个工具。工作流扩展 8 个，注册到 spark_canvas MCP server，让 CanvasAgentModal 的 agent 也能编排/提取/运行工作流（"对话即创作"闭环）。

| 工具名 | 入参 | 出参 | 语义 |
|--------|------|------|------|
| `canvas_list_workflows` | `{projectId, status?}` | `{workflows[]}` | 列出项目工作流 |
| `canvas_get_workflow` | `{workflowId}` | `{workflow}` | 获取工作流定义 |
| `canvas_save_workflow` | `{projectId, name, definition, source?}` | `{workflow}` | 创建/更新工作流（agent 编排产物） |
| `canvas_extract_workflow` | `{projectId, nodeIds, refineWithAgent?}` | `{workflow, report}` | 从画布选区提取工作流 |
| `canvas_apply_workflow` | `{workflowId, boardId, placement, inputValues?}` | `{canvasNodeIds[]}` | 应用工作流到画布 |
| `canvas_run_workflow` | `{workflowId, mode, inputValues?, batchGrid?}` | `{runId, status}` | 启动工作流运行 |
| `canvas_get_workflow_run` | `{runId}` | `{run}` | 查询运行状态/产物 |
| `canvas_query_workflows` | `{projectId, filter}` | `{workflows[]}` | 多维查询（标签/operation/节点数） |

**canvas-studio SKILL.md 扩展**：新增"工作流"章节，指导 agent 何时用工作流工具（如"用户要批量生成 10 个变体 → 用 canvas_run_workflow batch 模式而非逐个 canvas_run_operation"）。

---

## 20. 边界场景与降级（生产级 Checklist）

| 场景 | 处理 |
|------|------|
| 工作流引用的 provider 被删除 | run 前 validate 报 warning；运行时 PROVIDER_UNAVAILABLE，节点 failed |
| 工作流引用的 model 下架 | Contract V2 裁剪 fallback；仍不可用则 failed，提示换模型 |
| 画布节点被删但工作流定义仍引用 | extract 时基于当时快照；apply/run 实例化新节点，不依赖原节点 |
| 大批量产物撑爆 localStorage 4MB | 自动 normalizeSnapshotForHotStorage 物化 + 降级 hotOverflow 内存 |
| 工作流定义 JSON 损坏 | zod 校验失败 → IPC_INVALID_PAYLOAD；加载时 try-catch 降级显示"定义已损坏" |
| run 进行中 app 崩溃 | 重启后 markStaleAsFailed（复刻 WorkflowRunRepository），用户可 resume |
| batch 中某批次全部失败 | 不影响其他批次；对比墙标红失败批次，成功批次正常展示 |
| agent 提取产出的 JSON 不合法 | tryParseJsonObject 三段容错（R——canvasEntityExtract:390）；仍失败则回退阶段1 草稿 |
| 工作流环（A→B→A） | validate cycle_detected 拒绝保存；运行时死锁检测 |
| 端口类型不兼容连接 | validate port_type_mismatch warning（非阻断）；dispatch 时按 any 兜底 |
| 并发运行同一工作流 | ALREADY_EXISTS 拒绝第二个 run；batch 作为单 run 内部并发 |
| 工作流定义变更影响进行中 run | run 持 graphSnapshot 拷贝，不受定义后续修改影响 |
| undo 栈被工作流 run 撑爆 | run 作为单条 undo 记录（整体撤销恢复 run 前 board 状态） |

---

## 附：调研证据索引

详细调研笔记见 `.spark-artifacts/canvas-workflow-research-notes.md`（含 8 轮调研完整累积）。关键事实出处：

**数据模型与能力**：
- 节点/边/任务类型：`canvas.types.ts:10-416`
- 能力注册表（端口推导源）：`canvas.capabilities.ts:8-126`（CANVAS_CAPABILITIES）+ `:146`（OPERATION_NODE_TYPES）
- 产物 4 种 outputMode：`canvas.types.ts:58` + `canvasOperationOutputModel.ts:47`（inferCanvasOperationOutputMode）

**输入解析与产物组织（§9.1/9.5/9.8 规约源）**：
- 媒体输入角色：`canvasMediaInputRoles.ts:45`（computeMediaInputRoleMap）
- 产物投影（内嵌显示）：`canvasOperationProjection.ts:17`（buildCanvasOperationProjection）
- 产物物化复用：`canvasOperationOutputMaterialization.ts:10`
- 输入递归展开：`canvasWorkspaceTaskInput.ts:140`（expandCanvasInputNodes）/ `:189`（resolveCanvasInputNodes）
- 文本上下文注入：`canvasWorkspaceTaskInput.ts:115`（mergePromptWithNodeContext）/ `:271`（formatCanvasTextInputContext）
- StyleContext 注入：`canvasStyleContext.ts:27`（buildCanvasStyleContext）/ `:88`（applyCanvasStyleToTask）
- Contract V2 裁剪：`canvasMediaContract.ts:52`（pruneModelParamsForCanvas）

**参数继承（§9.4 规约源）**：
- createOperationNode 继承链：`canvas.api.ts:4181-4384`
- modelParams 白名单：`canvas.api.ts:1227`（pickInheritedModelParams）
- 运行回写：`canvas.api.ts:5126`（applyMediaTaskResult）/ `:4967`（applyTextTaskResult）
- taskId 覆盖解耦：`canvas.api.ts:1153`（findCanvasTaskNode）/ `:1187`（canPatchCanvasTaskNode）
- connectNodes edge 推断：`canvas.api.ts:3590-3665`
- 继承测试（规则反推）：`canvasOperationInheritance.test.ts`（22 个用例）

**连线交互（§9.6 规约源）**：
- Handle 渲染：`CanvasNode.tsx:1051/1213`（单端口）
- 连接三件套：`CanvasStage.tsx:1474`（handleConnect）/ `:1483`（handleConnectStart）/ `:1494`（handleConnectEnd）
- 拖线到空白：`CanvasStage.tsx:1050`（openPaneContextMenuAt）/ `:1257`（connectPendingConnectionToNode）
- PendingConnection：`canvasPendingConnection.ts:1`
- reactflow 版本：`@xyflow/react ^12.3.5`（apps/desktop/package.json:83）

**stale/confirm/级联（§9.7 规约源）**：
- 生产状态机：`canvasPipeline.ts:80-140`（isConfirmed/isStale/confirmPatch/stalePatch/collectDownstream）
- 渲染端触发：`CanvasWorkspaceView.tsx:4890-4904`

**实体提取范式（§3.2 自动提取参照）**：
- prompt 构建：`canvasEntityExtract.ts:329`（buildEntityExtractionPrompt）
- JSON 容错解析：`canvasEntityExtract.ts:390`（tryParseJsonObject）
- 字段归一化：`canvasEntityExtract.ts:413`（parseJsonEntities）

**运行包装器**：
- runTrackedCanvasWorkflow：`CanvasWorkspaceView.tsx:4517`（单任务包装，不编排多步）
- startWorkflowTask/finishWorkflowTask：`canvas.api.ts:3985/4100`

**后端持久化与执行**：
- migrations：`packages/storage/migrations/027/031/035/036/029`
- 主进程 IPC：`apps/desktop/src/main/ipc/index.ts:3210/3291`（media/text task）
- 媒体执行器：`packages/agent-runtime/src/services/media/media-task-runtime.service.ts`
- 文本执行器：`packages/agent-runtime/src/services/canvas-text-generator.ts:75`

**顶层 workflow 引擎（运行引擎参照）**：
- 拓扑/就绪/快照：`packages/agent-runtime/src/services/workflow-executor.ts:183/251/264/333`
- 死锁检测：`workflow-executor.ts:388-408`
- workflow_runs 表（session_id NOT NULL）：`packages/storage/migrations/040_workflow_runs.sql`
- workflows 表：`packages/storage/migrations/001_initial_schema.sql:206`

**业界方案**：ComfyUI（双 JSON 格式，`docs.comfy.org/specs/workflow_json`）/ Dify（节点+变量池+Start/End，`docs.dify.ai/en/guides/workflow/node`）/ n8n（trigger+connection）/ tldraw（workflow starter kit）

**错误处理/IPC/安全/权限（§11-16 规约源）**：
- IPC 契约 IpcResult + typedIpcHandle：`apps/desktop/src/main/ipc/typed-ipc.ts:45/60/97`
- SparkError 错误码体系：`packages/shared/src/errors/index.ts:5-32`（19 个错误码）
- 路径安全：`apps/desktop/src/main/services/CanvasProjectPath.ts:14`（isPathStrictlyInsideRoot）/ `ipc/index.ts:363`（sanitizeCanvasPathSegment）/ `SafeFileProtocol.ts:71`（safe-file 白名单）
- 画布窗口单例：`apps/desktop/src/main/services/CanvasWindowService.ts:55`
- 写串行队列（渲染端）：`apps/desktop/src/renderer/design/views/canvas/canvas-tool-host.ts:46`
- 画布 agent bypass 权限：`CanvasAgentModal.tsx:228`（getCanvasPermissionMode）/ `permission-mapper.ts:72`/ `claude-sdk-executor.ts:1493`
- keystore 凭证：`packages/shared/src/keystore/index.ts` / `provider-credential-resolver.ts:23`
- localStorage 4MB 降级：`canvas.api.ts:491/505` / normalizeSnapshotForHotStorage `:1003`

**测试范式（§17 规约源）**：
- dispatch 副作用测试权威范本：`canvasOperationInheritance.test.ts`（1736 行，jsdom+seedCanvasDb+mock window.spark）
- 运行引擎测试金标准：`packages/agent-runtime/src/services/workflow-executor.test.ts`（1175 行，注入 dispatch 回调）
- 纯逻辑测试：`canvasPipeline.test.ts` / `canvasConnectionSemantics.test.ts`
- React 组件测试：`CanvasOperationPanel.test.ts`（createRoot+act）
- 样式契约测试：`canvasNodeHandleStyles.test.ts`（readFileSync+正则）
- 路径守卫测试：`apps/desktop/src/main/ipc/__tests__/canvas-project-delete.test.ts`
- 框架：Vitest 2.x（`apps/desktop/package.json`），无 CI test gate，无覆盖率门禁

**完整调研笔记**：`.spark-artifacts/canvas-workflow-research-notes.md`（13 轮深挖累积，含所有 file:line 证据）
