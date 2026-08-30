# Spark CLI 接入为第三个对话引擎适配器实施计划

> 状态: 待开发 | 最后核对: 2026-08-30

## 1. 结论

在模型配置（渠道设置）的「API 协议格式」中新增第三种协议 **Spark 协议**（`providerType: 'spark'`）；使用该协议渠道的对话会话默认走第三个引擎适配器 **spark**，由自研 spark CLI（`spark-engine/`，包名 `@spark/agent`）执行。

承载形态采用 **进程内 SDK**（在 agent-runtime 中引入 `@spark/agent` 的编程 API），而不是 CLI 子进程：spark-engine 原生提供 `Agent.open` / `session.turn` 门面、JSONL 事件溯源流、`openSession` 会话恢复、`Approver` 审批回调与 `ModelRegistry.registerHttp` 模型路由编程注入——这四项恰好对应执行器契约的全部诉求；CLI 一次性调用（`spark --json`）无 resume、无审批回调，仅适合作为后续可选载具（对照 codex 引擎 cli / openai / app-server 三载具的先例）。

接入点复用现有引擎分派架构：`EngineRegistry` 的注释已明确「第三引擎接入 = 一个 descriptor + 一次 register」，主要工作量在①协议/类型扩展与穷尽 switch 登记、②SparkEngineExecutor 与事件映射、③渠道配置 UI、④权限审批闭环、⑤打包闭包与运行时验证。

整体风险评级 **中高**：进程内引入新依赖闭包（Electron 主进程 Node 运行时需验证）、`ProvidersView.tsx`（约 5100 行）改造、以及多处「静默回落」归一函数必须逐一登记新值。

## 2. 已确认现状

### 2.1 引擎分派架构（agent-runtime）

- 引擎契约：`packages/agent-runtime/src/sdk/engine-executor.ts:14` `EngineKind = 'claude-sdk' | 'codex'`；`:26` `EngineExecutor` 契约（每 turn 新建实例、终态只经事件流表达、实例引用即事件所有权闸门）。
- 引擎注册表：`packages/agent-runtime/src/services/session/engine-registry.ts:57` `EngineRegistry`；`:132-187` claude/codex descriptor 与 `createDefaultEngineRegistry`。
- adapter 归一：`packages/agent-runtime/src/services/session/engine-kinds.ts:21` `resolveEngineKind`（穷尽 switch，漏登记即编译错）；`:48` `getAgentAdapterFromSession(value, legacyChatMode, providerType)` 默认分支 `providerType === 'anthropic' ? 'claude-sdk' : 'codex'`；`:62` `getPermissionModeFromSession`；`:81` `normalizeAgentAdapter`（静默回落 `'claude-sdk'`）。
- session.service 接线：`packages/agent-runtime/src/services/session.service.ts:864` `engineRegistry = createDefaultEngineRegistry()`；`:2331-2340` adapter 解析；`:3943/:4595/:7571` 直接 `get('claude-sdk')` / `get('codex')` / `resolveExecutor` 三个调用点。

### 2.2 渠道（Provider）配置链路

- 真正的协议「枚举」散在三处，均需同步新增 `'spark'`：
  - `packages/protocol/src/provider-presets.ts:10` `ProviderPresetKind = 'anthropic' | 'openai'` + `VENDOR_CATALOG` + `PROVIDER_PRESETS`；
  - `apps/desktop/src/renderer/design/views/ProvidersView.tsx:120` `ProviderKind`、`:3849-3876` 「API 协议格式」下拉、`:5113` `normalizeProviderKind()`（非 anthropic 一律归 openai，**静默回落**）；
  - `packages/agent-runtime/src/services/provider.service.ts:67` `TextProviderKind` 白名单、`:1680` `normalizeProviderType()`（不在集合内回落 `'openai'`，**静默回落**）。
