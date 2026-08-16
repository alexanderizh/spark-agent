# Codex 引擎流式输出修复：app-server 传输替换方案

> 状态: 已落地 | 最后核对: 2026-08-16

## 一、现象

codex 会话的流式输出不是逐词流畅出现，而是「一坨一片一段」：生成期间界面无任何文字，整段文字在生成完成后一次性出现；长会话（文本↔工具交替）表现为逐段跳变。claude 会话同界面逐 token 流畅，对照明显。

## 二、根因（三层证据链，全部实证）

### 证据 1 · 落库数据：codex 会话 delta 事件数量恒为 0

对 prod 库（`@spark/desktop/spark.db`）全部 30 个 codex 会话（2026-08-04 ~ 08-16，gpt-5.6-luna/sol/terra、deepseek-v4-flash、glm-5.2）统计：**`assistant_message` 且 `mode='delta'` 的事件总计 0 条**。每个 turn 只有两条 `complete`（`item.completed` 落一条 + executor 收尾补一条 `isFinal`）。

例（session d5b246d9，turn 738ca68a）：10:28:22 turn started → 生成期间无任何文字事件 → 10:28:26 整段 49 字符一次性出现。

**这不是回归——该传输路径从未流式过。** executor 里的 delta 处理代码（`dispatchRawDeltaEvent`、`computeDelta` 前缀切片）是为「上游会发增量事件」的预期写的，但实际传输从未投递过这些事件。

### 证据 2 · 传输层：`codex exec --experimental-json` 在协议层面不流式 agent 文本

codex 引擎（responses wire 载具）链路：`CodexSdkExecutor` → `@openai/codex-sdk`（0.146.0）`runStreamed()` → spawn `codex exec --experimental-json` → 逐行读 stdout JSONL。

codex-rs 0.144.5 源码 `codex-rs/exec/src/event_processor_with_jsonl_output.rs`（**main 分支行为相同，升级运行时无解**）：

- `map_started_item()` 对 `ThreadItem::AgentMessage` 返回 `None`——不发 `item.started`
- 整个通知 match 中 **`ItemUpdated` 只对 TodoList 发射**，没有 `AgentMessageDelta` / `ReasoningTextDelta` / `CommandExecutionOutputDelta` 的分支——这些通知全部落入 `_ => CodexStatus::Running` 被静默丢弃
- agent 文本只在 `item.completed` 出现一次（全文）

另：0.144.5 的 cli.rs 中 `--json` 的 alias 就是 `experimental-json`，两 flag 同一实现——`CodexCliExecutor`（useLocalConfig 路径）同样不流式。

### 证据 3 · app-server 传输有完整流式（修复的落点）

codex 内部 app-server 协议层将核心事件一一映射为 token 级通知（`codex-rs/app-server-protocol/src/protocol/event_mapping.rs`）：

| 核心事件                                             | v2 通知（已从 0.144.5 二进制字符串表确认存在）                 |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `AgentMessageContentDelta`                           | `item/agentMessage/delta`                                      |
| `ReasoningContentDelta` / `ReasoningRawContentDelta` | `item/reasoning/summaryTextDelta` / `item/reasoning/textDelta` |
| `ExecCommandOutputDelta`                             | `item/commandExecution/outputDelta`                            |
| item 生命周期                                        | `item/started` / `item/updated` / `item/completed`             |
| turn 生命周期                                        | `turn/started` / `turn/completed`                              |
| 实时用量                                             | `thread/tokenUsage/updated`                                    |

请求侧（同样已确认）：`initialize`、`thread/start`、`thread/resume`、`turn/start`、**`turn/interrupt`（优雅取消）**、**`turn/steer`**、`item/permissions/requestApproval`（交互审批）、`item/commandExecution/requestApproval`、`thread/compact/start` 等。启动命令：`codex app-server`（0.144.5 已带，experimental 标记）。**这是 codex IDE 扩展使用的传输，流式、取消、审批齐全。**

### 证据 4 · 运行时 A/B 实验（决定性，2026-08-16 实测）

用本地 mock Responses 服务器（SSE 逐 token 推流，10 个 delta × 300ms 间隔）分别驱动两种传输，同一二进制（受管 0.144.5）、同一 CODEX_HOME 配置：

| 传输                                  | 生成期间 stdout 输出                                                                                                                                               | 结果                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `codex exec --experimental-json`      | **0 个字节**（mock 确认收到完整 SSE 流），`+3907ms` 一次性输出 `item.completed` 全文                                                                               | 上游流式也被丢弃，根因坐实；同时排除「网关不流式」竞争假设 |
| `codex app-server`（NDJSON JSON-RPC） | **`item/agentMessage/delta` × 10，每 300ms 一条，与 mock 推流节奏一一对应**（+729/1041/1352/…ms），随后 `item/completed` + `tokenUsage/updated` + `turn/completed` | 修复落点实测有效，逐 token 流式可拿到                      |

实验同时确认的协议事实（Phase 1 实现直接引用）：

