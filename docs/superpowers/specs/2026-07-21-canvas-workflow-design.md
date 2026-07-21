# 无限画布工作流设计

> 状态: 待开发 | 最后核对: 2026-07-21

## 定位

无限画布工作流是画布内的创作产物流，和应用工作台的 Agent Workflow 是两个功能。

应用工作台工作流面向任务执行：`input / plan / agent / tool / approval / verify / review / artifact`，运行记录服务于 Agent、工具调用、审批和代码/文档交付。

无限画布工作流面向画布产物：从文本、角色、场景、分镜、图片、视频、音频和结构化资产出发，批量执行画布操作节点，把输出重新落回画布并保留血缘。它可以借鉴 ComfyUI 的节点图体验，但执行内核必须复用 Spark 画布已有的节点、任务队列、Provider Manifest、输入绑定和资产中心。

## 参考取舍

ComfyUI 当前工作流体系中值得借鉴的点：

- 子图：选中一组节点后封装成可复用的 subgraph node，自动推导外部输入和输出，并支持模块化复用。
- 子图参数面板：不用进入子图，也能在外层调整暴露出来的 widget 可见性、顺序和参数。
- 模板库：模板按模型、用途、许可等维度筛选，加载前检查必需模型/依赖，帮助用户从专业流程起步。
- 保存格式和 API 格式分离：UI 保存格式包含位置、颜色、分组等可编辑信息；API 执行格式只保留服务端运行需要的节点和参数。
- Partner Nodes：把外部闭源模型/API 当成节点接入，但仍和本地节点图组合执行。

对应到 Spark：

- 采用“画布工作流包 + 可执行计划”双格式：前者保留画布布局和用户可编辑信息，后者是运行时冻结快照。
- 采用“工作流节点 / 展开为节点”两种应用方式：简单复用时像 ComfyUI 子图，精修时可展开为普通画布节点。
- 采用“模板依赖检查”：检查 Provider Profile、模型 Manifest、输入类型、输出通道和预估成本，不检查本地模型文件。
- 不照搬 ComfyUI 的 Stable Diffusion 专用节点；Spark 节点类型应围绕已有文本、多模态、媒体生成、影视资产和画布 Agent 能力设计。

参考来源：

- ComfyUI Subgraph: https://docs.comfy.org/interface/features/subgraph
- ComfyUI Workflow API Format: https://docs.comfy.org/development/api-development/workflow-api-format
- ComfyUI Workflow JSON schema: https://docs.comfy.org/specs/workflow_json
- ComfyUI Templates: https://docs.comfy.org/interface/features/template
- ComfyUI 0.3.66 subgraph widget/template update: https://blog.comfy.org/p/comfyui-0366-updates
- ComfyUI Partner Nodes: https://docs.comfy.org/tutorials/partner-nodes/overview

## 目标

- 提供画布工作流的增删改查、复制、导入导出、版本化和模板化。
- 支持用户框选画布节点后，一键用 AI 提取为可复用工作流。
- 支持工作流在画布内通过自定义输入运行，并把图片、视频、音频、文本、分镜或结构化资产作为产物输出到画布。
- 支持工作流作为“折叠节点”使用，也支持展开成普通画布节点继续编辑。
- 运行历史、失败重试、取消、恢复和成本信息沿用画布任务体系，而不是混用应用工作台 `workflow_runs`。
- 工作流定义能跨项目复用，但运行结果永远属于当前画布项目。

## 非目标

- 不替换应用工作台工作流。
- 不把画布工作流注册为全局 Agent Workflow。
- 不让画布工作流默认拥有代码工具、文件系统工具或审批节点。
- 不在第一期支持任意循环、无限递归和长期守护任务。
- 不把 AI 提取结果直接静默保存，必须经过用户确认。

## 核心概念

### CanvasWorkflowDefinition

持久化的画布工作流定义，保存于独立表或项目配置域，不能复用应用工作台的 workflow schema。

建议字段：

```ts
type CanvasWorkflowDefinition = {
  id: string
  projectId?: string
  name: string
  description?: string
  scope: 'project' | 'library'
  version: number
  status: 'draft' | 'published' | 'archived'
  packageJson: CanvasWorkflowPackage
  createdAt: string
  updatedAt: string
}
```

### CanvasWorkflowPackage

UI 可编辑格式，保留节点布局、暴露参数、输入输出契约、依赖和来源信息。