- 二级协议先例：openai 渠道下有 `codexApiKind`（chat/responses/embedding）二级选择，见 `ProvidersView.tsx:3969` 与 `apps/desktop/src/renderer/design/views/provider/ProviderConversationProtocolFields.tsx`。Spark 协议的「上游 API 格式」子选择照此办理。
- IPC schema：`packages/protocol/src/ipc/index.ts:157` `SessionAgentAdapter = 'claude' | 'claude-sdk' | 'codex'`；`packages/protocol/src/schemas/index.ts:86` zod 枚举；`ipc/index.ts:979` `ProviderUpdateRequest.provider?: 'anthropic' | 'openai'` 硬编码联合需扩。
- 凭据：keystore ref 由 `providerType + profileId` 拼接（自由字符串），新增 `'spark'` **无需改动** vault 机制（`packages/shared/src/keystore/index.ts:45`）。
- DB：`provider_profiles.provider_type` 为自由 TEXT，`config_json` 自由承载扩展字段，**无需迁移**。

### 2.3 spark-engine（`@spark/agent` v0.4.0）

- SDK 门面：`spark-engine/src/sdk/agent.ts` —— `Agent.open({cwd, dataRoot?, env?, llm?})` → `agent.newSession(config)` / `agent.openSession(sessionId)`（重放事件账本 + 崩溃恢复）→ `session.turn(input, {signal, onEvent, onDelta})` → `Promise<TurnResult>`；`session.setPermissionMode(mode)` 支持热切换。
- 事件：`spark-engine/src/events/schema.ts:213-233` 19 种 zod 事件（session.started / turn.queued|started|completed|cancelled|failed / step.started / assistant.completed / tool.intent|call|result / permission.requested|evaluated|decided / context.compacted / log.rewind / plugin.\* / user.answered），统一信封 `{schemaVersion, sessionId, seq, ts}`，JSONL 事件溯源落盘。
- 模型路由：`spark-engine/src/llm/registry.ts:47` `ModelRegistry.registerHttp({id, protocol: 'anthropic-messages' | 'openai-responses', model, apiKey, baseUrl, capabilities, fetch})` → `createRoute` → `Agent.open({llm})`，完全绕过 config.toml。**只支持两种上游 wire 协议**。
- 权限：`spark-engine/src/permission/types.ts:4` 模式 `'default' | 'acceptEdits' | 'plan' | 'bypass'`；`seams.ts:79` `Approver.ask(request, signal) → {decision:'allow', grantScope?}`；**默认 FakeApprover 全 deny，宿主必须注入真实 Approver**。
- 环境与配置：默认数据根 `~/.spark`（`SPARK_HOME` / `dataRoot` 可覆盖）；TOML 配置可整体绕过（编程注入优先）。
- 依赖：runtime 依赖 ajv / fast-glob / ignore / smol-toml / zod，**ink + react 仅为 TUI 导出所需**；engines `node >=22.14 <23`（与根 workspace pin 一致）。

### 2.4 已存在的反向桥（重要前提）

`apps/desktop/src/main/services/SparkCliBridgeService.ts` 已实现「桌面端 → spark CLI」的渠道共享：桌面端在 `~/.spark/hosts/sparkwork/` 写 bridge 描述文件并提供 `/v1/catalog` + `/v1/proxy/*`，spark CLI 侧 `discoverSparkWorkHost` 发现后经本地代理复用桌面渠道。本计划的「Spark 协议渠道」是**反方向**（spark 引擎在应用内执行），进程内直接 `registerHttp` 注入即可，不走本地自代理（避免循环链路）；bridge 逻辑不受影响，但两者共享 `~/.spark` 数据根（见 D4）。

## 3. 设计决策

### D1 承载形态：进程内 SDK（推荐），CLI 子进程留作后续载具

- SDK 路径同时满足：resume（`openSession`）、审批回调（`Approver` → 应用权限链路）、模型注入（`registerHttp`）、事件直采（19 种事件 + `onDelta` 流式）。
- CLI 子进程（`spark -p --json`）缺失 resume 与审批回调，且每 turn 冷启动，仅保留为降级/独立发布形态的后续选项，本期不做。

