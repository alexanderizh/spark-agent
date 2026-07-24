# 无限画布工作流设计

> 状态: 实施中 | 最后核对: 2026-07-24

## 定位

无限画布工作流是画布内的创作产物流，和应用工作台的 Agent Workflow 是两个功能。

当前已进入执行闭环阶段：除独立定义存储、项目/个人双作用域管理、工作流库和确定性选区提取外，已加入语义编译器、不可变版本、独立运行/步骤记录、自定义输入面板、DAG 调度、失败重试/取消/恢复、真实画布任务等待、产物血缘、AI 语义增强和 Provider 依赖预检。定义列表采用服务端分页；子工作流固定定义与版本；Provider 预检使用真实 Manifest 能力 ID；运行输出按 `sourceNodeId + sourceHandle` 投影；已有运行历史的定义只能归档。协议、存储、运行时、desktop 全量测试、类型检查、lint 和生产构建已经通过；隔离后的真实 Electron 三路径 E2E 尚待在无并发用户实例时完成，因此本文整体状态保持“实施中”。

当前 `user_id = 0` 明确定义为本机设备资料域，不伪装成账号级个人库。后续做云同步时必须通过独立迁移把本机资料映射到登录账号，不能直接改变现有行的归属语义。

应用工作台工作流面向任务执行：`input / plan / agent / tool / approval / verify / review / artifact`，运行记录服务于 Agent、工具调用、审批和代码/文档交付。

无限画布工作流面向画布产物：从文本、角色、场景、分镜、图片、视频、音频和结构化资产出发，批量执行画布操作节点，把输出重新落回画布并保留血缘。它可以借鉴 ComfyUI 的节点图体验，但执行内核必须复用 Spark 画布已有的节点、任务队列、Provider Manifest、输入绑定和资产中心。

画布 Agent 面板通过现有 `spark_canvas` MCP 工具桥使用上述能力，不新增第二套工作流 UI。工具前缀统一为 `canvas_workflow_*`，支持查询、CRUD、选区提取、展开、运行和运行控制；展开直接调用画布物化动作生成独立节点，运行继续使用 `canvas_workflow_runs`。删除、展开和开始运行的首次调用只返回确认摘要，用户在对话中确认后 Agent 才能以 `confirmed: true` 重试。

## 参考取舍

ComfyUI 当前工作流体系中值得借鉴的点：

- 子图：选中一组节点后封装成可复用的 subgraph node，自动推导外部输入和输出，并支持模块化复用。
- 子图参数面板：不用进入子图，也能在外层调整暴露出来的 widget 可见性、顺序和参数。
- 模板库：模板按模型、用途、许可等维度筛选，加载前检查必需模型/依赖，帮助用户从专业流程起步。
- 保存格式和 API 格式分离：UI 保存格式包含位置、颜色、分组等可编辑信息；API 执行格式只保留服务端运行需要的节点和参数。
- Partner Nodes：把外部闭源模型/API 当成节点接入，但仍和本地节点图组合执行。

对应到 Spark：

- 采用“画布工作流包 + 可执行计划”双格式：前者保留画布布局和用户可编辑信息，后者是运行时冻结快照。
- 采用 ComfyUI 式“工作流即节点图模板”：拖入画布时直接展开为普通节点和连线，不创建折叠工作流节点。
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
- 支持把工作流从侧栏拖入画布，按模板布局生成可独立编辑的普通节点、连线和配置。
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

- 无限画布首页在“画布项目”旁新增“画布工作流库”二级导航。
- 右键多选菜单新增“提取为画布工作流”。
- 项目画布底部工具坞新增工作流入口，打开当前项目工作流抽屉。
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
- 从侧栏落到画布的普通节点不跟随任何定义版本；再次拖入才会复制当时的最新定义内容。
- 子工作流节点也必须固定 `workflowId + workflowVersion`；编译器会分别验证同一定义的每个固定版本，并拒绝递归或缺失版本。

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
- 建议节点分组、输入输出命名和拖入后的初始布局。

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

