# 统一编排内核（Unified Orchestration Kernel）设计

> 状态: [实施中] | 最后核对: 2026-06-30

把现在各自为政的三套任务执行机制（goal/loop 单 agent 循环、workflow 提示词拍平、team A2A 真派发）收敛成**一个编排内核**：统一的「验收门槛 → 任务拆解 → 派发 → 结果验收 → 循环控制」。编排者只调度、验收、控循环，具体子任务交给 subagent / 其他 agent 执行。

---

## 1. 背景与现状

| 能力 | 现状 | 关键代码 |
|---|---|---|
| goal/loop | 单 agent 的 Review→Act→Validate 循环；`/goal <objective>` **立即开跑**，验收标准缺省时让模型自己 derive | `command-registry.ts:597`、`session.service.ts:250`（`buildGoalIterationPrompt`） |
| workflow | **无执行引擎**：整张 DAG 被 `buildWorkflowSystemPrompt` **拍平成一段 system prompt**，让单 agent 照步骤做；`agent`/`subagent` 节点不被真正派发 | `session.service.ts:5271` |
| team (A2A) | **已有真派发**，但仅 team mode 启用：`spark_team` in-process MCP 暴露 `agent_dispatch` 工具 → `TeamDispatchService.run()`，支持嵌套深度、并行、超时、expectedOutput | `session.service.ts:2982`（`createTeamMcpServer`）、`team-dispatch.service.ts` |

**核心洞察**

1. team 派发的 worker 上下文**完全隔离**：`memberSdkSessionId = crypto.randomUUID()` + `continueSession: false`，worker 只拿到 `buildMemberUserMessage(task)`，拿不到宿主对话，只回传蒸馏后的 `content`（`session.service.ts:3219` 起）。这正是要复用的派发原语。
2. `WorkflowNode`（kind/config/outputKey/retryCount/parallelism）+ `WorkflowEdge` + `orderWorkflowNodes` 已经是一张标准的 **LangGraph 式 DAG**，只缺一个按节点派发的执行器。
3. goal/loop 跨轮已有两层压缩：会话层 `buildConversationHistoryWithSummary`（提取式摘要+近窗逐字）+ 目标层 `progressLog.slice(-8)`（单行进度）。

## 2. 目标与非目标

> 本次任务的总目标：**所有本地会话内的目标功能全部达到生产可交付、用户可直接使用的程度**——设计合理、架构清晰稳定、功能使用流程完整、日志可观测（复用项目现有日志审计）。详见 §3.A 验收基线。

**目标（本期全部交付，含原 Phase 2）**
- 统一编排内核，三入口（goal/loop、workflow、team）共用「门槛 + 派发 + 验收 + 循环控制」。
- goal/loop/带工作流任务启动前，强制产出「目标成果 + 可验收标准」契约（Agent 起草、用户确认）。
- 编排者默认硬约束（只调度、验收、控循环），具体子任务派给 subagent / 其他 agent；零成员/纯原子任务可退化自执行。
- 把 A2A 派发能力从 team mode 解绑，goal/workflow 也能复用。
- workflow 从「拍平 prompt」升级为**完整执行器**：拓扑序 + 节点派发 + outputKey 状态传递 + 重试 + 原子节点自执行 + **并行分支 + 条件边 + checkpoint/断点续跑 + 节点级模型切换**。
- **修复代码还原点（Checkpoint）**：当前永远为空，按 SDK 真实模型重架（见 §10）。
- **可观测性**：编排/派发/验收/循环/工作流节点/checkpoint 全链路接入现有日志审计，关键状态可追溯。

**非目标**
- 不照搬「Claude Code workflow」：CC 无声明式工作流，其 Task 子代理已被自家 `agent_dispatch` 等价替代（worker 内显式 `disallowedTools: ['Task']`）。
- 远程/云端会话的目标功能不在本次范围（仅「本地会话内」）。
- goal 进度摘要从提取式升级为 LLM 摘要：纳入本次（可观测质量项），但若与生产稳定性冲突则可降级为提取式并记日志。

## 3. 设计决策（已与用户确认）

1. **范围**：统一编排内核（非分模块逐步改）。
2. **验收门槛**：Agent 起草契约 + 用户确认（非硬性用户必填、非纯软跳过）。
3. **编排者约束**：默认硬约束（工具集只剩 dispatch + validate + loop-control）+ 零成员/原子任务可退化自执行。
4. **Worker 来源**：workflow 节点显式 `agentId` 绑定真实 agent + `subagent` 节点用节点 config 生成临时 worker。
5. **工作流范围**：本期纳入**完整执行器**（含并行/条件边/断点续跑/节点级模型切换），不再分期。
6. **代码还原点**：按 SDK `rewindFiles` 真实模型重架，弃用自研 `checkpoint.path` 目录拷贝；以 turn 为还原锚点。
7. **生产基线**：所有本地会话目标功能达到生产可交付（见 §3.A）。

