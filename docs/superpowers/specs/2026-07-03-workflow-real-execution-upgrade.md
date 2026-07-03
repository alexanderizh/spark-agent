# 工作流节点真实执行升级计划

> 状态: 已落地 | 最后核对: 2026-07-03
>
> 任务 A / 任务 B 均已实现并通过单测与类型检查（2026-07-03）；「后续（本轮不做）」小节仍为待开发。

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

### 后续（本轮不做）

- `subagent.parallelism` 真实 fan-out 或删除配置项。
- `input` 节点 LLM 结构化解析（目标/约束/交付物）。
- 循环/迭代节点、审批时附带修改意见继续执行、工作流模板库。
- 宿主 Agent 执行节点（agentId 为空）在 workflow_run 中被静默剔除的语义修复。