### 应用方式 A：拖入并展开真实画布图

用户从工作流侧栏拖到画布落点，系统将工作流包物化为当前画板上的普通节点和连线：

- 所有节点分配新的画布 ID，保留工作流包内的相对位置、节点类型、Prompt、模型和参数配置。
- 所有内部边按新 ID 重建，并保留 `sourceHandle` / `targetHandle`。
- 工作流定义只承担可复用模板职责；落图后不保留 workflow id/version，不跟随定义更新，也不建立追溯关系。
- 落图后的节点与手工创建节点完全一致，可移动、删除、改线、换模型、改参数和重新提取。
- 转换或落盘失败时整次操作不写入画布，不能留下半组节点。

适合复用的流程，例如：

- 角色设定文本 + 参考图 -> 角色身份图四连。
- 分镜表 -> 镜头图片批量生成。
- 镜头图片 + 运动描述 -> 视频片段。
- 文案 -> 海报图 + 短视频脚本 + 配音。

### 应用方式 B：对选中节点应用

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
- 依赖检查必须通过 `capabilityForOperation` 把画布操作映射到 Provider Manifest 能力，不能把 `text_to_image` 当作纯文本能力。

第一期可以不做真正的全局调度器，先把工作流执行编排为画布任务队列上的轻量 DAG；但持久化模型要预留后续条件、批量和子工作流。

## UI 结构

工作流库：

- 左侧分类：项目工作流、个人工作流、内置模板、最近使用。
- 顶部搜索和筛选：用途、输入类型、输出类型、Provider、媒体类型、标签。
- 列表卡片展示：名称、输入输出图标、依赖状态、版本、最近运行。
- 详情侧栏：描述、输入输出契约、依赖检查、版本和“添加到画布”入口。

工作流编排：

- 不另建脱离项目上下文的图编辑器；工作流直接拖到当前画布展开为真实节点和连线。
- 用户使用现有节点 Inspector 编辑 Prompt、模型、参数和输入绑定，改线后可重新框选提取或更新定义。
- 工作流包只负责复制时的相对布局和配置，不在落图节点上保存定义 ID、版本或来源对照。

展开后的节点 Inspector：

- 每个操作节点沿用现有配置面板和运行入口。
- 每个素材、文本和 Prompt 节点沿用现有编辑与资产操作。
- 节点间连线保留原始 edge type 与 source/target handle，可自由重连。
- 定义版本只在工作流库中管理，不出现在已展开节点上。

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
- 支持手动创建工作流、从侧栏拖入画布生成真实节点和连线。
- 支持输入面板、依赖检查、dry run。
- 支持按 DAG 提交画布任务，并输出到画布。

### Phase 2：框选提取

- 新增选区快照和规则拓扑分析。
- 接入 AI 提取草案。
- 提供确认面板和 contract 编辑。
- 支持保存为项目/个人工作流。

### Phase 3：子图体验和模板库

- 支持模板预览和暴露参数排序。
- 支持更复杂的模板布局与子工作流展开。
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
- 通过定义执行器产生的输出可追溯到 definition、version、run 和内部步骤；模板拖入后手动运行的普通节点只沿用画布任务血缘。
- 导入缺少 Provider/模型能力的工作流时，运行前明确提示，不在提交后才失败。

## 风险

- 选区提取容易过度依赖 AI。必须先做规则拓扑分析，AI 只补语义。
- 画布工作流如果过早支持复杂控制流，会和应用工作台工作流边界变模糊。第一期只做画布任务 DAG。
- 输出回绑如果不稳定，会破坏用户对画布血缘的信任。必须把输出槽位和节点创建策略持久化。
- 暴露参数过多会让工作流定义变成另一套复杂面板。落图后直接使用普通节点配置，定义确认页只保留高频契约字段。
- 旧画布节点数据可能不完整。提取时需要“无法提取原因”面板，而不是生成半可信流程。