```ts
type CanvasWorkflowPackage = {
  schemaVersion: 1
  graph: {
    nodes: CanvasWorkflowNode[]
    edges: CanvasWorkflowEdge[]
    groups?: CanvasWorkflowGroup[]
  }
  contract: {
    inputs: CanvasWorkflowInput[]
    outputs: CanvasWorkflowOutput[]
    exposedParams: CanvasWorkflowExposedParam[]
  }
  dependencies: {
    providerProfiles: CanvasWorkflowProviderDependency[]
    modelCapabilities: CanvasWorkflowModelCapabilityDependency[]
    canvasNodeKinds: string[]
    skills?: string[]
  }
  provenance?: {
    extractedFromProjectId?: string
    extractedFromCanvasId?: string
    sourceNodeIds?: string[]
    sourceAssetIds?: string[]
  }
}
```

### CanvasWorkflowExecutablePlan

运行时冻结格式，只服务于执行：

- 固定节点拓扑、参数、模型、输入绑定和输出槽位。
- 冻结用户本次输入快照，避免运行中画布变更污染任务。
- 为每个执行节点生成稳定 `operationInstanceId`，用于任务状态、输出回绑和重试。
- 不保存 UI 坐标、颜色、分组折叠状态。

### CanvasWorkflowRun

画布工作流运行记录，属于画布项目和画布任务系统。

建议字段：

```ts
type CanvasWorkflowRun = {
  id: string
  projectId: string
  canvasId: string
  workflowDefinitionId: string
  workflowVersion: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  inputSnapshotJson: unknown
  executablePlanJson: CanvasWorkflowExecutablePlan
  operationStatesJson: CanvasWorkflowOperationState[]
  outputNodeIdsJson: string[]
  outputAssetIdsJson: string[]
  createdAt: string
  updatedAt: string
}
```

这张表不能命名为 `workflow_runs`，避免和应用工作台工作流混淆。建议使用 `canvas_workflow_runs`。

## 节点类型

第一期只支持与当前画布能力自然吻合的节点：

- `canvas_input`：声明用户输入，支持文本、图片、视频、音频、文件、角色、场景、道具、分镜、节点引用和资产集合。
- `canvas_param`：声明可编辑参数，例如风格、比例、时长、镜头数量、模型、Provider、seed、批量数量。
- `canvas_asset_ref`：引用画布已有节点或资产中心资料。
- `canvas_operation`：映射现有画布操作节点，例如文生图、图生图、图片编辑、多图合成、文生视频、图生视频、语音合成、文本生成、提示词优化、分镜拆解。
- `canvas_transform`：轻量数据转换，例如拆分分镜、批量映射、合并文本、选择主产物、格式化 prompt。
- `canvas_subworkflow`：引用另一个画布工作流，第一期只允许无递归引用。
- `canvas_output`：声明输出槽位和落回画布的方式。

第二期再考虑：

- 条件分支。
- 批量循环。
- 多候选择优。
- 人工检查点。
- 画布 Agent 节点。

## CRUD 设计

入口：

- 画布侧栏新增“工作流库”。
- 右键多选菜单新增“提取为画布工作流”。
- 顶部工具栏新增工作流图标，打开当前项目工作流管理。
- 操作节点工作台增加“保存为工作流步骤模板”，仅保存单节点或小片段。

基础操作：

- 新建空白工作流。
- 从模板新建。
- 从框选节点提取。
- 编辑名称、描述、封面、标签、输入输出、暴露参数。
- 复制为新版本。
- 发布到项目库或个人库。
- 归档。
- 导入/导出 `.spark-canvas-workflow.json`。

版本策略：

- 草稿可覆盖保存。
- 已发布版本不可原地破坏性修改，编辑时生成新 draft version。
- 运行记录固定引用版本号。
- 画布上的工作流节点默认跟随某个固定版本，用户可手动升级。

## 从框选节点 AI 提取为工作流

### 用户流程

1. 用户在画布中框选一组节点。
2. 右键选择“提取为画布工作流”。
3. 系统生成选区快照：节点、边、任务配置、Prompt 文档、输入绑定、产物类型、资产引用、模型参数和输出血缘。
4. 本地规则先做拓扑分析，识别内部边、外部输入、外部输出、缺失依赖和可能的参数。
5. AI 在规则分析基础上生成工作流草案：名称、描述、输入契约、输出契约、暴露参数、节点分组和推荐应用方式。
6. 用户在确认面板中调整输入、参数和输出命名。
7. 保存为项目工作流或个人工作流。

### AI 只负责语义提炼

AI 可做：