### D2 依赖引入：spark-engine 纳入 pnpm workspace

- `pnpm-workspace.yaml` 的 `packages` 增加 `'spark-engine'`，agent-runtime 声明 `@spark/agent` 依赖（`workspace:*`）；其 npm `package-lock.json` 移除，脚本保持不变（tsup/vitest 与包管理器无耦合）。
- 根 workspace engines 已 pin `>=22.14 <23`，与 spark-engine 一致，无需放宽；**但 Electron 43 主进程内置 Node 版本需在 M0 实测验证**（spark-engine 若用了 Node 23+ 才有的 API 会在此暴露）。
- 依赖卫生：`ink`/`react` 仅 TUI 需要。SDK 入口 `dist/index.js` 不引 TUI（tui 是独立子路径导出），但 `dependencies` 声明仍会被 electron-builder 生产闭包收集。M0 评估：把 ink/react 移为 spark-engine 的 devDependencies + TUI 单独构建入口，或接受体积成本。

### D3 「Spark 协议」渠道语义

- `providerType: 'spark'` 的渠道仍然是「上游 LLM 渠道」：配置 `apiEndpoint` + `apiKey` + 模型清单，另增 `config_json.sparkUpstreamProtocol: 'anthropic-messages' | 'openai-responses'`（UI 上参照 `codexApiKind` 做二级「上游 API 格式」选择，spark 引擎只认这两种 wire 协议）。
- 渠道的模型拉取 / 测试连接按 `sparkUpstreamProtocol` 分派复用现有实现（openai 走 `/v1/models` + chat ping；anthropic 走 messages ping）。
- 会话默认适配器：`getAgentAdapterFromSession` 默认分支改为 `providerType === 'spark' ? 'spark' : (providerType === 'anthropic' ? 'claude-sdk' : 'codex')`；用户仍可在会话/助手级显式切换适配器。

### D4 数据根：与 bridge 共用 `~/.spark`

- `SparkEngineExecutor` 默认 `dataRoot = ~/.spark`（与 `SparkCliBridgeService` 的 SPARK_HOME 口径一致），应用内 spark 会话的事件账本可被终端里的 spark CLI 直接查看/续跑，形成跨端一致性；构造参数保留注入以便测试与未来隔离策略。

### D5 权限模式与审批

- `SessionPermissionMode`（protocol）新增 `'spark-default' | 'spark-accept-edits' | 'spark-plan' | 'spark-bypass'`，与应用现有 claude-_ / codex-_ 命名风格对齐；`engine-kinds.ts` 的 `getPermissionModeFromSession` / `normalizePermissionMode` 登记（查表式，无前缀嗅探，直接加值）。
- 执行器内实现 spark `Approver`：`permission.requested` 事件 + `ask()` 回调映射到应用现有权限请求链路（对照 claude `canUseTool` 的发出-应答路径），`grantScope: 'once' | 'session'` 映射应用侧记住选择语义；`setPermissionMode` 实现热切换（`isPermissionModeAware` 能力位自动生效）。

### D6 会话续跑

- 每 turn 新建 executor 实例（契约）→ `Agent.open({cwd, llm})` → 首轮 `newSession({permissionMode})`，续轮 `openSession(sdkSessionId)`。
- spark 内部 sessionId 经现有 resume gate 的 sdkSessionId 持久化机制存储（与 claude executor 同路径，`resumeGate.makeRuntimeSessionId` 已按 `agentAdapter` 参数化，无需改动）。

## 4. 改动分层清单

### L1 protocol 包

