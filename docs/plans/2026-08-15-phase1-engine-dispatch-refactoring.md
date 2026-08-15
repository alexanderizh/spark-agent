# Phase 1 实施计划：引擎分派接口化 + session.service 拆分

> 状态: 实施中（W1 全部落地，W2 待启动） | 最后核对: 2026-08-16

母方案：`docs/plans/2026-08-15-engineering-upgrade-roadmap.md` §5 Phase 1。
本计划基于 2026-08-15 三路行号级调研（executor 层 / session.service 结构地图 / 测试基建），所有行号为当日实测。

---

## 0. 定位与前置依赖

**目标一句话**：把「加一个引擎 = 在 11,685 行文件里改十几处分叉 + 复制 600 行对称分支」变成「实现 1 个接口 + 注册 1 个 descriptor」，同时把 session.service.ts 拆成 ≤2,000 行 façade。

**P0 前置状态（2026-08-15 实测）**：

| 前置项                | 现状                                                                                                                                            | 对 P1 的意义                                                      | 硬/软                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| P0.2 红基线清零       | **未做**。desktop typecheck 实测 27 错（5 个 ipc 文件 + editorMenuActions + chat 测试）；protocol lint 3 errors（media-config.ts L326/328/330） | 「拆完 typecheck 绿」的信号基础。不清则拆分期间无法分辨新错与旧错 | **硬**：W1 动工前必须完成            |
| P0.3 文件尺寸 ratchet | **未做**（scripts/check-file-size.mjs 不存在）                                                                                                  | 拆分期间防回潮；拆完收紧 session.service 阈值                     | 硬：W3 前上线即可                    |
| P0.1 PR CI            | **未做**（仅 2 条发布流水线）                                                                                                                   | 每个小步合并的机器验证                                            | 软：未上线期间以本地全量验证纪律替代 |
| P0.6 worktree 清理    | **未做**（4.6GB 副本仍在）                                                                                                                      | 消除调研/搜索噪音，减少误改副本风险                               | 软                                   |

注：agent-runtime / protocol / storage 的 typecheck 当前是**绿的**（实测 exit 0），P1 主战场验证信号可用；desktop 侧 27 错集中在 5 个文件，修复成本低，随 P0.2 一次清掉。

---

## 1. 现状事实基线（计划证据）

### 1.1 执行器层（packages/agent-runtime/src/sdk/）

4 个执行器，**纯鸭子契约，无任何共享接口**（全仓 grep `EngineExecutor|ExecutorContract` 无命中）：

| 执行器              | 行数  | 方法面                                                                    | cancel 机制                                     |
| ------------------- | ----- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| ClaudeSDKExecutor   | 1,887 | onEvent/offEvent/cancel/executeTurn + **setPermissionMode + rewindFiles** | abort + query.close()，abort 监听器同步补发终态 |
| CodexCliExecutor    | 1,451 | onEvent/offEvent/cancel/executeTurn                                       | SIGTERM，catch/exitCode 分支补发终态            |
| CodexSdkExecutor    | 1,086 | onEvent/offEvent/cancel/executeTurn                                       | abortController，catch 分支补发终态             |
| CodexOpenAIExecutor | 254   | onEvent/offEvent/cancel/executeTurn                                       | abortController，catch 分支补发终态             |

关键事实：

- **构造函数全部无参**；全部依赖经 `executeTurn` 第 4 参 `SDKExecutorConfig`（sdk/types.ts:670-816，约 40 字段超集）传入
- 每 turn 新建实例、turn 结束即弃；会话连续性靠 `config.sdkSessionId + continueSession`
- `offEvent` 生产代码从未调用（靠每 turn GC）；迟到事件靠 `shouldAcceptSessionExecutorEvent`（session.service.ts:525）的**实例引用相等**闸门挡住
- `ActiveExecution` 结构类型（session.service.ts:389-393）是唯一接口化尝试：`cancel() + setPermissionMode?`
- **adapter 口径已有 4 套**：`SessionAgentAdapter`(3 值, protocol/ipc/index.ts:139)、`AgentAdapterKind`(3 值复制, session-resume-gate.ts:11)、`SDKInvocationSnapshot.transport`(4 值, sdk/types.ts:666)、`TurnPromptSnapshotEvent.adapterKind`(2 值, protocol/events/index.ts:921，**已落库**)
- codex 三执行器间存在成片复制：`buildCodexMcpEnv`×2、`buildCodexGoalPrompt`×2、`buildPromptWithAttachments`×4 变体、`computeDelta`×2

### 1.2 session.service.ts（11,685 行）引擎分叉与结构

结构分段：1-772 头部（imports/类型/模块级函数）｜773-10211 类体（~9,439 行）｜10213-11685 类外模块级（~1,470 行）。

**引擎分叉 32 处**（核心几处）：

