# Spark L3 WorkflowGraph Schema 冻结备忘录

> Ground Truth：spark-agent **0.11.68**（commit `97a5c7a4`）｜冻结日期：2026-09-14｜冻结人：Qoder（夜间自动执行）
> 本文件是 spark-workflow-generator skill 的唯一 schema 事实来源。上游每前进一个版本，须按 §7 漂移监控点核对后刷新本文件。

## 1. 取证文件清单（全部亲自读取核实）

| 事实 | 来源文件 | 位置 |
|---|---|---|
| 13 节点 kind 枚举 | `packages/protocol/src/ipc/index.ts` | L3404-3417（0.11.54 时为 L3121，内容一致） |
| WorkflowNodeConfig 全字段 | 同上 | L3425-3474 |
| WorkflowNode / WorkflowEdge / WorkflowGraph | 同上 | L3476-3510 |
| 边条件 5 操作符 | 同上 | L3492-3497 |
| preflight 13 error + 5 warning 权威枚举 | `packages/protocol/src/session-workflow-binding.ts` | L70-90 |
| preflight 校验实现 | `packages/agent-runtime/src/services/workflow/workflow-preflight.service.ts` | 全文 323 行 |
| 官方 13 个预制模板 | `apps/desktop/src/renderer/design/views/workflow/workflow-templates.ts` | 全文 1067 行 |
| 分支不汇合陷阱实现 | `packages/agent-runtime/src/services/workflow-executor.ts` | `collectWorkflowInactiveNodeIds` L528 |
| .sparkflow 容器格式 | `packages/protocol/src/workflow-bundle.ts` + `docs/plans/2026-09-05-workflow-bundle-import-export.md` | 全文 |

**A2 核对结论**：0.11.54→0.11.68 的 70 个提交中，workflow 相关变更全部位于执行/绑定/分发层（WorkflowRunCoordinator、session-workflow-binding 098 迁移、SessionWorkflowPicker、effective-workflow-resolver、team-registry v2.1 Nacos AgentSpec 载体）；**L3 graph schema 本身零变更**。

## 2. WorkflowGraph 顶层结构

```jsonc
{
  "nodes": [ WorkflowNode... ],   // 必填，数组
  "edges": [ WorkflowEdge... ],   // 必填，数组
  "orientation": "horizontal" | "vertical"  // 可选；缺省按 horizontal；仅 vertical 需写入
}
```

```jsonc
// WorkflowNode
{
  "id": "string",          // 图内唯一；loop body 内节点 ID 也不得与外层冲突
  "kind": "<13 种之一>",
  "title": "string",       // 显示名
  "x": number, "y": number, // 画布坐标（顶层字段，不在 config 里！）
  "config": { WorkflowNodeConfig }
}

// WorkflowEdge
{
  "id": "string",          // 图内唯一
  "from": "nodeId",
  "to": "nodeId",
  "condition": {           // 可选；缺省 = 无条件流转
    "op": "exists" | "equals" | "not_equals" | "truthy" | "falsy",
    "key": "string",       // 引用某上游节点 config.outputKey 写入的 state 键
    "value": "string|number|boolean|null"  // 仅 equals / not_equals 需要
  }
}
```

## 3. 节点 kind 全集（13 种，封闭枚举）

| kind | 定位 | 关键 config |
|---|---|---|
| `input` | 工作流入口，解析用户需求 | prompt, outputKey, retryCount；execution='static' 时原样透传 |
| `plan` | 拆解计划 | prompt, outputKey |
| `route` | 条件路由（LLM 从 routeOptions 选一） | prompt, outputKey, **routeOptions[]**（value/label/description） |
| `agent` | 主执行（绑定 Agent 干活） | prompt, outputKey, agentId?, modelId?, providerProfileId?, skillIds?, toolIds?, mcpServerIds?, ruleIds?, parallelism? |
| `subagent` | 子代理执行 | 同 agent 语义 |
| `skill` | 调用指定技能 | prompt, skillIds, outputKey |
| `tool` | 工具调用（三种确定性模式或 LLM 自主） | **toolSource**('mcp'\|'builtin'\|'platform'\|null), toolServerId?, toolName?, toolArgs?({{key}} 插值), toolIds? |
| `mcp` | MCP 服务器工具直调（不经 LLM） | toolServerId, toolName, toolArgs |
| `approval` | 人工审批门禁（拒绝=整个工作流终止） | prompt, outputKey |
| `verify` | 运行验证命令 | prompt, **verifyCommands[]**, outputKey |
| `review` | 评审/判断（常输出 pass/retry 类裁决） | prompt, outputKey |
| `artifact` | 交付产物（可写文件） | prompt, outputKey, **exportPath?**（工作区相对路径，防穿越） |
| `loop` | 循环体（v1 不支持嵌套） | **body**(完整 WorkflowGraph), maxIterations(缺省5，硬上限50), breakCondition, loopVar(缺省 __loop_index), resultKey, collectAll(缺省 false) |