- **帧格式是 NDJSON**（每行一个 JSON-RPC 消息）——LSP `Content-Length` 帧被 transport 层拒绝反序列化
- 握手序列：`initialize`（params `{clientInfo:{name,version}}`）→ `thread/start`（params 含 `cwd`）→ `turn/start`
- `turn/start` 的 `input` 是**数组**：`[{type:'text', text:'…'}]`（`UserInput` oneOf，传字符串报 `-32600`）
- 协议 schema 可由二进制直接生成：`codex app-server generate-json-schema --out <dir>`（v1/v2 全量 JSON Schema，516 个定义）——类型层可机器校验，无需手抄

### 排除项（已验证）

- **renderer/IPC 链路健康**：逐事件 `webContents.send`（`typed-ipc.ts:178`），delta 免落库直发（`session-event-sequencer.ts:58-76`），ChatView 仅做 rAF 合帧（`live-agent-event-buffer.ts`），MessageBuilder 按 segmentId 累加、引擎无关。claude 会话经同管道逐 token 流畅。
- **升级运行时/SDK 无解**：main 分支的 exec JSONL 处理器行为一致；main 的 TS SDK 仍 spawn `exec --experimental-json`。
- **provider 切 chat wire 不可接受**：`CodexOpenAIExecutor` 是纯 Chat Completions 客户端（真流式），但丢失 codex 全部工具运行时（bash/文件/apply_patch/MCP）。
- **renderer 打字机特效**：只会在「长静默后的一次性全文」上做假动画，治标且加虚假延迟，否决。

## 三、修复方案：`CodexAppServerExecutor`（codex 引擎新增载具）

### 架构

```
session.service ─→ EngineRegistry(codex descriptor)
                      └─ createCodexExecutorForConfig()
                            ├─ chat wire      → CodexOpenAIExecutor（不变）
                            ├─ responses wire → CodexAppServerExecutor（新，默认）
                            │                    └─ CodexAppServerClient
                            │                         · spawn codex app-server
                            │                         · JSON-RPC over stdio（请求关联+通知分发）
                            │                         · initialize → thread/start → turn/start
                            └─ useLocalConfig → CodexCliExecutor（不变）
```

`CodexSdkExecutor` 保留为回退（app-server 握手失败时降级，兼容无 app-server 的旧运行时）。

### 事件映射（v2 通知 → AgentEvent）

| v2 通知                                                                        | AgentEvent                                  | 说明                             |
| ------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| `item/agentMessage/delta`                                                      | `assistant_message` mode=delta              | **token 级流式，本方案核心收益** |
| `item/reasoning/textDelta` / `summaryTextDelta`                                | `agent_thinking` mode=delta                 | codex 首次获得思考流             |
| `item/commandExecution/outputDelta`                                            | `terminal_output`                           | 命令输出实时流                   |
| `item/started` / `item/completed`（command/mcp/fileChange/webSearch/todoList） | `tool_call` / `tool_result` / `file_change` | 复用现有 dispatchItemEvent 逻辑  |
| `turn/started` / `turn/completed`                                              | `agent_status` / `usage_update`             |                                  |
| `thread/tokenUsage/updated`                                                    | `usage_update`                              | 实时用量                         |
| `turn/completed`（status=interrupted/failed）                                  | 终态事件                                    | 对齐现有终态语义                 |

segmentId 沿用 `codex-sdk-{turnId}-text-{N}` 约定（renderer 累加逻辑零改动）。

### 取消语义升级

现状：`cancel()` = abort signal = 杀子进程（粗暴，session 状态可能停在半途）。新载具：`turn/interrupt` 优雅中断，turn 以 interrupted 终态正常收尾后关闭进程。

### 分期

- **Phase 1（本次，约 1 周聚焦工作量）**：JSON-RPC 客户端 + AppServerExecutor（流式/工具/取消/resume）+ 回退逻辑 + 测试。
- **Phase 2（后置，按需）**：交互审批回路（`item/permissions/requestApproval` server→client 请求，取代 unattended 兜底）、`turn/steer`、`thread/compact/start`（主动压缩）、goal 原生 API。

### 测试策略

- mock app-server harness：脚本化 JSON-RPC 通知注入（对齐 W1 FakeEngineExecutor 模式），锁事件序列/顺序/终态。
- conformance 测试补 AppServerExecutor（cancel → interrupted 终态 + turn resolve）。
- 真机验收：用户在 dev 应用跑 codex 会话，确认逐 token 流式、思考流、取消、工具卡、resume。

## 四、风险与开放项（实现期核对）

