# Spark L3 工作流节点规格全集（Node Spec）

> 适配版本：spark-agent 0.11.68｜本文件供 AI Coding Agent 生成 WorkflowGraph JSON 时作为权威规格。
> 通用约定见 §0，13 种节点逐个规格见 §1-§13，校验规则速查见 §14。

## 0. 通用生成规则

### 0.1 节点通用结构
每个节点必含 6 字段：`id`（图内唯一，kebab-case，建议 `<kind>-<n>` 如 `agent-1`）、`kind`（13 种之一）、`title`（中文显示名）、`x`/`y`（画布坐标，number）、`config`（对象）。

### 0.2 坐标布局约定（对齐官方模板）
- 横向流：主链节点 x 间隔 260-280，y 相同（如 160）；
- 分支：各支线 y 错开（如 60 / 320），x 继续递增；
- loop body 内部坐标独立小图（x 从 80 起，间隔 280）。

### 0.3 outputKey 与数据流
- 每个产出型节点必须设 `config.outputKey`（驼峰命名，如 `objective`/`plan`/`implementation`）；节点产出写入工作流 state 的该键；
- 下游通过两种方式消费：①边条件 `condition.key` 引用；②`toolArgs` 字符串值 `{{key}}` 插值；
- 同一图内 outputKey 建议不重复（loop body 内外也避免冲突）。

### 0.4 绑定字段铁律
`agentId / skillIds / toolIds / mcpServerIds / ruleIds / modelId / providerProfileId / toolServerId` 均为**目标环境相关 ID**——生成时一律**留空/省略**（官方 13 模板全部如此），在节点的 `prompt` 或工作流 `description` 里用自然语言注明「需绑定：××」。写死 ID 会跨环境失效并触发 preflight missing_* 错误。

### 0.5 分支铁律（执行器陷阱）
route/review 条件分支必须「互斥条件 + 各自独立终点链」，**分支不得汇合回同一节点**——executor 会把有 inactive 入边的汇合节点整体跳过。每条分支以自己的 artifact（或终点节点）收尾。

### 0.6 边结构
`id`（唯一，建议 `e-<from>-<to>`）、`from`、`to`、可选 `condition`：`{op: exists|equals|not_equals|truthy|falsy, key, value?}`（value 仅 equals/not_equals 需要）。无 condition = 无条件流转。

---

## 1. input —— 需求入口

**定位**：工作流起点，解析用户需求为结构化目标。每张图**应当且仅有一个** input 作为主入口。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 解析指令（提炼目标/约束/交付物） |
| outputKey | 建议 | 惯例 `objective` |
| retryCount | 可选 | 重试次数 |
| execution | 可选 | `'static'` = 原样透传用户输入（不走 LLM，降本）；缺省 `'auto'` |

```json
{ "id": "input-1", "kind": "input", "title": "需求输入", "x": 80, "y": 160,
  "config": { "prompt": "解析用户需求，提炼目标、约束和交付物，作为后续节点的输入。", "outputKey": "objective", "retryCount": 1 } }
```

## 2. plan —— 计划拆解

**定位**：把目标拆解为可执行步骤，供下游执行或审批。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 拆解指令 |
| outputKey | 建议 | 惯例 `plan` |

## 3. route —— 条件路由

**定位**：LLM 从 `routeOptions` 中**选且仅选一个** value 输出；下游边用 `condition: {op:'equals', key:<route的outputKey>, value:<option.value>}` 分流。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 判断指令（写清各分支的判定标准） |
| outputKey | 建议 | 惯例 `route` |
| **routeOptions** | **必填** | `[{value, label?, description?}]`；运行时只接受其中一个 value；每条出边应对应一个 option |