| 位置         | 内容                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| :2728-2729   | `adapterKind = agentAdapter === 'claude-sdk' \|\| agentAdapter === 'claude' ? 'claude-sdk' : 'codex'` 二值归并     |
| :2736-2771   | resumeGate（allowlist 仅 claude 系 + anthropic + api.anthropic.com）                                               |
| :3463-3694   | **主分叉**：if claude → `tryStartSDKTurn`(:3760-4422, ~728 行)；落空 → `tryStartCodexCliTurn`(:4424-4873, ~450 行) |
| :7693-7695   | 成员执行器分叉 `isCodexMember ? createCodexExecutorForConfig : new ClaudeSDKExecutor`                              |
| :10005       | checkpoint 还原直接 `new ClaudeSDKExecutor().rewindFiles`（绕过抽象）                                              |
| :10453-10465 | `getAgentAdapterFromSession`（agent_adapter → chat_mode 遗留值 → providerType 兜底）                               |
| :10492-10495 | `normalizePermissionMode` 用 `startsWith('codex-')` 嗅探                                                           |
| :395-406     | `createCodexExecutorForConfig` 导出工厂（useLocalConfig→CLI；chat wire→OpenAI；否则→SDK）                          |

其余分叉：:2799/:2961/:3049/:3170/:3202/:3302/:3386/:3447（workflow 模式、MCP HTTP 桥标记、subagent 提示注入、Claude 预设快照、goal 包装策略）、:5909/:6951/:7193/:7436/:7508（team MCP 载具、成员全档、成员 resume、记忆 MCP 注入）、:8613/:8632/:8771（/approval 命令、goal 分派、goal 模式推断）。

**方法簇地图（17 簇，拆分 seam）**：

| 簇  | 内容                                                                | 行数   | 状态热度                   |
| --- | ------------------------------------------------------------------- | ------ | -------------------------- |
| 1   | turn 入口/并发分派（submitTurn/dispatchTurn/startTurn）             | ~298   | 高（五件套）               |
| 2   | startTurnExecution 引擎中立装配（单体 1,229 行）                    | ~1,229 | 中                         |
| 3   | Claude turn（tryStartSDKTurn + emitSdkRequiredError）               | ~728   | 高（五件套+三联）          |
| 4   | Codex turn（tryStartCodexCliTurn）                                  | ~450   | 高（对称）                 |
| 5   | 队列管理/调度（20 方法）                                            | ~541   | 高（五件套）               |
| 6   | goal 循环（16 方法）                                                | ~603   | 中                         |
| 7   | 团队/workflow + spark_team MCP（createTeamMcpServer 单体 1,115 行） | ~1,356 | 中（teamMcpHandles）       |
| 8   | 成员 turn（executeMemberTurn 单体 ~710 行）                         | ~710   | 中                         |
| 9   | MCP 工具面装配（10 方法）                                           | ~486   | 低                         |
| 10  | 记忆 + 标题精炼（6 方法）                                           | ~430   | 低                         |
| 11  | usage 台账 + emitAndPersist + dispose                               | ~281   | **极高（唯一事件漏斗）**   |
| 12  | 会话 CRUD + 引用/fork                                               | ~480   | 低                         |
| 13  | 命令系统                                                            | ~535   | 低（commandRegistry 自足） |
| 14  | 取消/审批/会话清理                                                  | ~201   | 高（五件套）               |
| 15  | 事件清理 + checkpoint（16 方法）                                    | ~416   | 低                         |
| 16  | 构造/注入/桥接/恢复                                                 | ~423   | —                          |
| 17  | 依赖访问器 + team 续跑 + turn 文件键                                | ~141   | 中                         |
| —   | 类外模块级纯函数（花名册/快照匹配/规范化/裁剪等）                   | ~1,470 | 零状态                     |

**共享状态热点（拆分最大技术难点）**：

1. **turn 所有权五件套** `activeLoops / runningTurnIds / startingSessions / startingTurnIds / cancelledTurnIds (+ activeExecutionPromises)` —— 被两个引擎执行体、队列调度、取消路径、dispose 五方交叉读写；并发上限 = `activeLoops.size + startingSessions.size` 联合计数（:2399/:8672 有时序陷阱注释）
2. **emitAndPersist（:7943）事件写入唯一漏斗** —— seq 分配 + cancelledTurnIds 闸 + hook + usage 清理全在其中；拆出模块必须继续走它
3. **per-turn 回收三联** `teamMcpHandlesByTurn / pluginRuntimeMcpHandlesByTurn / fileChangeKeysByTurn + usageLedgerLastByTurn` —— 必须在 turn finally 原子清理（:4400-4421 / :4849-4869 成对出现）
4. `mcpVersion/lastBuiltMcpVersion` 热更新计数器 —— 两引擎各自比较并覆写（:3970/:4595），拆开后必须共享同一实例

**调用方**：唯一生产构造点 `apps/desktop/src/main/ipc/index.ts:2292`（db + 8 回调 + mcpService），:2313-2318 setter 注入 4 个 provider；包出口 `agent-runtime/src/index.ts:202`。测试以 `Object.create(SessionService.prototype)` 直捣私有字段（activeLoops/pendingTurns/cancelledTurnIds 等）。

### 1.3 测试与验证基建