### 3.A 验收基线（生产可交付）

每项目标功能需同时满足：
- **设计合理**：概念不重复、入口收敛、退化路径有明确规则。
- **架构清晰稳定**：核心枢纽改动小步化；team 不退化；错误有边界与兜底。
- **流程完整**：从创建 → 门槛确认 → 执行 → 验收 → 完成/失败/暂停/恢复/清除，全流程闭环，UI 可操作。
- **可观测**：编排/派发/验收/循环/工作流节点/checkpoint 关键状态全部接入现有日志审计，失败可定位、状态可追溯。
- **有测试**：核心路径单测 + team 回归不破。

## 4. 架构：编排内核（Orchestrator）

内核统一五个职责，落在 `SessionService` 的编排路径上，复用 `TeamDispatchService` 作派发引擎。

- **验收契约 Acceptance Contract**：直接复用现有 `SessionGoal` 模型（`objective` / `successCriteria`=可验收标准 / `constraints` / `validation`{commands,checklist} / `budget`）。**不新增 acceptanceCriteria 字段**，`successCriteria` 即验收标准，避免概念重复。
- **门槛 Gate**：启动时若契约不完整（缺 `successCriteria`），编排者据 `objective` 起草契约 → 走现有 plan/approval 审批通道弹给用户确认/编辑 → 确认后才进入循环。
- **派发 Dispatch**：复用 `agent_dispatch`；把 `spark_team` in-process MCP **泛化为 `spark_orchestrate`**（保留 `spark_team` 别名向后兼容），注入条件从「team mode」扩大到「任何带编排意图的任务」。
- **验收 Validate**：每轮 / 每节点产出后，编排者对照 `successCriteria` + 跑 `validation.commands`，按现有 `spark-goal-status` 协议块判定 `continue/completed/blocked/failed`。
- **循环控制 Loop control**：复用现有 `budget`（maxIterations / maxRuntimeMinutes / maxBudgetUsd / maxConsecutiveFailures / noProgressLimit）与 Review→Act→Validate。预算覆盖整棵 worker 树（新增：goal budget 下传给 dispatch）。

## 5. 三入口收敛

1. **goal/loop**：`/goal <objective>` → Gate（起草契约 + 确认）→ 编排循环。编排者默认硬约束工具集；零成员/原子任务退化自执行。
2. **workflow**：`buildWorkflowSystemPrompt` 由「拍平 prompt」改为驱动 **MVP 执行器**（见 §7）。
3. **team**：现状已是真派发，纳入同一内核，roster 作为可派 worker 来源之一。

## 6. Worker 来源与安全边界

**来源**
- workflow `agent` 节点：`config.agentId` 指向资源库真实 agent。
- workflow `subagent` 节点：用 `config`（prompt/role/skillIds/toolIds/mcpServerIds/modelId）生成临时 worker。
- team：沿用 roster。

**安全边界（复用 team 现成机制）**
- 派发深度上限 `currentDepth` / `maxDepth`（已有）。
- 每 turn 派发上限 `maxDispatchesPerTurn`（已有）。
- 权限继承：宿主 bypass/full-access → worker 放行（已有）；否则 worker 固定 `claude-auto`。
- **泛化点**：worker 校验当前写死 `teamConfig.memberAgentIds.includes(...)`（`team-dispatch.service.ts:100` 附近）。改为「允许 worker 集合」抽象：team 来自 roster，workflow 来自节点 `agentId` 白名单 + 临时 subagent。team 原路径保持不变，并行新增 workflow 路径。

## 7. 工作流执行器（完整版）

- **拓扑序**：复用 `orderWorkflowNodes`。
- **节点分派策略**：
  - `agent`（带 agentId）→ `agent_dispatch` 到该真实 agent。
  - `subagent` → 用节点 config 生成临时 worker 并 dispatch。
  - `skill` / `tool` / `mcp` / `verify` / `approval` / `input` / `artifact` → 原子操作，**编排者自执行**（退化路径，避免为单次工具调用套一层 subagent）。