1. ~~**请求体精确形状**~~：**已由运行时实验确认**（NDJSON 帧、`initialize`/`thread/start`/`turn/start` 形状、`input` 数组、schema 可由 `generate-json-schema` 机器生成，见证据 4）。
2. **审批语义必须显式钉死**（实验后新增，最重要的 gotcha）：app-server 模式下审批请求是 **server→client 请求**（`item/permissions/requestApproval` 等），若不响应会挂起 turn。而现状 exec 路径是 unattended（自动拒绝/按 sandbox 策略走）。Phase 1 必须在 `thread/start`/`turn/start` 显式传 `approvalPolicy`（对齐现有 unattended 语义），并对所有 `*requestApproval` 请求返回确定性响应（accept/deny 按现有权限模式映射），杜绝挂起。**Phase 1 不做交互审批 UI，但必须做防挂起兜底。**
3. **MCP 服务器配置传递**：app-server 模式下 MCP 配置走 initialize 参数还是 config 覆盖，需核对；现 exec 路径走 `--config mcp_servers=...`。
4. **experimental 标记**：`codex app-server` 在 0.144.5 标记 experimental，接口可能随版本变；版本钉死策略与现有 codex 运行时管理一致（`SPARK_CODEX_SDK_VERSION` 校验已存在）。
5. **回退开关**：握手失败/超时自动降级 `CodexSdkExecutor` 并上报遥测，保证不比现状差。
6. **进程生命周期差异**：exec 是「每 turn 一进程」，app-server 是「长驻服务进程」——需要崩溃检测、重启、空闲回收策略。Phase 1 采用最保守形态：每 executor 实例独占一个 app-server 进程（对齐现有每实例进程模型），不做跨会话共享。

## 五、证据存档

- 根因统计脚本与查询：见本文档第二节（prod 库只读查询）
- codex-rs 源码：`event_processor_with_jsonl_output.rs`（0.144.5 与 main 对照）、`event_mapping.rs`、`cli.rs`
- 二进制方法名探测：0.144.5 win32-x64 codex.exe 字符串表
- **运行时 A/B 实验**（证据 4）：mock Responses SSE 服务器 + 时间戳 runner，`%TEMP%/codex-stream-test/`（mock-server.js / runner.js / as-probe.js，可复现）

## 六、落地记录（2026-08-16，Phase 1 + Phase 2 全部完成）

### 交付物

- `packages/agent-runtime/src/sdk/codex-app-server/`：协议类型子集（app-server-protocol.ts，
  带再生成指引）、NDJSON JSON-RPC 客户端（codex-app-server-client.ts，跨平台：无 shell spawn、
  CRLF/BOM 防御、进程树终止对齐 CodexCliExecutor）、执行器（codex-app-server-executor.ts）。
- 载具选择：`createCodexExecutorForConfig` responses 分支默认 AppServer 载具；
  `CodexSdkExecutor` 降级为回退兜底（握手失败/图片附件自动回退，事件 raw bridge 转发）。
- 跨平台：受管二进制解析复用 `resolveBundledCodexCli`（win32 `codex.exe` / 其余 `codex`）；
  测试经 `executablePath`/`args` 注入点用 node 替身，Windows 实测通过。

### 验证

- 替身测试 25 用例全绿（流式/segmentId 约定/工具生命周期/思考流/mcp+fileChange+webSearch/
  interrupt 取消/resume 静默回退/审批 accept·deny·scope·异常·unattended·取消竞态/
  steer·compact·守卫/载具回退/图片回退/崩溃/failed 语义/实时用量）。
- **真实二进制冒烟**（`SPARK_CODEX_APPSERVER_SMOKE=1` 门控，随仓库保留为运行时升级验收工具）：
  0.144.5 端到端通过，delta ≥8 条且时间跨度 ≥1.5s（真流式证明）。
- 行为锁 105/105（baseline/lifecycle/session.service/goal-queue），runtime-config 既存
  失败基线不变；Electron ABI 全程恢复（native-verify 三模块通过）。

### Phase 2 决策记录（诚实边界）

- **交互审批回路（已接线）**：命令/文件变更类审批经 `config.approvalCallback` 走用户审批卡
  （session.service codexConfig 已接 `onApproval`）；`SDKApprovalResult` 映射
  accept/acceptForSession/deny。取消经 AbortSignal 释放回调（含「abort 先于回调调用」的
  已中止预检）。权限画像（item/permissions/requestApproval）与问卷类保持确定性兜底。
- **turn/steer 与 thread/compact/start（载具级能力，未接线会话层）**：已实现
  `SteerCapableExecutor`/`CompactCapableExecutor` 能力接口 + 守卫 + 执行器方法与测试；
  **未接入 session.service**——排队语义 vs 注入运行中 turn、跨引擎主动压缩策略属产品决策
  （claude/codex 行为一致性），超出本次流式修复的爆炸半径，列为后续独立工作项。
- goal 原生 API（thread/goal/set）：未采用——Spark 的 codex-native goal 语义
  （/goal 文本 + fenced 状态块解析）已在 W2-D3 统一，换原生 API 属语义迁移，非传输问题。

### 遗留观察项

- app-server 为 experimental 接口：版本钉死策略与现有一致（SPARK_CODEX_SDK_VERSION 校验），
  升级运行时后跑真实冒烟 + `codex app-server generate-json-schema` 核对协议类型子集。
- 每 turn 一个 app-server 进程（保守形态）：冷启动 ~200-400ms 已被 prepare 前置于事件
  发射吸收；跨 turn 进程复用属后续优化（需与会话生命周期对齐，暂不做）。
