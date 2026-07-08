# 工作流节点真实执行升级计划

> 状态: 已落地 | 最后核对: 2026-07-08
>
> 任务 A / 任务 B / 第二轮 / 第三轮 / 第四轮 loop 节点均已实现；loop 节点于 2026-07-08 按递归原子节点方案落地。

## 背景：节点完成度审计（2026-07-03）

运行时执行链路：`WorkflowView`（编排 UI）→ `workflow.repository`（持久化）→ `session.service.ts` 的 `workflow_run` 工具 → `workflow-executor.ts`（纯函数执行器）。

引擎级能力**已具备**：拓扑排序、波次并行、边条件求值（5 种算子）、重试、断点续跑、快照持久化（workflow-run.repository）、workflow_progress 进度事件、附件透传、死锁检测、不可达分支剪枝。

各节点实际状态：

| 节点 | 声称 | 实际 | 结论 |
|---|---|---|---|
| 执行 agent | 真实派发 | 真实派发（需绑定具体 Agent） | ✅ 可用 |
| 子代理 subagent | 真实派发 | 临时 worker + 节点级覆盖（model/skill/tool/mcp/rule） | ✅ 可用；`parallelism` 配置无运行时消费 |
| 审批 approval | 审批节点 | onQuestion 暂停、批准/拒绝、无人值守自动放行、不重试 | ✅ 完整 |
| 验证 verify | 校验执行 | 真跑 verifyCommands（10min 超时/20MB buffer/重试） | ✅ 完整 |
| 需求输入 input | 原子输出 | 透传 config.value/prompt/objective，无解析 | ⚠️ 仅透传（本轮维持） |
| 计划 plan | 只读派发 | 临时只读 worker 单轮 LLM 产出计划文本（禁写/执行工具） | ✅ 已落地（任务 A） |
| 复核 review | 只读派发 | 临时只读 worker 单轮 LLM 产出复核文本 | ✅ 已落地（任务 A） |
| 产物 artifact | 真实执行 | 单轮产出文本；配 exportPath 时写入工作区文件（防穿越） | ✅ 已落地（任务 A） |
| Skill / 工具 / MCP | 真实执行 | 临时受限 worker 单轮派发（skill 挂 skillIds / tool 收窄 toolIds / mcp 挂 mcpServerIds） | ✅ 已落地（任务 A） |

> 任务 A 兼容开关：节点级 `config.execution: 'auto' | 'static'`，`static` 保留旧静态回显，缺省 `auto` 走真实执行；`input` 永远透传。实现见 `session.service.ts`（`resolveWorkflowMembers` 花名册扩展 + `executeAtomicNode` 回调 + `createWorkflowAtomicMember` / `resolveWorkflowArtifactExportPath` / `finalizeWorkflowArtifactContent` helper），单测 `workflow-atomic-execution.test.ts`。

前端编排器额外缺口（审计时状态，均已由任务 B 修复）：

- ~~**边条件不可编辑且保存即丢失**：`graph-adapter.ts` 的 `graphToReactFlow`/`reactFlowToGraph` 均不携带 `condition` 字段。~~ → 已双向保留（edge.data.condition），带条件的边显示 label 并以虚线/警示色区分。
- ~~**节点检查器没有 `outputKey` 输入**：状态传递（`buildWorkflowNodeInputs`）与边条件全依赖 outputKey，UI 却无处配置。~~ → 节点检查器已加「输出键 outputKey」输入框。
- ~~原子节点的 Provider/模型选择器是死配置（原子节点不调 LLM）。~~ → 任务 A 后原子节点真实派发，Provider/模型选择随 `createWorkflowSubagentMember` 继承逻辑生效。

## 任务拆分

### 任务 A（后端，Opus）：原子节点真实执行