| 文件                                           | 改动                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/protocol/src/ipc/index.ts:157`       | `SessionAgentAdapter` 增加 `'spark'`                                         |
| `packages/protocol/src/schemas/index.ts:86`    | zod 枚举同步；`ProviderUpdateRequest.provider` 联合（ipc:979）扩 `'spark'`   |
| `packages/protocol/src/provider-presets.ts:10` | `ProviderPresetKind` 扩 `'spark'`，新增 Spark 预设模板与 VENDOR_CATALOG 条目 |
| SessionPermissionMode 定义处                   | 新增 4 个 `spark-*` 模式值                                                   |

### L2 agent-runtime（核心）

| 文件                                       | 改动                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sdk/engine-executor.ts:14`            | `EngineKind` 扩 `'spark'`（注意 `TurnPromptSnapshotEvent.adapterKind` 持久化值域随之扩展，精确匹配兼容）                                                                                       |
| `src/sdk/spark-engine/`（新增目录）        | `SparkEngineExecutor`（EngineExecutor 实现）、`event-mapper.ts`（spark 事件 → protocol AgentEvent）、`approver.ts`（Approver 桥接）、`model-route.ts`（渠道配置 → `registerHttp` 参数）        |
| `src/sdk/types.ts:685`                     | `SDKExecutorConfig` 增加 spark 字段：`sparkUpstreamProtocol`（+ dataRoot 覆盖等）                                                                                                              |
| `src/services/session/engine-kinds.ts`     | 4 个归一函数登记 `'spark'`（穷尽 switch 强制编译期不漏）                                                                                                                                       |
| `src/services/session/engine-registry.ts`  | `sparkEngineDescriptor`：capabilities `{nativeResume: true, permissionHotSwitch: true, checkpointRewind: false, subagentTool: false}`；`checkAvailability` 做进程内 SDK 可加载性探测           |
| `src/services/session.service.ts`          | spark 渠道配置组装分支（apiKey/apiEndpoint/model/上游协议/权限模式）；usage 落库接 spark usage delta；`supportsOpenAIFastMode`、resume gate、model-router 等 providerType/adapter 分支逐一排查 |
| `src/services/provider.service.ts:67/1680` | `TextProviderKind` 白名单与 `normalizeProviderType` 登记 `'spark'`；`getDefaultEndpointBase` 增加 spark 默认端点                                                                               |

### L3 桌面端 main

| 文件                                 | 改动                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/ipc/index.ts` | provider create/update 对 `'spark'` 的校验放行；test-connection / fetch-models 按上游协议分派（大概率零改动，验证即可） |

### L4 渲染端

| 文件                                                                                                                          | 改动                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProvidersView.tsx`                                                                                                           | `ProviderKind` 扩 `'spark'`；「API 协议格式」下拉加「Spark 协议」；上游 API 格式二级选择；endpoint 预览、payload 组装、编辑回填、`normalizeProviderKind` |
| `provider/providerConversationProtocol.ts` 等                                                                                 | Spark 渠道二级协议组件（新文件，避免撑大主文件；ProvidersView 已超 3000 行门禁，**新增逻辑一律拆独立模块**）                                             |
| 会话/助手适配器入口（`ChatTabbar.tsx`、`ComposerV2.tsx`、`AgentsView.tsx`、`TeamInspectorSection.tsx`、`OnboardingView.tsx`） | 适配器枚举注册 `'spark'`（以现有 claude/codex 枚举收口点为准逐一登记）                                                                                   |
| i18n                                                                                                                          | `pnpm i18n:scan` 补文案                                                                                                                                  |

### L5 打包与运行时

- electron-builder 生产闭包需完整收集 `@spark/agent` 传递依赖（hoisted 布局已具备条件，按 `apps/desktop/package.json` 的 `//deps-note` 口径核实 out/main bundle）。
- 可用性探测接入 `SdkIntegrityService` 同等级的启动检查（spark SDK import 失败时渠道标记不可用并给出明确 reason）。

## 5. 事件映射（SparkEngineExecutor event-mapper）