- **状态传递**：节点 `outputKey` 写入运行态 state；下游节点通过 dispatch 的 `inputs` 取上游输出。
- **重试**：复用节点 `config.retryCount`。
- **验收**：`verify` 节点跑 `config.verifyCommands`；整体收敛仍归口编排内核的 Validate。
- **并行分支**：同一前驱的多个无依赖后继节点并行派发，复用 `agent_dispatch_batch` 的并行通道（绕过 turn 串行队列）+ 节点 `config.parallelism` 限流；汇合节点等待全部上游完成。
- **条件边**：`WorkflowEdge` 增加可选 `condition`（基于运行态 state 的表达式/键值判定）；执行器据此裁剪不满足条件的分支。
- **断点续跑（checkpoint/resume）**：执行器把运行态（已完成节点、outputKey state、待执行前沿）持久化（新增 workflow run repository）；中断后可从最后成功节点恢复，跳过已完成节点。
- **节点级模型切换**：`subagent` 节点 dispatch 时按 `config.modelId/providerProfileId` 选模型；`agent` 节点用其绑定 agent 的模型；编排者自执行的原子节点保持会话模型。SDK 单 turn 无法切换的场景，通过「每节点一次独立 dispatch/executor」天然实现 per-node 模型。

> 与 §13 风险呼应：条件边的表达式求值需限定为安全子集（键存在/相等/布尔），不引入任意代码执行。

## 8. 上下文与长程失真控制

- **结构性缓解**：编排者只调度，worker 上下文钉死在单子任务（fresh session、只给 task、不续宿主对话），只回传结论。编排者自身只累积「契约 + progressLog + 最近 N 条派发蒸馏结论」，看不到 worker 全文 → 编排者上下文天然精简。
- **编排者压缩策略**：编排者保留契约 / 进度日志 / 蒸馏结论，不保留 worker 全文；会话层继续用 `buildConversationHistoryWithSummary`。
- **进度摘要增强**：把 goal 进度摘要从提取式升级为 LLM 摘要以提质（本次纳入；与稳定性冲突时可降级为提取式并记日志）。

## 9. 数据模型变更

- `SessionGoal`：无需加字段，`successCriteria` 复用为验收标准；`budget` 增加下传语义（不改 schema）。
- `WorkflowItem` / `WorkflowGraph`：`WorkflowEdge` 增加可选 `condition`（条件边）；其余 schema 不变。
- **新增 workflow run 持久化**：运行态（runId、已完成节点、outputKey→value state、待执行前沿、状态）落库，支撑断点续跑。
- **新增 turn 还原锚点**：在 turn/event 上持久化 SDK user-message UUID，供 checkpoint restore 用（见 §10）。

## 10. 代码还原点（Checkpoint）修复

**根因**：当前实现建立在一个不存在的 SDK 形状上——
- `event-mapper.ts:260` 读取 `msg.checkpoint`，但 SDK 的 `SDKResultSuccess`/`SDKResultError` **没有 `checkpoint` 字段** → 永不产生 `checkpoint` 事件 → `listSessionCheckpointsFromEvents`（`session.service.ts:4426`）永远返回空（「怎么做都是空」）。
- `restoreCheckpoint`（`session.service.ts:4452`）是一套自研「按 `checkpoint.path` 目录拷文件」逻辑，SDK 从不喂数据，形同死代码。