## 4. WorkflowNodeConfig 字段全集（24 字段 + 开放索引签名）

| 字段 | 类型 | 语义（源码注释原文提炼） |
|---|---|---|
| prompt | string | 节点指令 |
| role | string | 角色设定 |
| modelId | string\|null | 指定模型 |
| providerProfileId | string\|null | 指定渠道 |
| skillIds | string[] | 绑定技能（**工作区相关，模板留空**） |
| toolIds | string[] | 工具白名单（LLM 自主模式）；须在 WORKFLOW_RESTRICTABLE_TOOL_NAMES 内 |
| toolSource | 'mcp'\|'builtin'\|'platform'\|null | 确定性调用模式；null=旧的受限 worker 模式（toolIds 白名单+LLM 自主） |
| toolServerId | string\|null | toolSource='mcp' 时的目标服务器 id |
| toolName | string\|null | 确定性调用目标工具名（platform 工具包格式 `packageId/toolName`） |
| toolArgs | Record<string,unknown> | 结构化参数；字符串值支持 `{{key}}` 插值（key=上游 outputKey/state 键） |
| mcpServerIds | string[] | 挂载 MCP 服务器 |
| ruleIds | string[] | 绑定规则 |
| retryCount | number | 重试次数 |
| outputKey | string | 产出写入 state 的键名（**条件边/toolArgs 插值引用的目标**） |
| agentId | string\|null | 绑定 Agent（**工作区相关，模板留空**） |
| parallelism | number | 并行度 |
| verifyCommands | string[] | verify 节点的验证命令 |
| execution | 'auto'\|'static' | static=静态回显（兼容/降本）；缺省 auto |
| exportPath | string | artifact 导出目标（工作区相对路径，防穿越） |
| body | WorkflowGraph | loop 循环体（独立完整图） |
| maxIterations | number | loop 上限，缺省 5，运行时硬上限 50 |
| breakCondition | WorkflowEdgeCondition | loop 每轮结束对循环体 state 求值，满足即退出 |
| loopVar | string | loop 注入迭代序号的键名，缺省 `__loop_index` |
| resultKey | string | loop 每轮产出键，缺省取循环体最后一个 outputKey |
| collectAll | boolean | true=聚合每轮产出；缺省 false 只返回最后一轮 |
| routeOptions | WorkflowRouteOption[] | route 允许分支值（value/label/description）；运行时只接受其一 |
| [key: string] | unknown | **开放索引签名**——config 允许未知扩展字段（生成器不应依赖此口子） |

## 5. Preflight 权威错误码（validate.mjs 对齐目标）

**13 个 error**（`WorkflowPreflightIssueCode`，protocol/src/session-workflow-binding.ts L70-83）：

| code | 触发条件 | 离线可校验？ |
|---|---|---|
| unsupported_node_kind | kind ∉ 13 种 | ✅ |
| graph_cycle | 图/循环体存在环 | ✅ |
| invalid_condition_reference | 条件边 key 无对应上游 outputKey | ✅ |
| invalid_loop_body | body 非图结构 / 节点 ID 重复（含跨层）/ 嵌套 loop | ✅ |
| workflow_not_found / workflow_disabled / workflow_not_active / workflow_run_snapshot_invalid | 运行时绑定态 | ❌（依赖 DB） |
| missing_agent / disabled_agent | agentId 指向的 Agent 不存在/停用 | ❌（依赖 DB） |
| missing_required_skill | skillIds 中技能不存在/未启用 | ❌ |
| missing_required_tool | toolIds/toolName 无效（builtin 须在白名单；platform 须已启用+已发布） | 部分（白名单可内嵌） |
| missing_required_mcp | mcpServerIds/toolServerId 的 MCP 不存在/未启用 | ❌ |