1. `skill` / `tool` / `mcp` 节点升级为真实执行：在 `session.service.ts` 的 `executeAtomicNode` 回调内为节点构造临时受限 worker（复用 `createWorkflowSubagentMember` 模式，仅挂载该节点所选 skillIds/toolIds/mcpServerIds），经 `runSingleDispatch` 派发单轮执行。
2. `plan` / `review` 节点 LLM 化：同机制派发，但限制为只读工具集（探索 + 产出文本）。
3. `artifact` 节点：新增可选 `config.exportPath`，配置后把最终内容写入 host 工作区文件。
4. 新增节点级开关 `config.execution: 'auto' | 'static'`：`static` 保留旧的静态回显行为（兼容/降本），默认 `auto` = 真实执行；`input` 默认保持透传。
5. 同步更新 `node-kinds.tsx` 的 runtimeLabel/runtimeHint 与本文档。
6. 补单测。约束：不改 `workflow-executor.ts` 纯函数执行器的对外接口。

> 任务 A 状态：✅ 已落地（2026-07-03）。未改动 `workflow-executor.ts` 对外接口——全部经既有 `executeAtomicNode` 回调注入。

### 任务 B（前端，Sonnet）：条件分支编排 UI

1. `graph-adapter.ts`：`condition` 双向保留（edge.data ↔ WorkflowEdge.condition）。
2. `WorkflowView.tsx`：选中边出现边检查器（算子下拉 exists/truthy/falsy/equals/not_equals + key + value + 清除）；带条件的边显示 label 并作样式区分。
3. 节点检查器补「输出键 outputKey」输入框。

> 任务 B 状态：✅ 已落地（2026-07-03）。选中节点/边互斥；比较值按 true/false→布尔、null→空值、纯数字→number、其余字符串解析（`parseEdgeConditionValue`）；条件边样式 `.wf-edge-conditional`（views.css）。

### 第二轮落地（2026-07-03）：编排能力增强四件套

- `subagent.parallelism` 真实 fan-out：N 路并发 dispatch，结果按 `--- branch i ---` 拼接，任一分支失败则节点失败，与 maxAttempts 重试正交（workflow-executor.ts）。
- 宿主 Agent 执行节点（agentId 为空）显式 `missing_agent_id` 失败，不再静默剔除；空 workerId 节点保留进执行期由 `executeWorkflowAgentNode` 显式失败，`hasWorkflowExecutableNodes` 边界未动（workflow-executor.ts）。
- `input` 节点 LLM 结构化解析（目标/约束/交付物三段），非法输出回落透传；`execution:'static'` 兜底（session.service.ts）。
- 审批节点支持双问询（决策 + 修改意见），comment 经 `state[outputKey]` 流向下游，零协议改动（session.service.ts）。
- 前端 node-kinds 文案同步标注真实执行/只读派发 + parallelism 提示。

> 第二轮状态：✅ 已落地（2026-07-03）。workflow-executor 28 例 + atomic 42 例，共 70/70 全绿；`@spark/agent-runtime`、`@spark/protocol` tsc 通过；前端 workflow 相关 0 类型错误。

### 第三轮（已落地，2026-07-03）：工作流模板库

新增 10 个预置模板，覆盖全部 11 类节点 + 条件分支 + parallelism fan-out + approval 门禁 + artifact exportPath + verify verifyCommands：

1. 标准研发流（input→plan→agent→verify→artifact）
2. 审批门禁流（approval 做门禁，拒绝即停）
3. 并行草案评审（subagent parallelism=3 fan-out）
4. 只读调研报告（review 链 + artifact exportPath 写盘）
5. Skill 应用流
6. 工具调用流（plan→tool→verify）
7. MCP 外部能力流
8. 条件路由流（plan equals 决策，二分支独立终点）
9. 复核门禁流（review equals 决策）
10. 调研决策流（review equals 决策）

入口：工作流列表页工具栏「模板库」按钮 + 空状态「从模板开始」次按钮。导入即落库为 draft（复用 `workflow:create`），绑定类字段（agentId/skillIds/toolIds/mcpServerIds）留空，由用户在检查器补齐。