**SDK 真实模型**（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`）：
- `enableFileCheckpointing: true` 按 **user message UUID** 跟踪文件变更（Spark 主 turn 已设 `enableCheckpoints: true`）。
- 恢复用 query 控制对象的 **`rewindFiles(userMessageId, { dryRun })`**，返回 `RewindFilesResult`（canRewind + 文件变更统计）。
- 没有流式 checkpoint 事件，没有 result 上的 checkpoint 字段。

**修复设计**：
1. **锚点采集**：从 SDK 流捕获每个 user message 的 UUID，持久化到对应 turn（§9 新增锚点）。
2. **list**：还原点 = 会话的历史 turn（Spark 已持久化 `user_message` 事件），展示「第 N 轮 / 时间 / 摘要 / 受影响文件（来自 `SDKFilesPersistedEvent` 或 dryRun 预览）」。删除依赖不存在的 `checkpoint` 事件的旧 list 逻辑。
3. **restore**：调 SDK `rewindFiles(turn.userMessageUuid)`。活跃会话用当前 query；非活跃会话先 resume 再 rewind。先 `dryRun` 预览受影响文件 → 用户确认 → 实际回滚。弃用自研路径拷贝。
4. **降级与可观测**：`enableFileCheckpointing` 关闭或 `canRewind=false` 时，UI 明确提示「该轮不可还原」并记审计日志，而非静默空白。
5. **event-mapper**：移除死的 `msg.checkpoint` 分支（或保留为 SDK 未来兼容但不作为唯一来源）。

> 风险：`rewindFiles` 需会话可 resume 且 checkpointing 全程开启；team worker 已 `enableCheckpoints: false`，还原点只针对宿主会话的文件变更，需在 UI/文档明确语义。

## 11. 改动落点与风险

> CLAUDE.md 强制：实现前对**每个被改符号**先跑 `gitnexus_impact({direction:"upstream"})` 并报告爆炸半径；提交前跑 `gitnexus_detect_changes()`。

| 文件 | 改动 | 风险 |
|---|---|---|
| `packages/agent-runtime/src/services/session.service.ts`（5850 行） | `buildWorkflowSystemPrompt` 升级为执行器驱动；`createTeamMcpServer` 泛化为 `spark_orchestrate`；`setGoal` 接 Gate；budget 下传 | **HIGH**（核心枢纽，需逐符号 impact） |
| `packages/agent-runtime/src/services/team-dispatch.service.ts` | worker 校验从 team 名单泛化为「允许 worker 集合」 | 中（有测试基线） |
| `packages/agent-runtime/src/core/command-registry.ts:597` | `/goal` handler 接 Gate | 中 |
| `packages/protocol/src/ipc/index.ts` | `agent_dispatch` 解绑后的事件/类型（大概率沿用，可能加 workflow 派发事件） | 低 |
| `apps/desktop/src/renderer/.../ChatView.tsx`、`CheckpointTimelinePanel.tsx` | goal/工作流「契约确认」弹窗；还原点面板对接 turn 锚点 + dryRun 预览 | 中 |
| `packages/agent-runtime/src/sdk/event-mapper.ts`、`claude-sdk-executor.ts` | 采集 user-message UUID；移除死的 `msg.checkpoint` 分支 | 中 |
| `packages/storage`（新增 workflow-run repository、turn 锚点字段） | 工作流断点续跑持久化、还原锚点 | 中 |
| 全链路 | 编排/派发/验收/循环/节点/checkpoint 接入现有日志审计 | 低（横切） |

## 12. 测试策略

- 复用 `team-dispatch.service.test.ts`、`team-roster-prompt.test.ts` 基线，确保 team 不退化。
- 新增：
  - Gate 契约起草/确认；契约不完整时拒绝启动循环。
  - 「允许 worker 集合」泛化后 team 路径与 workflow 路径双覆盖。
  - workflow 执行器：拓扑序、agent/subagent 节点真派发、原子节点退化自执行、outputKey→inputs 状态传递、retryCount 重试、**并行分支、条件边裁剪、断点续跑恢复、节点级模型切换**。
  - 安全边界：深度上限、每 turn 派发上限、预算下传与树级耗尽。
  - checkpoint：list 从 turn 锚点产出、`rewindFiles` restore（含 dryRun 预览）、不可还原时的降级提示。
- 注意：`@spark/storage` 测试本地需切 better-sqlite3 的 Electron/Node ABI（见项目记忆）。

## 13. 里程碑（均属本次任务，按依赖排序交付）

1. **M1 派发底座解绑**：`spark_team`→`spark_orchestrate`（保留别名）+ worker 校验泛化为「允许 worker 集合」；team 回归不破。
2. **M2 验收门槛 Gate**：契约起草 + 用户确认 + 不完整拒跑；goal/loop 接入。
3. **M3 编排者约束 + budget 下传**：硬约束工具集 + 可退化规则 + 预算树级覆盖。
4. **M4 工作流执行器**：拓扑序/派发/状态/重试/原子退化 → 并行/条件边/节点级模型 → 断点续跑持久化。
5. **M5 Checkpoint 修复**：UUID 锚点采集 + turn-based list + `rewindFiles` restore + 降级提示。
6. **M6 可观测 + 收尾**：全链路日志审计接入、端到端流程联调、文档刷新、测试补齐到 §3.A 基线。

## 14. 未决 / 风险

- `session.service.ts` 5850 行是单点枢纽，HIGH 风险；实现需小步提交 + 逐符号 impact。
- `spark_team` → `spark_orchestrate` 重命名需保留别名，避免破坏已配 team 的会话与预设。
- 编排者硬约束工具集的「可退化」判定边界（何时算「零成员/原子任务」）需在实现期定明确规则，避免误退化成主 agent 自己包办。
- `rewindFiles` 依赖会话可 resume 且 checkpointing 全程开启；还原语义仅覆盖宿主会话文件变更（team worker 不开 checkpoint）。
- 条件边表达式求值限定安全子集（键存在/相等/布尔），禁止任意代码执行。
- 本次范围大（6 个里程碑），单 PR 风险高；建议按里程碑分多次提交/PR，每个里程碑独立可验证。