统一信封携带 `seq/ts`；终态契约：`turn.completed/cancelled/failed` 必须映射为应用侧终态事件（cancel 语义：`cancel()` 返回后事件流最终出现 cancelled 终态）。首次实现以 codex `event-mapper` / claude 执行器的事件形态为基准校准字段级映射，下表为目标草案：

| spark 事件 / delta                              | 应用侧 AgentEvent（protocol/events）                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `turn.queued` / `turn.started` / `step.started` | `AgentStatusEvent`（queued/running 阶段位）                                                       |
| `assistant.completed`                           | `AssistantMessageEvent`（完整消息）                                                               |
| `onDelta.text` / `onDelta.thinking`             | 流式 assistant 增量 / `AgentThinkingEvent`（形态对齐 claude executor 现有流式表达）               |
| `onDelta.tool_call`                             | 工具调用流式增量                                                                                  |
| `onDelta.usage`                                 | `UsageUpdateEvent`（接入 session-usage-ledger 计费口径）                                          |
| `tool.intent`                                   | `AgentThinkingEvent`（意图提示；若应用侧有 pending 语义则映射 ToolCallEvent pending，实现期校准） |
| `tool.call` / `tool.result`                     | `ToolCallEvent` / `ToolResultEvent`                                                               |
| `permission.requested` → `Approver.ask`         | `PermissionRequestEvent`                                                                          |
| `permission.decided`                            | `PermissionResponseEvent`（`permission.evaluated` 内部消化）                                      |
| `context.compacted`                             | `ContextCompactionEvent`                                                                          |
| `log.rewind`                                    | `SessionHistoryResetEvent`                                                                        |
| `plugin.activated/deactivated`                  | `AgentStatusEvent`（或首版忽略）                                                                  |
| `user.answered`                                 | 内部回显处理                                                                                      |
| `turn.completed`                                | 终态：状态事件 + turn 完成                                                                        |
| `turn.cancelled`                                | 终态：cancelled                                                                                   |
| `turn.failed`                                   | `AgentErrorEvent` + 终态 failed                                                                   |
| `session.started`                               | executor 内部消费（记录 spark sessionId 供 resume gate 持久化）                                   |

## 6. 分阶段实施

### M0 预备与可行性验证（约 0.5~1 天）

1. spark-engine 纳入 pnpm workspace，agent-runtime 声明依赖，删除 npm lockfile，`pnpm install` 通过。
2. Electron 主进程 Node 运行时冒烟：import `@spark/agent` + fake LLM（`llm/fake`）跑通一个 turn。
3. 决策 ink/react 依赖卫生方案；核实 electron-builder 闭包收集。
4. 验收：桌面 dev 启动后主进程内可执行 fake 模型 turn 且事件可打印。

### M1 协议与类型层（约 0.5 天）

1. L1 全部类型/枚举/预设改动 + engine-kinds / engine-registry 登记（descriptor 先挂占位执行器）。
2. 验收：`pnpm typecheck` 全仓通过（穷尽 switch 编译期证明无遗漏归一点）；`rg` 复核三处静默回落（normalizeProviderType / normalizeAgentAdapter / normalizeProviderKind）均已登记。

### M2 SparkEngineExecutor MVP（约 2~3 天）

1. 新增 `src/sdk/spark-engine/` 四模块；session.service spark 配置组装分支；单轮会话端到端打通（权限暂用 bypass）。
2. 事件映射 golden 测试（spark 事件样本 → 期望 protocol 事件序列）；取消语义测试（cancel → cancelled 终态）。
3. 验收：真实渠道（anthropic-messages 与 openai-responses 上游各一）完成单轮对话，流式文本/工具调用/用量在 UI 正常呈现。

### M3 权限与审批闭环（约 1~2 天）

1. Approver 桥接现有权限请求链路；4 个 spark 权限模式生效；`setPermissionMode` 热切换。
2. 验收：default 模式下文件写入触发应用权限弹窗，允许/拒绝/会话内记住均生效；模式热切换立即作用于下一工具调用。