- 给工作流命名和写描述。
- 判断哪些外部节点应成为用户输入。
- 判断哪些节点参数应暴露为可编辑参数。
- 为输出槽位命名，例如“角色身份图”“镜头视频”“旁白音频”。
- 识别重复模式，例如“对每个分镜生成图片”。
- 建议是否折叠成工作流节点，还是展开为模板。

AI 不可直接做：

- 绕过拓扑校验。
- 改写不可见系统提示词。
- 删除原画布节点。
- 静默发布到个人库。
- 引入未安装 Provider 或未声明模型能力。

### 规则校验

保存前必须校验：

- 选区内部图无非法环。
- 所有 `canvas_operation` 都能映射到已知画布操作类型。
- 外部输入都有明确类型和 fallback。
- 输出槽位至少一个。
- 引用的 Provider、模型能力和参数 schema 可解析。
- 输入绑定不会引用选区外的临时任务产物，除非提升为 `canvas_input`。
- 输出回绑策略明确：新建节点、更新指定节点、加入分组或写入资产中心。

## 工作流应用设计

### 应用方式 A：作为工作流节点运行

用户从工作流库拖入画布，生成一个 `canvas_workflow_node`。节点外观类似折叠子图：

- 左侧显示输入端口。
- 右侧显示输出端口。
- 节点面板显示暴露参数。
- 双击进入内部工作流查看，但默认不展开。
- 运行后在节点右侧生成输出节点，并用 `generated` 血缘连接。

适合稳定复用的流程，例如：

- 角色设定文本 + 参考图 -> 角色身份图四连。
- 分镜表 -> 镜头图片批量生成。
- 镜头图片 + 运动描述 -> 视频片段。
- 文案 -> 海报图 + 短视频脚本 + 配音。

### 应用方式 B：展开为普通画布节点

用户选择“展开到画布”，系统按模板布局创建普通节点和连线：

- 可继续改每个操作节点的 Prompt、模型和参数。
- 展开后不再跟随原工作流版本自动升级。
- 仍记录来源 workflow id/version，便于追踪和再次提取。

适合探索和二次创作。

### 应用方式 C：对选中节点应用

用户先选中素材，再从工作流库点击“应用到选中内容”：

- 系统按输入契约自动匹配选中节点。
- 匹配不确定时打开绑定面板。
- 输入数量可多对一或一对多，例如多张角色图作为参考图集合。
- 输出自动放在选区右侧或下方，并建立分组。

### 自定义输入面板

运行前展示轻量表单，不进入复杂工作流编辑器：

- 文本输入：长文、短提示词、负面提示词、风格描述。
- 资产输入：从画布点选、资产中心选择、拖入本地文件。
- 结构化输入：角色、场景、道具、分镜行、镜头列表。
- 参数输入：比例、分辨率、时长、帧率、数量、seed、模型。
- 输出设置：生成到新分组、追加到当前分组、替换指定占位节点、同时写入资产中心。

表单字段来自 `contract.inputs` 和 `contract.exposedParams`。没有暴露的内部节点参数保持隐藏。

## 输出与血缘

输出必须回到画布，不能只停留在运行记录。

输出策略：

- 每个 `canvas_output` 生成一个或多个画布节点。
- 批量输出自动创建结果分组。
- 输出节点记录 `sourceWorkflowRunId`、`sourceOperationInstanceId`、`sourceWorkflowOutputId`。
- 资产中心记录工作流来源、输入快照和模型调用摘要。
- 失败后已完成输出保留，不因后续节点失败而删除。
- 重试时可选择复用已完成上游结果，只重跑失败分支。

## 运行时

执行器流程：

1. 将 `CanvasWorkflowPackage` 编译为 `CanvasWorkflowExecutablePlan`。
2. 解析用户输入为 `CanvasInputBinding[]` 和资产快照。
3. 对每个 `canvas_operation` 调用现有画布任务提交入口。
4. 监听画布任务生命周期，把状态映射回 `CanvasWorkflowRun.operationStatesJson`。
5. 每个输出槽位完成时立即创建或更新画布节点。
6. 所有活跃输出完成后标记 run 完成。

执行能力：

- 支持暂停、取消、失败重试和从失败节点继续。
- 支持跳过已经存在且输入 hash 相同的中间结果。
- 支持批量节点并发上限和 Provider 成本预算。
- 支持运行前 dry run：只检查依赖、输入、参数和预估成本，不提交模型任务。

第一期可以不做真正的全局调度器，先把工作流执行编排为画布任务队列上的轻量 DAG；但持久化模型要预留后续条件、批量和子工作流。