```json
{ "id": "route-1", "kind": "route", "title": "决策路由", "x": 360, "y": 160,
  "config": { "prompt": "判断任务复杂度，选择 deep 或 quick。", "outputKey": "route",
    "routeOptions": [
      { "value": "deep", "label": "深度处理", "description": "需要完整实现或多步骤处理" },
      { "value": "quick", "label": "快速处理", "description": "只需要摘要、答复或轻量处理" } ] } }
```
**出边示例**：`{ "id": "e-route-agent", "from": "route-1", "to": "agent-1", "condition": { "op": "equals", "key": "route", "value": "deep" } }`
**常见错误**：①分支汇合（违反 §0.5）；②出边 condition.value 不在 routeOptions 内；③缺 routeOptions。

## 4. agent —— 主执行

**定位**：绑定 Agent 完成实际工作（写代码/产内容），最常用的执行节点。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 执行指令 |
| outputKey | 建议 | 如 `implementation` |
| agentId | 留空 | 见 §0.4；导入后在检查器绑定 |
| modelId / providerProfileId | 留空 | 同上 |
| skillIds / toolIds / mcpServerIds / ruleIds | 留空 | 同上 |
| parallelism | 可选 | 并行度 |
| retryCount | 可选 | |

## 5. subagent —— 子代理执行

**定位**：派生子代理执行隔离任务。config 语义同 agent。用于需要独立上下文/并行探索的场景（官方模板 `host-dispatch-parallel`、`team-collaboration` 有示例）。

## 6. skill —— 技能调用

**定位**：调用指定 Skill 完成任务。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 调用意图 |
| skillIds | 留空 | 导入后绑定（§0.4） |
| outputKey | 建议 | |

## 7. tool —— 工具调用（四种模式）

**定位**：调用工具。**toolSource 决定模式**：

| toolSource | 语义 | 必填 config |
|---|---|---|
| `'mcp'` | 直调指定 MCP 服务器上的工具（不经 LLM） | toolServerId(留空待绑) + toolName + toolArgs? |
| `'builtin'` | 锁定单个 SDK 内置工具 + 预渲染参数强约束派发 | toolName（须在 WORKFLOW_RESTRICTABLE_TOOL_NAMES 白名单） |
| `'platform'` | 直调平台自定义工具/工具包工具（不经 LLM） | toolName（工具包格式 `packageId/toolName`） |
| null/缺省 | 旧模式：toolIds 白名单 + LLM 自主决定调用 | toolIds(留空) |

`toolArgs`：结构化参数对象；**字符串值支持 `{{key}}` 插值**（key = 上游 outputKey / state 键）。

```json
{ "id": "tool-1", "kind": "tool", "title": "调用搜索工具", "x": 640, "y": 160,
  "config": { "toolSource": "mcp", "toolName": "web_search", "toolArgs": { "query": "{{objective}}" }, "outputKey": "search_result" } }
```
**常见错误**：toolSource='mcp' 缺 toolName → preflight `missing_required_tool`。

## 8. mcp —— MCP 直调节点

**定位**：与 tool(toolSource='mcp') 语义一致的专用节点——直接调用 MCP 服务器工具，不经 LLM。config：toolServerId（留空待绑）+ toolName + toolArgs + outputKey。官方模板 `mcp-integration` 有完整示例。

## 9. approval —— 人工审批门禁

**定位**：暂停等待人工批准。**拒绝 = 整个工作流失败终止**（官方模板注释原文）；批准可附修改意见流向下游。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 审批说明（写清批准/拒绝的后果） |
| outputKey | 建议 | 惯例 `approval` |

**使用时机**：高风险操作（写文件/发消息/花钱）之前。生成含 agent 改码的多步流时建议在 plan 后插入。

## 10. verify —— 验证

**定位**：运行验证命令确认上游产出正确。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | |
| **verifyCommands** | 建议 | 字符串数组，如 `["pnpm typecheck", "pnpm test:unit"]`；官方模板占位用 `["echo ok"]` |
| outputKey | 建议 | 惯例 `verification` |

## 11. review —— 评审/裁决

**定位**：评审产出并输出裁决（常用 `pass`/`retry` 二值，供 loop.breakCondition 或条件边消费）。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | **要求严格限定输出值域**（官方示例：「严格只输出 'pass' 或 'retry'」） |
| outputKey | 建议 | 惯例 `verdict` / `summary` |