**5 个 warning**（`WorkflowPreflightWarningCode` L85-90）：provider_uses_host_fallback / optional_mcp_unavailable / workflow_archived_for_existing_binding / definition_newer_than_resumable_run / bundle_dependency_unresolved——全部为运行时态，离线不可校验。

**Issue 结构**：`{ code, nodeId?, dependencyId?, params? }`。

**能力边界结论**：离线 validate.mjs 负责**结构层**（前 4 个 error code + 自定义结构规则）；**依赖层**（后 9 个）由导入后 Spark preflight 兜底——skill 文档必须向使用者声明此边界。

## 6. 官方设计约束（源文件头注释原文，生成器必须遵守）

1. **导入通道**：graph JSON → `graphToReactFlow` → `workflow:create` IPC 落库为 draft（WorkflowView 导入对话框同通道）；
2. **绑定字段留空**：`agentId / skillIds / toolIds` 是工作区相关 ID，**写死会跨工作区失效**——生成的工作流一律留空，导入后由用户在检查器补齐（官方 13 个模板全部遵守此规则）；
3. **分支不汇合**（执行器陷阱）：route/review 的条件分支必须「互斥条件 + 各自独立终点」，**不能合并回同一节点**——executor 的 `collectWorkflowInactiveNodeIds` 用 `.some` 判定，汇合节点会因一条 inactive 入边被整体跳过；
4. **loop 不嵌套**：v1 循环体内不得再有 loop（preflight `invalid_loop_body: nested_loop`）；
5. **运行时 state 写入语义（harness 实测 + 源码双证）**：executor 将节点 content **原样写入** `state[outputKey]`（workflow-executor.ts L722），不做任何净化；官方 route 节点靠「纯 LLM 临时 worker 只输出 routeOptions 中的一个 value」强约束（workflow-run-coordinator.ts L265-275 注释）。因此 review/route 节点的 prompt **必须显式限定输出值域**；下游消费 LLM 裁决值时应按「最早出现位置」提取而非全文包含匹配（harness 实跑教训：全文匹配把 request_changes 误提为 approve，因长文本后部出现了另一候选词）；
6. **未绑定 agent 节点行为**：agent/subagent 节点无 agentId 时不会被静默剔除，而是显式失败 `missing_agent_id`（executor L617-619）；自动化试跑可用 `fallbackAgentId` 兑底。

## 7. 版本漂移监控点（每周核对，2h 预算）

| 监控项 | 文件 | 漂移信号 |
|---|---|---|
| 节点 kind 枚举 | protocol/src/ipc/index.ts `WorkflowNodeKind` | 新增/删除 kind |
| config 字段 | 同文件 `WorkflowNodeConfig` | 新增字段/语义注释变化 |
| 错误码 | protocol/src/session-workflow-binding.ts L70-90 | code 增删 |
| 官方模板 | renderer/.../workflow-templates.ts | 模板增删（现为 13 个）、约束注释变化 |
| builtin 工具白名单 | protocol `WORKFLOW_RESTRICTABLE_TOOL_NAMES`（本次未定位到定义文件，**待补**） | 白名单变化 |
| 分发通道 | workflow-bundle.ts / team-registry（Nacos AgentSpec 载体，0.11.68 新落地） | 格式版本变化 |

## 8. 待补项（诚实记录）

- [x] ~~运行时行为验证~~ —— **2026-09-14 已完成**：harness 直调真执行器 + DeepSeek 实跑 demo-code-review，双向分流实证（见 RUN_VERIFICATION.md）；
- [ ] `WORKFLOW_RESTRICTABLE_TOOL_NAMES` 白名单具体内容（grep protocol/src 未直接命中定义，下次从 `@spark/protocol` 导出链或 agent-runtime 引用处反查）；
- [ ] 13 个官方模板中其余 10 个的完整 graph（已精读 3 个：standard-dev / conditional-routing / iterative-polish-loop）；
- [ ] `workflow_run_snapshot_invalid` 的触发场景（preflight 服务内未见使用，应在 run-coordinator/binding 层）；
- [ ] pnpm install 阻塞：项目 pin 的 pnpm v11.13.0 是坏发行版（@pnpm/exe 无二进制）——待换 pnpm 版本或等上游修 packageManager pin；不阻塞 harness（Node 24 type-stripping 直跑源码）。