- **turn 全链路贯穿测试：不存在**。现状分层断片：goal-queue 桩掉 startTurn；session.service.test 只测并发门；plan-mode-e2e 只到 executor 层。L3463 两分支无对称断言。**这是 P1 最大测试缺口**
- executor 各自有厚测试（2045/1150/994/164 行）；4 种既有 fake 模式可复用（SDK 函数级 mock / 子进程 mock / executor 模块整替 / 原型部分桩）
- 验证命令：`pnpm --filter @spark/agent-runtime typecheck`（绿）；`pnpm --filter @spark/agent-runtime test:unit`（sqlite-abi 包装，node/electron 各跑一遍，**耗时×2**）
- agent-runtime 是 src 直引（无 build）；desktop 打包把 4 个 workspace 包打进 out/main bundle —— **src 内任意拆分不影响构建**；唯一禁区：`src/tools/*.mjs` 与 `src/services/media/*.mjs` 的相对目录结构（copyRuntimeToolsPlugin 按路径拷贝）
- 既有拆分先例 `142aa2eb`（2026-07-25）：session.service 10608→9366 行，拆 5 个 helpers + 顶部 re-export 保持 API + commit 带精确行数与测试数字 —— 本计划的风格模板

---

## 2. 目标设计

### 2.1 EngineExecutor 接口（新文件 `sdk/engine-executor.ts`）

```ts
/**
 * 引擎执行器统一契约。每个 turn 新建实例、构造无参、依赖经 config 传入。
 * 契约要点（从四执行器现有鸭子契约提炼，语义显式化）：
 * 1. 终态只经事件流表达：executeTurn 的 resolve/reject 不携带业务终态；
 *    无论成功/失败/取消，必须发出至少一条 terminal AgentEvent（cancel 语义：
 *    cancel() 返回后事件流上最终必须出现 cancelled 终态）。
 * 2. 实例身份即闸门：调用方以实例引用相等校验事件所有权
 *    （shouldAcceptSessionExecutorEvent），本契约的实现不得自我包装/代理。
 * 3. turnId 语义：第 2 参为 executor 归属 id；成员执行路径与 host turnId 不同。
 */
export interface EngineExecutor {
  readonly engine: EngineKind
  onEvent(listener: (event: AgentEvent) => void): void
  offEvent(listener: (event: AgentEvent) => void): void
  cancel(): void
  executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void>
}

/** 能力接口（控制面方法按能力可选——延续 ActiveExecution / SDKQuery 先例） */
export interface PermissionModeAwareExecutor extends EngineExecutor {
  setPermissionMode(mode: SDKExecutorConfig['permissionMode']): Promise<void>
}
export interface RewindCapableExecutor extends EngineExecutor {
  rewindFiles(params: RewindFilesParams): Promise<RewindFilesResult>
}
export const isPermissionModeAware = (e: EngineExecutor): e is PermissionModeAwareExecutor =>
  typeof (e as Partial<PermissionModeAwareExecutor>).setPermissionMode === 'function'
export const isRewindCapable = (e: EngineExecutor): e is RewindCapableExecutor =>
  typeof (e as Partial<RewindCapableExecutor>).rewindFiles === 'function'
```

设计裁决（为什么这样切）：

| 裁决                                                                                                                | 理由                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setPermissionMode`/`rewindFiles` **不进主接口**，走能力接口 + 类型守卫                                             | 四执行器只有 Claude 有；塞进主接口=全员可选方法=鸭子类型的翻版，编译器不兜底。能力守卫让 :9683 热切换与 :10005 checkpoint 的调用点显式探测                                                                                               |
| `EngineKind = 'claude-sdk' \| 'codex'`，**对齐 TurnPromptSnapshotEvent.adapterKind 现值域**，不引入 `'claude'` 命名 | adapterKind 已落库且 `getLatestMatchingTurnPromptSnapshot`(:11384) 做精确匹配；对齐=零 schema 迁移、resume 零风险。`'claude-sdk'` 是历史持久化值域，涵盖 `'claude'`/`'claude-sdk'` 两种 adapter（注释写明）。改名属 schema 迁移，不在 P1 |
| **不造第 5 套枚举**：EngineKind 与既有 4 套口径的关系显式声明                                                       | `SessionAgentAdapter`(3 值) --resolveEngineKind--> `EngineKind`(2 值)；`transport`(4 值) 是 codex 引擎内部载具观测口径，保持不动；`AgentAdapterKind`(3 值复制版) 收敛为 re-export protocol 定义（顺手还 P2 的债）                        |
| config 保持 `SDKExecutorConfig` 超集，**不拆进构造函数**                                                            | 调研发明文：`useLocalConfig` 在 codex 侧=换执行器、claude 侧=改 env 策略；config 是行为载体，P1 只加接口不改 config 形状                                                                                                                 |
| 接口落位 `sdk/`（runtime 层），不进 protocol                                                                        | protocol 是 IPC 契约层，不该知道 executor 存在                                                                                                                                                                                           |

### 2.2 EngineRegistry（新文件 `services/session/engine-registry.ts`）

```ts
export interface EngineCapabilities {
  nativeResume: boolean // claude: true（gate 内）；codex: thread resume 部分支持
  permissionHotSwitch: boolean // 仅 claude
  checkpointRewind: boolean // 仅 claude
  subagentTool: boolean // 仅 claude（Task 工具）
}

export interface EngineDescriptor {
  kind: EngineKind
  createExecutor(config: SDKExecutorConfig): EngineExecutor
  capabilities: EngineCapabilities
  checkAvailability(config: SDKExecutorConfig): Promise<{ available: boolean; reason?: string }>
}