## UI 结构

工作流库：

- 左侧分类：项目工作流、个人工作流、内置模板、最近使用。
- 顶部搜索和筛选：用途、输入类型、输出类型、Provider、媒体类型、标签。
- 列表卡片展示：名称、输入输出图标、依赖状态、版本、最近运行。
- 详情侧栏：描述、输入输出契约、依赖检查、版本、运行入口。

工作流编辑器：

- 使用画布内同一套节点视觉语言，但和主画布分层，不直接编辑真实资产节点。
- 左侧节点库只展示画布工作流节点类型。
- 右侧 Inspector 编辑输入、输出、暴露参数和依赖。
- 顶部提供验证、发布、试运行、导出。
- 支持从实际画布选区进入编辑器，并展示“来源节点”对照。

工作流节点 Inspector：

- 参数页：用户输入和暴露参数。
- 运行页：当前 run 状态、每个内部步骤、日志入口、重试按钮。
- 输出页：输出节点、资产、打开位置、重新生成。
- 版本页：当前版本、可升级版本、展开为节点。

## 与现有能力的衔接

- Prompt 参数编排器：工作流输入最终仍进入 `CanvasPromptDocument` 和 `CanvasInputBinding[]`，不新增第二套资源选择协议。
- 批量任务配置：可复用批量提交确认、参数合并和校验逻辑。
- 画布 Agent：第一期只在“AI 提取为工作流”中使用；后续可作为可选节点。
- 资产中心：工作流输入和输出都写入资产血缘。
- 任务可观测性：复用 `clientTaskId`、Provider 请求快照和任务详情面板。
- 模型 Manifest：所有 Provider 参数和输入输出能力校验必须走 Manifest，不能写死模型名。

## 数据迁移

新增存储建议：

- `canvas_workflows`
- `canvas_workflow_runs`
- `canvas_workflow_run_tasks`

不改动：

- 应用工作台 `workflows`
- 应用工作台 `workflow_runs`

命名约束：

- 协议类型统一以 `CanvasWorkflow` 前缀开头。
- IPC channel 统一以 `canvas:workflow:*` 开头。
- UI 文案使用“画布工作流”，避免只写“工作流”。
- 应用工作台仍使用“工作台工作流”或“Agent 工作流”。

## 分期

### Phase 1：定义、库和手动应用

- 新增 `CanvasWorkflowDefinition`、导入导出和项目级工作流库。
- 支持手动创建工作流、拖入画布生成工作流节点。
- 支持输入面板、依赖检查、dry run。
- 支持按 DAG 提交画布任务，并输出到画布。

### Phase 2：框选提取

- 新增选区快照和规则拓扑分析。
- 接入 AI 提取草案。
- 提供确认面板和 contract 编辑。
- 支持保存为项目/个人工作流。

### Phase 3：子图体验和模板库

- 支持工作流节点内部查看和暴露参数排序。
- 支持展开为普通节点。
- 支持内置模板库、标签筛选和依赖提示。

### Phase 4：高级编排

- 支持条件、批量循环、多候选择优、人工检查点。
- 支持子工作流。
- 支持跨项目个人库同步。

## 验收标准

- 用户能创建、编辑、复制、删除、导入、导出画布工作流。
- 用户能把画布工作流拖到画布，填入自定义输入，运行后得到可见产物节点。
- 用户能框选一组现有节点，经 AI 提取和人工确认后保存为画布工作流。
- 工作流运行失败时，已完成产物不丢失，失败节点可重试。
- 画布工作流运行记录不写入应用工作台 `workflow_runs`。
- 所有画布工作流协议、IPC、数据库和 UI 文案都带 `canvas` 或“画布”命名。
- 输出节点和资产中心都能追溯到 workflow definition、version、run 和内部步骤。
- 导入缺少 Provider/模型能力的工作流时，运行前明确提示，不在提交后才失败。

## 风险

- 选区提取容易过度依赖 AI。必须先做规则拓扑分析，AI 只补语义。
- 工作流节点如果过早支持复杂控制流，会和应用工作台工作流边界变模糊。第一期只做画布任务 DAG。
- 输出回绑如果不稳定，会破坏用户对画布血缘的信任。必须把输出槽位和节点创建策略持久化。
- 暴露参数过多会让工作流节点变成另一个复杂面板。默认只暴露高频参数，其余留在内部编辑器。
- 旧画布节点数据可能不完整。提取时需要“无法提取原因”面板，而不是生成半可信流程。