实现：`workflow-templates.ts`（数据）+ `WorkflowTemplatePicker.tsx`（Modal 卡片网格，复用 `workflow-card-node` 路由缩略）+ `WorkflowView` 集成（抽象 `createWorkflowFromGraph` + 按钮 + Picker 挂载）+ `workflow-templates.test.ts`（63 例校验：节点/边 id 唯一、kind 合法、坐标数字、条件边 key 引用 outputKey、DAG 无环、含 input 起点、11 类节点全覆盖）。

> 第三轮状态：✅ 已落地（2026-07-03）。`@spark/desktop` typecheck 0 错误；模板校验 63/63 全绿。浏览器交互实测（点开 Modal、选模板导入画布）由用户进行。

### 第四轮（已落地，2026-07-08）：循环/迭代节点

- `WorkflowNodeKind` 新增 `loop`；`WorkflowNodeConfig` 新增 `body` / `maxIterations` / `breakCondition` / `loopVar` / `resultKey` / `collectAll`。
- 执行器不改主 DAG 调度模型：`loop` 作为原子节点递归调用 `executeWorkflowAgentPlan` 执行 `config.body` 子图。
- 安全护栏：默认最多 5 轮、硬上限 50；v1 禁止嵌套 loop；循环体节点 id 不得与外层图冲突；loop 节点不自动重试，避免失败后重复触发整段高成本派发。
- 运行时花名册递归扫描循环体节点，循环体内 agent/subagent/真实执行原子节点会注册为可派发 worker。
- 编排器新增 loop 节点、检查器字段、循环体 JSON 编辑与“迭代润色直到通过”模板。
- v1 限制：loop 内中断后续跑从第 0 轮重新执行；前端暂未做嵌套 mini WorkflowView 编辑器。

> 第四轮状态：✅ 已落地（2026-07-08）。执行器单测 32/32 全绿；模板校验 81/81 全绿；`@spark/protocol` typecheck 通过。`@spark/desktop` / `@spark/agent-runtime` 全包 typecheck 当前受既有无关错误阻断，详见本次提交验证记录。

### 后续历史评估（已更新）

- **循环/迭代节点**：设计文档见 [../../../todo/工作流循环节点设计方案.md](../../../todo/工作流循环节点设计方案.md)（已落地，2026-07-08）。设计出炉后风险由「HIGH/CRITICAL 需重构核心执行模型」下修为「中等——递归调用现有执行器，不碰核心调度」，详见该文档。以下为原始评估存档：
  - 难度根因：当前执行器 `workflow-executor.ts` 基于**拓扑排序 + 波次并行**，整个执行模型假设 DAG、**不支持回边**。引入循环不是加一个节点 kind，而是要重构执行模型：
    1. 显式 `loop` / `iterate` 节点 kind，带 `maxIterations`、`breakCondition`、`loopVar`（状态传递变量名）；
    2. 执行器要识别 loop 子图、在波次调度外建立「迭代栈」，每次迭代复用子图节点但隔离 `nodeExecutions` 状态；
    3. 中断条件求值依赖运行时 state（需在 `buildWorkflowNodeInputs` 之上扩展循环作用域变量）；
    4. 节点 `status`/`executions` 在多次迭代下的语义（按迭代展开 vs 聚合）需重新定义，前端 DAG 渲染也要适配；
    5. 与 parallelism fan-out、maxAttempts 重试、条件边都要正交，极易引入死循环/状态污染。
  - 影响面：`workflow-executor.ts`（执行模型）、`graph-adapter.ts`（loop 子图序列化）、`session.service.ts`（loop 节点 worker 注册）、`WorkflowView`（loop 容器视觉）、`protocol`（loop config 类型）。
  - 是对标 n8n/Dify/Coze 的差异化能力，但**风险与工作量都明显高于前面所有轮次**，本轮不动手，保留给后续资深 agent 立项评审。
- **工作流模板库**：见上方「第三轮」。