export class EngineRegistry {
  register(d: EngineDescriptor): void
  get(kind: EngineKind): EngineDescriptor // 未注册抛错（fail-loud）
  resolveExecutor(adapter: SessionAgentAdapter, config: SDKExecutorConfig): EngineExecutor
}
```

- 默认注册两个 descriptor：claude（`new ClaudeSDKExecutor()`）与 codex（`createCodexExecutorForConfig` 整体挪入 codex descriptor 的 `createExecutor`——**载具三选一降为引擎内部细节**）
- `capabilities` P1 只声明、少量消费（`SUBAGENT_USAGE_HINT_SYSTEM_PROMPT` 注入、checkpoint 可用性判断两处可先行）；resume allowlist 的能力化改造留给 Phase 3
- 主分叉 :3463 的目标形态：`const executor = registry.resolveExecutor(agentAdapter, config)` + 统一管道；成员分叉 :7693 同理

### 2.3 resolveEngine 单点归一（新文件 `services/session/engine-kinds.ts`）

- `resolveEngineKind(adapter: SessionAgentAdapter): EngineKind` —— 穷尽 switch，新 adapter 值漏配即编译错
- 迁入并收编模块级纯函数：`getAgentAdapterFromSession`(:10453)、`getPermissionModeFromSession`(:10467)、`normalizeAgentAdapter`(:10486)、`normalizePermissionMode`(:10492，`startsWith('codex-')` 嗅探改为 8 字面量查表)
- 逐点替换散布的手写判断：:2728/:2967/:3051/:3172/:3203/:3302/:3386/:3463/:3614/:5909/:11348 —— 全部改调 `resolveEngineKind`，行为等价
- session.service.ts 顶部 re-export 保持外部 import 面不变（既有风格）

### 2.4 TurnRegistry（新文件 `services/session/turn-registry.ts`）

封装「turn 所有权五件套 + per-turn 回收三联 + mcpVersion 计数器」：

```ts
export class TurnRegistry {
  // 内部持有：activeLoops / runningTurnIds / startingSessions / startingTurnIds /
  //          cancelledTurnIds / activeExecutionPromises / teamMcpHandlesByTurn /
  //          pluginRuntimeMcpHandlesByTurn / fileChangeKeysByTurn / usageLedgerLastByTurn
  beginStarting(sessionId, turnId): void
  registerExecutor(sessionId, turnId, executor, promise): void
  isActiveExecutor(sessionId, executor): boolean // 供 shouldAcceptSessionExecutorEvent
  markCancelled(turnId): void
  isCancelled(turnId): boolean
  release(executor): void // finally 原子清理（五件套摘除+三联回收）
  cancelAll(onCancel: (e: ActiveExecution) => void): void
  concurrencySnapshot(): { active: number; starting: number } // 并发上限联合计数
}
```

**约束**：注册/释放必须继续走现有时序（`activeLoops.set` 在 executeTurn 之前、finally 里先摘五件套再推进队列）——`shouldAcceptSessionExecutorEvent` 的引用相等闸门与 `startingSessions` 的同步可见性（:8670 注释）都依赖它。

### 2.5 统一 turn 管道（`services/session/engine-turn-runner.ts`）

公共骨架单份，引擎差异参数化：

```
prepareTurnContext（簇2 拆出的引擎中立装配，输出 TurnRuntimeContext）
→ registry.resolveExecutor(agentAdapter, config)
→ descriptor.checkAvailability(config)（失败走 emitSdkRequiredError 等价路径）
→ engine-specific config 组装（下沉为 descriptor.buildTurnConfig(ctx)）
→ executor.onEvent(事件管道) → turnRegistry.registerExecutor(...)
→ await executor.executeTurn(...)
→ finally: turnRegistry.release(executor)（统一回收）
```

**分层达标 + 降级路径**（诚实评估，两个执行体是刻意对称而非完全相同）：

- **必达**：EngineExecutor 接口 + Registry + resolveEngine + TurnRegistry（两个现有执行体都改用）
- **目标**：完全统一的 EngineTurnRunner 骨架。引擎差异（MCP 载具组装、allowedTools 累积、plan 闸门、收尾动作）经 descriptor 钩子参数化；**行为保持原则**——统一后每个引擎的可观测行为（事件序列、落库、收尾）与现状等价，等价性由 W1 建立的贯穿基线测试锁定；确实无法参数化的差异保留 `engine capabilities` 条件分支，不硬凑
- **降级**：若收尾差异实测过大，允许 ClaudeTurnRunner / CodexTurnRunner 两个实现共存，但必须实现共享的 `TurnRunnerContract`（注册/回收/事件管道逻辑由 TurnRegistry 与共享基类提供，**禁止复制**）。降级时「1 接口 + 1 注册」目标仍成立，仅第三引擎需多写一个 Runner（工作量从「零」变为「一个薄类」）——如实计入验收口径

### 2.6 拆分目标目录与映射表

```
services/session/
  engine-executor.ts          ← 新增（接口与能力守卫；从 sdk/ re-export 或直接落位 sdk/）
  engine-registry.ts          ← 新增
  engine-kinds.ts             ← 吸收 :10453-10500 纯函数 + :395-416 工厂 + :11329-11428 codex 成员档
  turn-registry.ts            ← 新增（五件套+三联）
  engine-turn-runner.ts       ← 新增（统一管道或 Runner 契约）
  turn-dispatch.ts            ← 簇1（submitTurn/dispatchTurn/startTurn）
  turn-assembly.ts            ← 簇2（startTurnExecution 引擎中立装配）
  member-turn.ts              ← 簇8（executeMemberTurn）
  queue-scheduler.ts          ← 簇5（队列 20 方法）
  goal-loop.ts                ← 簇6
  team-orchestration.ts       ← 簇7（createTeamMcpServer 单体再按载具/组装拆 2~3 文件）
  workflow-approval.ts        ← 簇7 workflow 部分（runWorkflowApprovalNode 等 5 方法）
  mcp-tooling.ts              ← 簇9
  memory-title.ts             ← 簇10
  event-persistence.ts        ← 簇11（emitAndPersist 漏斗——唯一性不变）
  session-crud.ts             ← 簇12
  session-commands.ts         ← 簇13
  cancel-approval.ts          ← 簇14
  checkpoint.ts               ← 簇15
  session-pure-utils.ts       ← 类外纯函数（花名册/快照匹配/metadata/裁剪）