## 12. artifact —— 交付产物

**定位**：整理最终交付物；可写入工作区文件。

| config | 必填 | 说明 |
|---|---|---|
| prompt | 建议 | 整理指令 |
| outputKey | 建议 | 惯例 `deliverable` |
| exportPath | 可选 | 工作区相对路径（**防穿越：不得含 `..`、不得绝对路径**，须在绑定工作区内） |

**惯例**：每条分支链、每张图以 artifact 收尾（官方模板全部如此）。

## 13. loop —— 循环

**定位**：重复执行 `body` 子图直到 breakCondition 满足或达到 maxIterations。**v1 不支持嵌套 loop**（body 内不得再有 loop 节点）。

| config | 必填 | 说明 |
|---|---|---|
| **body** | **必填** | 完整 WorkflowGraph（独立 nodes/edges；节点 ID 不得与外层图冲突） |
| maxIterations | 可选 | 缺省 5，**运行时硬上限 50** |
| breakCondition | 可选 | 边条件结构；每轮结束对循环体 state 求值，满足即退出 |
| loopVar | 可选 | 迭代序号注入键，缺省 `__loop_index` |
| resultKey | 可选 | 每轮产出键；缺省取循环体最后一个 outputKey |
| collectAll | 可选 | true=聚合每轮产出数组；缺省 false 只返回最后一轮 |
| prompt / outputKey | 建议 | 惯例 outputKey=`final_draft` 等 |

```json
{ "id": "loop-1", "kind": "loop", "title": "迭代润色", "x": 360, "y": 160,
  "config": { "prompt": "重复执行循环体，直到评审通过或达到最大迭代次数。", "outputKey": "final_draft",
    "maxIterations": 5, "loopVar": "__loop_index", "resultKey": "draft", "collectAll": false,
    "breakCondition": { "op": "equals", "key": "verdict", "value": "pass" },
    "body": { "nodes": [ /* 子图节点，如 review 产出 draft + review 裁决 verdict */ ], "edges": [ /* 子图边 */ ] } } }
```
**常见错误**：①body 缺失或非 {nodes,edges} 结构 → `invalid_loop_body`；②body 内节点 ID 与外层重复 → `invalid_loop_body(duplicate_node_id)`；③body 内嵌 loop → `invalid_loop_body(nested_loop)`；④breakCondition.key 在 body 内无对应 outputKey。

---

## 14. 校验规则速查（validate.mjs 三层对齐）

**Layer 1 格式**：JSON 可解析；顶层含 nodes/edges 数组；每节点含 id/kind/title/x/y/config 六字段；kind ∈ 13 枚举（否则 `unsupported_node_kind`）；x/y 为有限数字；id 图内唯一。

**Layer 2 连接**：边 from/to 指向存在节点；边 id 唯一；无自环；无环（`graph_cycle`，含 loop body 内）；条件边 condition 结构合法（op ∈ 5；equals/not_equals 必带 value）；condition.key 能匹配到某节点 outputKey（`invalid_condition_reference`）；所有节点从 input 可达；非终点节点有出边。

**Layer 3 逻辑**：route 必带非空 routeOptions，其条件出边 value ∈ routeOptions；**分支汇合检测**（违反 §0.5 报 error）；loop 必带合法 body、不嵌套、body ID 不与外层冲突、maxIterations ≤ 50；tool/mcp 节点 toolSource 组合完整（mcp→toolName 必填等）；artifact exportPath 无 `..`/绝对路径；**绑定字段写死检测**（agentId/skillIds/toolIds 等非空 → warning，提示违反 §0.4）；每图建议恰一个 input、至少一个 artifact 收尾（warning 级）。

**依赖层（离线不可校验，导入后由 Spark preflight 兜底）**：missing_agent / disabled_agent / missing_required_skill / missing_required_tool / missing_required_mcp / workflow_not_found / workflow_disabled / workflow_not_active / workflow_run_snapshot_invalid + 5 个运行时 warning。