### M4 模型配置 UI（约 2~3 天）

1. ProvidersView Spark 协议渠道（表单/上游格式/端点预览/回填/payload）；模型拉取与测试连接；预设模板；会话与助手级适配器入口注册。
2. 验收：以 Spark 协议新建渠道 → 拉取模型 → 设为默认 → 发起会话全流程无人工改库；旧渠道（anthropic/openai）回归不受影响。

### M5 会话续跑与用量（约 1~2 天）

1. resume gate 持久化 spark sessionId；重启/续轮走 `openSession`；usage delta 接入 ledger；team/mention 路径（session.service:7571 `resolveExecutor`）回归。
2. 验收：应用重启后 spark 会话可继续上下文；用量统计与成本口径正确。

### M6 打包、文档与收尾（约 1~2 天）

1. mac/win 打包产物内 spark 引擎可用性验证；`spark-engine` README/主 README 状态更新；本计划状态改「已落地」。
2. 按记忆文档惯例沉淀接入经验（`.agents/memory/`）；`gitnexus_detect_changes` 核对变更面（不可用则 rg + git diff 代替并注明）。

## 7. 测试计划

- 单测：event-mapper golden 样本、approver 决策映射、model-route 组装、engine-kinds 归一穷举（spark 各权限模式）、session.service spark 配置组装分支。
- 集成：fake LLM 全事件类型端到端（含 cancel / failed 终态）；resume gate 续跑。
- 渲染端：ProvidersView spark 渠道表单校验与回填用例（vitest，monaco stub 同口径）。
- 手工矩阵：上游协议 × 权限模式 × 首轮/续轮 × 应用重启，双平台打包冒烟。

## 8. 风险与开放问题

| #   | 风险/问题                                                                                    | 应对                                                                        |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Electron 43 主进程 Node 与 spark-engine engines（`<23`）的运行时差异                         | M0 冒烟；不匹配则评估 API shim 或改用 CLI 载具                              |
| 2   | ink/react 进入生产闭包（体积/版本与渲染端 react 冲突）                                       | M0 决策：spark-engine 依赖拆分或接受成本                                    |
| 3   | spark-engine 为 npm 管理目录，纳入 pnpm workspace 后双 lockfile 口径                         | 纳入 workspace 并移除 package-lock.json；上游同步策略在 README 注明         |
| 4   | `ProvidersView.tsx` 已超 3000 行门禁                                                         | Spark 渠道逻辑全部拆独立组件/工具文件，主文件只加 import 与分支点           |
| 5   | 静默回落函数漏登记导致 spark 被吞成 openai/codex                                             | M1 用 rg 清单逐点核对 + 穷尽 switch 编译期约束                              |
| 6   | `~/.spark` 共享数据根下双端并发写各自 sessionId，理论无冲突，但 bridge GC/描述文件升级需回归 | M5/M6 各加一条回归项                                                        |
| 7   | spark 引擎能力面小于 claude（无 checkpoint rewind / 原生 subagent）                          | capabilities 如实声明 false；UI 不暴露对应入口                              |
| 8   | 开放问题：Spark 协议渠道是否参与 Auto Router / 峰谷禁用 / fast mode 等渠道级特性             | 默认按普通渠道参与，M2 排查 `supportsOpenAIFastMode` 等分支后按产品确认收敛 |

## 9. 说明

- 本计划为规划产出，未改动任何符号，未执行 GitNexus impact / detect_changes；实施阶段每改一个符号前按 AGENTS.md 跑 `gitnexus_impact`，HIGH/CRITICAL 先预警再动手（GitNexus MCP 不可用时按降级规则以 rg 调用点检索 + `git diff` 代替并在交付说明注明）。
- 工作树当前存在并行改动，实施时创建隔离 worktree/分支，不与现有未提交改动混合。