```

**状态归属与依赖注入**：

- 拆出模块不持有 SessionService 引用；经构造注入三类依赖：`TurnRegistry`、`TurnEventSink`（emitAndPersist + emitAgentStatusEvent + recordUsageUpdate 的窄接口——**事件写入漏斗唯一性**）、各自惰性依赖（repo/provider）
- SessionService 保留：构造签名不变（db + 8 回调 + mcpService + 2 OAuth）、9 个 setter、公开方法逐个改为一行委托、顶部 re-export 保持 `agent-runtime/src/index.ts:202` 出口与 ipc 调用面零变化
- 既有 34 个 `session-*.ts` 辅助文件**就地不动**（它们已是平铺 helpers，与本次目录化不冲突；后续按触碰归位，不做一次性大挪移——控制 diff 噪音）
- **测试兼容**：迁移期 SessionService 暴露只读 getter（`get activeLoops()` 等代理 TurnRegistry 内部 Map）；写路径戳私有字段的测试（session.service.test.ts / session-goal-queue.test.ts / session-runtime-config.test.ts 中直捣 activeLoops、pendingTurns、cancelledTurnIds、teamDispatchBudgetExhaustedTurns 的用例）随拆分步迁移为经公共 API 操作——每步列出改动的测试文件

---

## 3. 周计划（3 周，W2/W3 含伸缩标注）

### W1 — 测试基座 + 接口与注册表（零行为变化）

> **落地记录（2026-08-15，D1-2 完成，commit `a4199cd8`）**：
>
> - `__tests__/sdk/fake-engine-executor.ts`：脚本化 stub 落地（事件注入/holdUntilCancel/迟到事件记录/executeTurn 调用记录），harness 队列机制就位，W2 起可复用为 echo-executor 自测工具。
> - `__tests__/services/turn-pipeline-baseline.test.ts`：3 条贯穿基线 × claude/codex 双引擎参数化 = **6/6 全绿**。与计划的差异：mock 面采用「真实 SQLite（临时目录 + runMigrations）+ 只 mock sdk barrel/keystore/debug-log-server」，落库断言为真实存储行为（优于原计划设想的 mock storage）；终态补发、闸门丢迟到事件、stableSdkSessionId 跨 turn 稳定（claude）/逐 turn 演进（codex）均已锁入断言。
> - 环境备注：Windows 本机跑 agent-runtime 测试需 better-sqlite3 为 node ABI（`node_modules/better-sqlite3 && npx prebuild-install -r node`），跑完必须 `apps/desktop && pnpm rebuild:native` 恢复 Electron ABI（vendor/prebuilds 只有 macOS arm64 二进制，`sqlite-abi.sh` 在 Windows 不可用）。既有 15 个 Windows 平台敏感失败（session-runtime-config ×10、session.service.test ×5）与本改动无关（移走新文件重跑对照验证），已按「先可观测后强制」记录。

> **落地记录（2026-08-15，D3 完成）**：
>
> - `sdk/engine-executor.ts`：EngineKind（对齐 adapterKind 持久化值域）+ EngineExecutor（含三条契约注释：终态只经事件流/实例身份即闸门/turnId 语义）+ PermissionModeAwareExecutor / RewindCapableExecutor 能力接口 + isPermissionModeAware / isRewindCapable 守卫 + RewindFilesParams/Result 具名类型（迁自 Claude 内联签名）+ ActiveExecution 迁入（`Pick<EngineExecutor,'cancel'>` 结构视图）。
> - 4 执行器 `implements` 就位（Claude 同时实现两个能力接口），各新增 `readonly engine` 字段（唯一运行时面变化：实例上多一个字符串字段，零行为影响）；FakeEngineExecutor 同步挂接口（第 5 个实现者，W2 基座）。
> - `__tests__/sdk/engine-executor-conformance.test.ts`：5 条断言全绿 = 编译期赋值窄化（4 执行器 × 接口/能力类型）+ 运行期 cancel→cancelled 终态冒烟 ×4（transport mock 复用各执行器既有测试模式）。
> - 验证：agent-runtime typecheck 0 错、touched-files lint 0 错、四执行器既有测试 110/110、贯穿基线 6/6、session-runtime-config 的 10 个失败经 stash 对照归因为既存（与本改动无关）。barrel 新增 re-export 均为增量，desktop 消费面不受影响。

> **落地记录（2026-08-15，D4 完成，commit `df0c031b`）**：
>
> - `services/session/engine-kinds.ts`（`services/session/` 子目录首个文件，W3 拆分目标布局就位）：resolveEngineKind 穷尽 switch + 四个归一化纯函数迁入；session.service import + re-export（外部 import 面不变，provider-model-resolution.test 33/33 免改通过）。
> - 手写归并替换 **12 处**（比计划清单多 1 处：`:3615` 的单值 `=== 'codex'` 判断，resolveEngineKind 化后口径一致）：adapterKind 快照、workflow 执行模式、isCodex ×2、subagent 提示注入、Claude 预设段、sdkPreset、主 turn 分叉、disableCodexNativeSkills、team consumer 判定、成员档 isCodexMember、applyApprovalToggle。验收 grep：`'claude-sdk' ||` 归并与 `startsWith('codex-')` 嗅探在 session.service 内归零。
> - 已知行为边界（有意为之并写入测试锁定）：`normalizePermissionMode`/`isCodexPermissionMode` 查表后，非法 `'codex-*'` 脏字符串从「归为 codex」改为「回落 claude 侧」（更保守；全仓 grep 确认无写入方可产生该类值，8 个合法值行为逐字一致）。
> - 顺手还 P2 枚举收敛债：`AgentAdapterKind`（session-resume-gate 逐字复制版）收敛为 protocol `SessionAgentAdapter` 别名（类型层零变化）。
> - 新增 `__tests__/services/session/engine-kinds.test.ts` 9 条断言（穷尽映射/查表边界/迁移函数回归锁定）。
> - 验证：typecheck 0 错、lint 0 errors、贯穿基线 6/6 全绿；session-runtime-config ×10 与 session.service.test ×5 失败经 stash 对照归因为既存 Windows 平台问题（其中 session.service.test 的 5 处为并行开发新增 `pendingTitleRefinements` 字段后测试构造路径未跟上，**遗留待修**，非本改动引入）。
> - ABI 备忘修正：node ABI 切换正确姿势为「进 `node_modules/better-sqlite3` 目录内执行 `npx prebuild-install -r node`」（`-d` 是布尔 download flag 不是目录参数）；恢复用 `apps/desktop && NATIVE_MODULES=better-sqlite3 pnpm rebuild:native`（根目录无此脚本），本次已恢复并经 `pnpm native:verify` 三模块验证。

> **落地记录（2026-08-16，D5 完成，commit `4e2b3565`）**：
>
> - `services/session/engine-registry.ts`：EngineCapabilities（nativeResume/permissionHotSwitch/checkpointRewind/subagentTool 四能力）+ EngineDescriptor（createExecutor/capabilities/checkAvailability）+ EngineRegistry（register/get fail-loud/resolveExecutor）+ createDefaultEngineRegistry 两 descriptor 默认注册。
> - `createCodexExecutorForConfig` 整体迁入 codex descriptor 的 createExecutor（载具三选一降为引擎内部细节）；session.service re-export 保持 import 面（既有工厂测试免改）。claude descriptor 的 checkAvailability 镜像现行 `isSDKAvailable()` 检查；codex 如实声明恒可用（现状无二进制预检）。capabilities/checkAvailability 本阶段只声明，W2-D5 能力探测接入消费。
> - 三处创建点改经 registry（先只换解析，后续流程不动）：claude 主路径 `get('claude-sdk').createExecutor(config)`、codex 主路径 `get('codex').createExecutor(config)`、成员分叉三元归并改 `resolveExecutor(memberAdapter, sdkConfig)`。三个 executor import（CodexCli/OpenAI/Sdk）随之清理。
> - 新增 `__tests__/services/session/engine-registry.test.ts` 11 条断言（get fail-loud、descriptor 覆盖注入点、resolveExecutor adapter→载具三段解析 ×4、工厂优先级遮蔽 ×2、能力声明、availability 契约）。
> - 验证：typecheck 0 错、lint 0 errors、贯穿基线 6/6（双引擎 turn 路径穿过新创建点，行为锁确认等价）、conformance 5/5、session.service 69/69、engine-kinds 9/9；runtime-config 既存 10 失败数不变（零新增）。Electron ABI 已恢复并经 native:verify 三模块验证。
> - 遗留清偿：D4 记录的 session.service.test ×5（`pendingTitleRefinements` fixture 缺字段）已修复（commit `5e027c45`，69/69 全过）。

| 日   | 任务                                                                                                                                                                                                                                                                                                                      | 产出/提交                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D1-2 | **测试基座先行**：`__tests__/sdk/fake-engine-executor.ts`（脚本化事件注入的 stub，复用 plan-mode-e2e 的 async-generator 模式）；为**现状** turn 管道写 3 条贯穿基线测试：①完整 turn 事件顺序+终态+落库 ②cancel 路径（cancel→cancelled 终态→五件套摘除）③resume id 生成与 adapterKind 快照匹配。这组测试是整个 P1 的行为锁 | `test(session): turn 管道贯穿基线`              |
| D3   | `sdk/engine-executor.ts`：EngineKind + EngineExecutor + 能力接口/守卫；4 执行器 `implements EngineExecutor`（ClaudeSDKExecutor 同时 implements 两个能力接口）；`ActiveExecution` 定义迁至接口侧；4 条 conformance 断言测试（编译期 satisfies + 运行期 cancel→终态冒烟）                                                   | `refactor(sdk): EngineExecutor 显式接口`        |
| D4   | `services/session/engine-kinds.ts`：resolveEngineKind 穷尽 switch；迁入 :10453-10500 四个纯函数 + normalizePermissionMode 查表化；session.service.ts re-export；逐点替换 :2728 等 11 处手写归并（每处行为等价，可一个 commit 含多点但逐点列清单）                                                                         | `refactor(session): resolveEngineKind 单点归一` |
| D5   | `engine-registry.ts`：两 descriptor 注册（codex 工厂挪入 descriptor）；主分叉 :3463 与成员分叉 :7693 改经 registry（先只换解析，不动后续流程）；EngineRegistry 单测                                                                                                                                                       | `refactor(session): EngineRegistry 上线`        |

**W1 验证**：agent-runtime typecheck + test:unit 全绿；desktop typecheck 绿（依赖 P0.2）；基线测试不改一字全绿。

### W2 — turn 所有权收编 + 管道统一（行为保持，高风险区）

| 日   | 任务                                                                                                                                                                                                                                                                                                                                                                  | 产出/提交                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| D1-2 | `turn-registry.ts`：五件套+三联+mcpVersion 计数器封装；两个 tryStart\* 的注册/回收（:4229/:4760 注册、:4400/:4849 finally）、cancelTurn/dispatchTurn 中断路径、dispose、队列并发计数（:2399/:8672）全部改经 TurnRegistry；迁移受影响测试；只读 getter 兼容层                                                                                                          | `refactor(session): TurnRegistry 收编所有权协议` |
| D3-4 | `engine-turn-runner.ts`：统一骨架；descriptor 增加 `buildTurnConfig`/`checkAvailability` 钩子；先统一「可用性检查→executor 解析→事件管道→注册→执行→finally 回收」外圈，收尾动作（标题精炼/goal 块解析/continuity/记忆写入）逐段 diff 两分支比对后决定参数化或保留条件分支；**若判定无法参数化，此时显式降级为双 Runner + TurnRunnerContract**（降级决策点，向后兼容） | `refactor(session): 统一 turn 管道`              |
| D5   | 成员路径与侧门收编：:7693 成员执行器、:10005 checkpoint rewind（改 `isRewindCapable` 探测）、:9683 权限热切换（改 `isPermissionModeAware`）；SUBAGENT_USAGE_HINT 注入与 checkpoint 可用性两处改读 capabilities                                                                                                                                                        | `refactor(session): 能力探测取代硬编码分叉`      |

**W2 验证**：同 W1 + 基线测试 3 条全绿 + resume-recovery.test 全绿 + 手动冒烟（dev 起应用各跑一条 claude/codex 会话含取消与审批）。

### W3 — session.service 拆分（strangler，每步独立可合并）

按风险从低到高排序，**每步一个 commit，步间全量验证**：

| 步  | 内容                                                                                                                                                                            | 预计减行 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| S1  | 类外纯函数（:10213-11685）→ session-pure-utils.ts / engine-kinds.ts 补充                                                                                                        | ~1,470   |
| S2  | 簇13 命令系统 → session-commands.ts（commandRegistry 自足，最独立）                                                                                                             | ~535     |
| S3  | 簇15 checkpoint + 事件清理 → checkpoint.ts                                                                                                                                      | ~416     |
| S4  | 簇12 会话 CRUD/引用 → session-crud.ts                                                                                                                                           | ~480     |
| S5  | 簇10 记忆/标题 → memory-title.ts；簇9 MCP 工具面 → mcp-tooling.ts                                                                                                               | ~916     |
| S6  | 簇11 event-persistence.ts（TurnEventSink 接口在此定型）                                                                                                                         | ~281     |
| S7  | 簇7 team-orchestration.ts + workflow-approval.ts（createTeamMcpServer 1,115 行单体顺势拆 2~3 文件）                                                                             | ~1,356   |
| S8  | 簇8 member-turn.ts                                                                                                                                                              | ~710     |
| S9  | 簇5 queue-scheduler.ts + 簇6 goal-loop.ts（经 continueGoalOrQueue 强耦合，最后动；此时两者对 SessionService 的依赖已收窄为 TurnRegistry + TurnEventSink + pendingTurns 访问器） | ~1,144   |
| S10 | 簇1/2/3/4 收尾：turn-dispatch / turn-assembly 定型；SessionService 变纯 façade；ratchet 收紧 session.service 阈值至 2,000                                                       | ~2,700   |
| S11 | **验收执行**：echo-executor stub 引擎（实现接口 + descriptor 注册 3 行）在测试环境跑通完整 turn                                                                                 | 验收     |

**W3 每步验证**：`gitnexus_impact` 符号移动前查询（CLAUDE.md 规则）→ 拆 → agent-runtime typecheck + test:unit → desktop typecheck → commit message 记录行数变化（延续 `142aa2eb` 风格）。

**总量核算**：11,685 − (1,470+535+416+480+916+281+1,356+710+1,144+2,700) ≈ 11,685 − 10,008 ≈ **1,677 行 façade**（≤2,000 达标，留 300 行余量给 re-export 与委托）。

---

## 4. 测试策略

1. **基线先行**（W1 D1-2）：贯穿测试锁住现状行为，之后所有步骤「不改一字全绿」是合并前提
2. **conformance**：4 executor × 编译期 + 运行期（cancel 必出终态）断言
3. **echo-executor 双重身份**：既是验收标准（S11），也是 W2 起管道统一的开发自测工具（提前建，W1 基座顺带产出）
4. **回归面**：每步全量 agent-runtime test:unit（注意 sqlite-abi 双遍耗时）；resume-recovery / session-event-sequencer / session-runtime-config 三个重构敏感文件纳入必查
5. **双 mapper 测试都要跑**：`src/sdk/event-mapper.test.ts`(1,019) 与 `src/__tests__/sdk/event-mapper.test.ts`(2,491) 并存，P1 不合并它们（属 P2），但触及 mapper 时两份必跑
6. **构建禁区**：不触碰 `src/tools/*.mjs`、`src/services/media/*.mjs` 相对结构
7. **手动冒烟**（W2 末、W3 S10 后各一次）：dev 起应用，claude/codex 各一条会话，覆盖流式输出、工具卡、取消、审批弹窗、队列

---

## 5. 风险登记册

| #   | 风险                                                        | 等级 | 缓解                                                                                                                                                     |
| --- | ----------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | turn 全链路无既有测试，重构恰动此处                         | 🔴   | 基线测试先行（W1 D1-2 硬门），不绿不动刀                                                                                                                 |
| R2  | 所有权五件套交叉读写，拆分破坏时序                          | 🔴   | TurnRegistry 单点封装；注册/释放时序逐行对照现状；只读 getter 兼容层缓冲测试面                                                                           |
| R3  | emitAndPersist 不变式（取消后不落事件、seq 单调）被绕开     | 🔴   | TurnEventSink 窄接口注入；拆出模块禁止直接写库（code review 检查项）                                                                                     |
| R4  | resume 静默断裂（id hash + adapterKind 匹配 + gate 三合力） | 🟠   | EngineKind 对齐 adapterKind 值域零迁移；resume-recovery.test 每步必查；不改 makeRuntimeSessionId 组成                                                    |
| R5  | 双执行体「刻意对称」在统一时只搬一边                        | 🟠   | W2 D3-4 逐段 diff；降级路径预案（双 Runner + 契约）                                                                                                      |
| R6  | 测试直捣私有字段，字段搬迁=大范围测试改动                   | 🟠   | 只读 getter 兼容；写路径用例随步迁移并列清单                                                                                                             |
| R7  | 多 agent 并行冲突（session.service 是全仓热点）             | 🔴   | worktree 物理隔离 + 独占窗口：P1 期间 session.service.ts 与 sdk/ 四执行器冻结他人改动；Phase 2 的 protocol/ipc 拆分（文件不重叠）可由另一 agent 并行推进 |
| R8  | desktop 装配侧零测试，「构造签名不变」无兜底                | 🟡   | 唯一构造点 ipc/index.ts:2292 由 desktop typecheck 编译期锁定（P0.2 前置清红后信号有效）                                                                  |
| R9  | 拆分期间上游 master 演进造成大冲突                          | 🟡   | 小步短分支（每步独立可合并，分支生命周期 ≤ 数日）；每日 rebase master                                                                                    |
| R10 | 3 周排期乐观（W2 管道统一不确定性最高）                     | 🟡   | W2 末设降级决策点；降级不阻塞 W3；S7/S9 可滑出为 W3.5                                                                                                    |

---

## 6. 验收清单（Definition of Done）

- [ ] session.service.ts ≤ 2,000 行（纯 façade：构造 + setter + 委托 + re-export）
- [ ] services/session/ 每模块 ≤ 1,500 行
- [ ] `resolveEngineKind` 之外无 `'claude-sdk' || 'claude'` 手写归并；`startsWith('codex-')` 嗅探归零（查表化）
- [ ] echo-executor：实现 EngineExecutor + EngineDescriptor 注册，session.service 零修改跑通完整 turn（事件落库 + 终态 + cancel 路径）
- [ ] W1 基线贯穿测试 3 条自建立后未改动且全绿
- [ ] agent-runtime + protocol + storage + desktop 的 typecheck 全绿；agent-runtime + desktop main 测试全绿
- [ ] 手动冒烟两轮通过（claude/codex × 流式/工具/取消/审批/队列）
- [ ] ratchet 基线更新：session.service 阈值收紧至 2,000
- [ ] 交付说明含：最终行数表、降级路径是否触发、行为差异清单（应为空）、未验证项标注

---

## 7. 与其他 Phase 的边界

- **P2 并行项**：protocol/ipc 模块化、ipc/index 减重、event-mapper 合并、权限枚举收敛——文件与 P1 不重叠，可并行；P1 只顺手做 `AgentAdapterKind` 收敛为 re-export（engine-kinds.ts 内的一小步）
- **P3 留口**：EngineCapabilities 的 nativeResume 字段已声明，ResumeGateManager allowlist 的能力化消费在 P3；TurnEventSink 接口即未来 AgentEventProjection 的消费面雏形
- **不做**：不改 SDKExecutorConfig 字段形状；不动 34 个既有 session-\*.ts helpers（触碰才归位）；不合并双 mapper；不引入 DI 框架
