# 统一编排内核改造 — 执行交接文档（HANDOFF）

> 状态: [实施中] | 最后核对: 2026-06-30

**给接手的 agent**：这是一份自包含交接。你没有此前对话的上下文，本文件 + 下面两份文档即是全部所需。先通读本文件，再按「下一步：M4」执行。

- **设计 spec**：`docs/superpowers/specs/2026-06-30-unified-orchestration-kernel-design.md`
- **实现计划**：`docs/superpowers/plans/2026-06-30-unified-orchestration-kernel.md`（含 M1 详细、M2 详细、M3–M6 路线图）
- **分支**：`feat/unified-orchestration-kernel`（基于 `develop`）。**不要**直接在 develop 上做。

---

## 0. 一句话目标

把 Spark-Agent 现在三套各自为政的执行机制——**goal/loop**（单 agent Review→Act→Validate 循环）、**workflow**（现状仅把图拍平成 system prompt，无执行引擎）、**team A2A**（已有真派发 `TeamDispatchService` + `spark_team` in-process MCP 的 `agent_dispatch` 工具）——**收敛成一个统一编排内核**：编排者只负责「验收门槛 → 任务派发 → 结果验收 → 循环控制」，具体子任务交给 subagent / 其他 agent。最终要求：所有本地会话目标功能达到**生产可交付**（设计合理、架构稳定、流程完整、日志可观测、有测试）。

## 1. 已确认的设计决策（不要推翻，除非用户改口）

1. 统一编排内核（非分模块各改）。
2. 验收门槛 = **Agent 起草契约 + 用户确认**（非用户硬填、非纯软跳过）。
3. 编排者**默认硬约束**（工具集只剩 dispatch/validate/控循环）**+ 可退化**自执行。
4. Worker 来源 = workflow 节点显式 `agentId` 绑定真实 agent + `subagent` 节点用节点 config 生成临时 worker。
5. workflow **完整执行器**（含并行/条件边/断点续跑/节点级模型切换），本次一并做（原 Phase 2 并入）。
6. 代码还原点（checkpoint）按 SDK `rewindFiles` 真实模型重架；**不支持的场景隐藏入口**（非灰态）；还原仅覆盖宿主会话。
7. 生产基线（见 spec §3.A）。
8. 交付**按里程碑 M1–M6 分多次提交**，每里程碑独立可验证。
9. **M3 退化触发规则 = 按 worker 可用性**：会话有可派 worker（team 名单 / workflow 的 agent·subagent 节点）→ 编排者硬约束；无 worker → 退化为现状 solo 自执行（**保护现有 solo `/goal` 不退化**）。
10. **M3 预算控制方案 = 循环层按 ledger 总成本卡**：编排者循环每轮用 `UsageLedgerRepository`（有 `totalCostUsd`）按会话累计成本/时长/迭代卡 `budget`。worker 用量本就记进同一会话 ledger，故预算**自然覆盖整棵 worker 树**，**不改** `TeamDispatchService`、不需把美元成本塞进派发回执（`TeamA2AReply.usage` 只有 token+durationMs，无 cost）。

## 2. 执行方式（务必遵守）

- **Subagent-Driven**：每个 task 派一个 fresh general-purpose subagent（**不要**传 `model` 覆盖——本环境模型别名解析有问题，会失败；用默认模型）。subagent 完成后**两段 review**：先 spec 合规、再代码质量（小改动可由你直接审 diff 代替冷启 review 子代理，省成本）。
- **逐里程碑现制计划**：每个里程碑开工前，基于**当时真实代码**展开 bite-sized 步骤（前序里程碑落地后签名会变 + develop 并发改动）。
- **TDD**：失败测试 → 实现 → 通过 → 提交。

## 3. 并发冲突铁律（关键！）

develop 上有其他 agent 在并行改 bug，且**长期**在 `apps/desktop/**`（9+ 文件）留有未提交改动停在工作区。

- subagent 一律**精确 `git add <exact paths>`**，**严禁 `git add -A` / `git commit -am`**（曾因此把别人的 staged 文件裹进我们的提交）。
- **禁止** `git rebase` / `git stash`（工作区有他人未提交改动，会失败/干扰）。
- **绝不** stage / revert / 修改任何 `apps/desktop/**` 文件，除非该里程碑明确要改前端（M6）。
- subagent 开工前 `git status`，确认**自己要改的文件**无他人未提交改动叠加；若有 → 停下报 NEEDS_CONTEXT。
- 改代码遵循项目记忆「跳过检测-并发编辑时」：只验证自己改的文件（scoped vitest + scoped 思路），`tsc --noEmit` 若只报**既有无关错误**（已知：`scheduled-task.service.test.ts(192,44)` TS2322）就放行。

## 4. 已完成（M1 + M2 + M3 + M4A + M4B，team 全程不退化）

分支提交（新→旧，origin/develop..HEAD）：

| commit | 内容 |
|---|---|
| `43797f49` | **M4B-2** workflow `agent` 节点通过 `workflow_run` in-process MCP 工具真 dispatch |
| `ffbf3a1f` | **M4B-1** `executeWorkflowAgentPlan` 顺序执行显式 agent 节点并传递 `outputKey` state |
| `3cd33813` | docs M4B workflow agent dispatch 现制计划 |
| `db5de06e` | **M4A-2** `session.service.ts` 复用共享 workflow graph helper，保持现有 prompt 行为 |
| `3dd9a098` | **M4A-1** 新增 `workflow-executor.ts` 纯 helper + graph/input 单测 |
| `5a3ea1cc` | docs M4A foundation 现制计划 |
| `c071c2a4` | docs 记录 M3 完成与 M4 handoff |
| `3bf184c3` | **M3-B** team host 有真实 enabled member 时硬约束工具集；空 roster/solo 退化不变 |
| `4f2de1fb` | **M3-A** goal loop 每轮启动前强制全部 budget：迭代、成本、时长、连续失败、无进展 |
| `537f1deb` | docs 进度 |
| `7c5aaa54` | **M2-C/D** confirm/reject 方法 + `/goal confirm\|reject` 命令 + 待确认契约展示（命令测试 69 passed） |
| `20245641` | **M2-B2** `setGoal` 接门槛 + 契约旁路 handler + `emitGoalEvent` 拓宽 |
| `67008fc4` | **M2-E** 协议事件 `goal_contract_drafting`/`goal_contract_proposed` + `ProposedGoalContract` + `pending_contract` 状态 |
| `64976f42` | **M2-B1** 新模块 `goal-contract.ts`（`buildGoalContractDraftPrompt` + `parseGoalContractBlock`） |
| `ea4c5ae3` | **M2-A** `GoalRepository` 加 `pending_contract` 状态 + `updateContract()` |
| `ee62a10d` | docs M2 计划 |
| `addb3273` | **M1** `TeamDispatchService` 派发校验泛化为 `allowedWorkerIds`（缺省回落 team 名单） |
| `7ca9fce8` / `f392c558` | docs 计划/spec |

**M1 做了什么**：`TeamDispatchRunContext` 加 `allowedWorkerIds?: ReadonlySet<string>`；`run()` 校验改 `const effectiveAllowedIds = ctx.allowedWorkerIds ?? new Set(ctx.teamConfig.memberAgentIds)`。team 不传该字段→行为不变。这是 goal/workflow 复用派发引擎的地基。

**M2 做了什么**（后端 + CLI 全闭环，前端模态留 M6）：
- `/goal <objective>`（spark-loop 且无 `successCriteria`）→ `setGoal` 把目标置 `pending_contract` + 跑一次「契约起草」turn（`buildGoalContractDraftPrompt`），**不**启动循环。
- 起草 turn 的助手输出含 ```spark-goal-contract``` 块 → `updateGoalContractFromAssistantBlock`（仅 `pending_contract` 触发）解析 → `updateContract` 写入 → emit `goal_contract_proposed`（携带契约）。
- 现有 `updateGoalFromAssistantBlock`（仅 `active`）和 `continueGoalOrQueue`（仅 `active`）自动跳过 pending 态 → **不会误启动循环**。
- `/goal`（无参）若 `pending_contract` → 展示草拟验收标准 + 提示 `/goal confirm` / `/goal reject`。
- `/goal confirm` → `confirmGoalContract`：契约非空才转 `active` + `startGoalLoop`（空则拒绝、保持 pending）。`/goal reject` → `rejectGoalContract`：取消任何 active loop + `clearCurrent`。

**M3 做了什么**：
- `startGoalLoop` 在每轮启动前读 `UsageLedgerRepository.getSessionUsage(sessionId)`，强制 `maxBudgetUsd`；同时补齐 `maxRuntimeMinutes`、`maxConsecutiveFailures`、`noProgressLimit` 与原有 `maxIterations`。超限时只写 `stopped_by_budget` + emit `goal_budget_stopped`，不 append 新进度、不起新 turn。
- team host 仅在 `resolveTeamMembers(...)` 解析出至少一个 enabled member 时注入 `spark_team`；注入后 host SDK config deny `Task`、写入/编辑类工具和 `Bash`，迫使有 worker 的编排 turn 走 `agent_dispatch`。无 enabled worker 时不注入 MCP、不加 deny，保护 solo/空 roster 路径。
- GitNexus impact：`startGoalLoop` 与 `sendTurn` 均报 **CRITICAL**（影响 goal 控制、IPC/session 启动链）。本次以窄改 + scoped tests 控风险。

**M4A 做了什么**（foundation，不宣称 M4 完成）：
- 新增 `packages/agent-runtime/src/services/workflow-executor.ts`：纯函数封装 workflow graph normalization、拓扑排序、`agent` 节点 worker id 提取、上游 `outputKey` 输入投影。
- `session.service.ts` 已复用上述 helper，删除本地重复的 `normalizeWorkflowGraph` / `orderWorkflowNodes`，但现有 `buildWorkflowSystemPrompt` 仍保持拍平 prompt 行为，等待 M4B 接真 dispatch。
- scoped 验证：`pnpm --filter @spark/agent-runtime exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts`（16 passed）。

**M4B 做了什么**（explicit `agent` happy path 已落地，M4 仍未全部完成）：
- `executeWorkflowAgentPlan` 按拓扑序执行显式 `agent` 节点，跳过非 agent / 空 `agentId` 节点；节点 `config.prompt` 或 title 组成 instruction，并把非空 `outputKey` 写入 state 供下游 `inputs` 使用。
- Managed workflow host 若解析到至少一个 enabled 显式 workflow worker，则注入现有 `spark_team` in-process MCP server 的 `workflow_run` 工具；workflow-only 只暴露 `workflow_run`，team+workflow 同时暴露 `agent_dispatch` / `agent_dispatch_batch` / `workflow_run`。
- workflow dispatch 复用 `TeamDispatchService.run`，通过 M1 的 `allowedWorkerIds` 放行 workflow 绑定 worker；没有 enabled 显式 worker 时保持 flattened prompt fallback，且不新增 host 工具限制。
- `tryStartSDKTurn` 的 `allowedTools` 现在按实际 MCP server tools 放行，并保留未登记 server 的旧 dispatch 工具回退。
- scoped 验证：`pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts src/services/team-dispatch.service.test.ts src/services/team-roster-prompt.test.ts`（34 passed）。`tsc --noEmit` 仍只报既有无关 `scheduled-task.service.test.ts(192,44)` TS2322。
- GitNexus impact：`startTurn` / `createTeamMcpServer` / `tryStartSDKTurn` 为 **CRITICAL**；`buildWorkflowSystemPrompt` 为 LOW。提交前 `detect-changes --scope staged` 因 staged 区域含既有无关文件报 HIGH，最终 runtime 提交用 `git commit --only` 限定了两个 M4B 文件。

**验证现状**：M3 scoped 回归 `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/session-runtime-config.test.ts src/__tests__/services/session-goal-budget.test.ts src/services/team-dispatch.service.test.ts src/services/team-roster-prompt.test.ts` 全绿（29 passed）；M2 命令/storage 测试此前全绿。`tsc --noEmit` 仍有既有无关 `scheduled-task.service.test.ts(192,44)` TS2322，非本改造引入。

## 5. M3（编排者约束 + budget 下传）—— 已完成

> 设计 spec §「M3」、计划路线图「M3」对应。决策见本文件 §1.9、§1.10。

**M3 目标**：① 编排者循环层按会话 ledger 总成本/时长/迭代强制 `goal.budget`（决策 10）；② 当会话有可派 worker 时，编排者 turn 硬约束工具集为「只 dispatch/validate/控循环」，无 worker 退化为现状（决策 9）。

**M3 建议拆分（逐 task 现制 bite-sized）**：

- **M3-A 预算强制（循环层，相对隔离，先做）**
  - 落点：`session.service.ts` 的 `startGoalLoop`（约 line 3811 起，现仅卡 `maxIterations`）。
  - 加：每轮启动前读 `new UsageLedgerRepository(this.db).getSessionUsage(sessionId)`（返回含 `totalCostUsd`/token/recordCount；参照同文件 `getSessionUsageFromPersistence` 用法），按 `goal.budget.maxBudgetUsd`（USD）、`maxRuntimeMinutes`（用 goal.createdAt/进度时间）、`maxConsecutiveFailures`/`noProgressLimit`（从 progressLog 推）判定；超限 → `updateStatus('stopped_by_budget')` + emit `goal_budget_stopped`（已有此事件类型与状态），不再起新一轮。
  - 测试：可对纯判定逻辑抽函数后单测；或在 storage/服务层 mock ledger 验证超 USD/时长即停。
  - 注意：`maxRuntimeMinutes`/`maxConsecutiveFailures`/`noProgressLimit` 现在**完全没被强制**，本 task 一并补全（spec §3.A 流程完整）。

- **M3-B 编排者硬约束工具集（改 team turn 行为，热点+工具名敏感，谨慎）**
  - 落点：`session.service.ts` 构造 host turn 的 SDK 配置处（搜 `createTeamMcpServer` 在 line ~1327 的调用上下文、以及 `allowedTools`/`disallowedTools` 组装；team member 已有 `disallowedTools: ['Task']` 可参照）。
  - 设计：新增 helper `sessionHasDispatchableWorkers(sessionId, turnCtx)`——M3 阶段 worker 源仅 team（teamConfig.memberAgentIds 非空）；M4 再扩 workflow 节点。
  - 有 worker → host 的 SDK 配置收起文件写/执行类工具（用 `disallowedTools` 加 `Write`/`Edit`/`MultiEdit`/`Bash`/`NotebookEdit` 等，或 `allowedTools` 白名单只留 `mcp__spark_team__agent_dispatch*` + 读类 + 搜索）；保留 dispatch/validate(读/跑验证命令需谨慎，可保留 Bash 仅用于验证？——**这是要权衡的点**：硬约束若连验证命令都禁，编排者无法 validate。建议保留只读 + 验证用 Bash、禁文件写）。无 worker → 不动（现状全工具）。
  - **风险**：这会改变现有 team host 行为（host 不再能自己写文件，必须派发）。决策 9 已授权（team-with-members 即约束）。务必跑 team 回归。
  - 工具名以 SDK 实际暴露为准，subagent 要先核对 `claude-sdk-executor.ts` 里工具名/`disallowedTools` 用法，别凭空写。

**M3 依赖**：M1（派发泛化，已完成）。M3-B 的「worker 可用性」在 M4 会扩展到 workflow。

## 5.1 M4B 工作流 `agent` 节点真 dispatch happy path—— 已完成

M4 是最大里程碑，继续按 bite-sized 子计划推进；不要直接照路线图大块改。M4A foundation 与 M4B explicit-agent happy path 已完成，下一步建议：

1. 现制 `M4C` 计划文档，优先补 workflow 执行的失败/重试语义：`config.retryCount`、失败节点错误结构、dispatch 预算与用户可见审计事件。
2. 保持小步提交：先在 `workflow-executor.ts` 做可测试纯逻辑，再接 `session.service.ts` runtime 边界。
3. 条件边、并行分支、subagent 临时 worker、节点级模型切换、断点续跑仍拆到 M4D+，避免再次把 `session.service.ts` 改成不可审的巨块。

## 6. M4 / M5 / M6 路线图（到达时再现制详细计划）

- **M4 工作流执行器（最大）**：把 `buildWorkflowSystemPrompt`（`session.service.ts` ~line 5271，现把图拍平成 prompt）换成真执行器。拓扑序复用 `orderWorkflowNodes`；`agent` 节点（带 `config.agentId`）→ `agent_dispatch`；`subagent` 节点→节点 config 生成临时 worker 派发；`skill/tool/mcp/verify/approval/input/artifact` 原子节点→编排者自执行；`outputKey→inputs` 状态传递；`config.retryCount` 重试；并行分支（复用 `agent_dispatch_batch` + `config.parallelism`）；条件边（`WorkflowEdge` 加 `condition`，**仅安全子集求值**：键存在/相等/布尔，禁任意代码）；节点级模型切换（每节点独立 dispatch/executor）；断点续跑（新增 storage 的 workflow-run repository 落运行态，恢复跳过已完成节点）。worker 校验走 M1 的 `allowedWorkerIds`（传入该 workflow 的节点 agentId 集合）。`WorkflowNodeKind` 见 `packages/protocol/src/ipc/index.ts:2178`。
- **M5 Checkpoint 修复（独立，可插队）**：**根因**——`sdk/event-mapper.ts:260` 读 SDK 不存在的 `msg.checkpoint` → 永远空。SDK 真实模型：`enableFileCheckpointing:true`（host turn 已开）按 **user message UUID** 跟踪，恢复用 query 控制对象的 `rewindFiles(userMessageId,{dryRun})`（见 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2387`）。修法：①采集 SDK user-message UUID 持久化为 turn 锚点（`sdk/claude-sdk-executor.ts` + storage）；②`listSessionCheckpointsFromEvents`（`session.service.ts:4426`）改为基于会话历史 turn；③`restoreCheckpoint`（~4452）改调 `rewindFiles`（活跃会话用当前 query，非活跃先 resume）；先 dryRun 预览→确认→回滚；④不支持场景（team worker turn / checkpointing 关 / `canRewind=false`）**隐藏入口**并记审计日志；⑤移除死的 `msg.checkpoint` 分支。前端 `apps/desktop/src/renderer/design/components/CheckpointTimelinePanel.tsx`。
- **M6 可观测 + 收尾 + rename**：全链路（编排/派发/验收/循环/节点/checkpoint）接入现有日志审计；`spark_team`→`spark_orchestrate` 重命名 + 保留别名（破坏性，影响 `mcp__spark_team__*` 工具全限定名与已存预设，故推迟到此统一做）；**M2 前端契约确认模态**（ChatView，消费 `goal_contract_proposed` 事件 + 调 confirm/reject IPC，IPC 通道本次也在此补）；端到端联调；文档刷新（spec/plan 状态行）；测试补齐到 §3.A。

## 7. 关键代码地图

- 派发引擎：`packages/agent-runtime/src/services/team-dispatch.service.ts`（`TeamDispatchService.run`、`TeamDispatchRunContext`、`allowedWorkerIds`、`dispatchCountByTurn`、`DEFAULT_MAX_DISPATCHES_PER_TURN`）。
- 核心枢纽（5850+ 行，HIGH 风险，窄改）：`packages/agent-runtime/src/services/session.service.ts`
  - `setGoal`(~3786) / `confirmGoalContract`·`rejectGoalContract`(~3828) / `controlGoal` / `startGoalLoop`(~3811) / `continueGoalOrQueue`(~3707) / `updateGoalFromAssistantBlock`(~3716) / `updateGoalContractFromAssistantBlock`(新增) / `emitGoalEvent`(~3878)
  - `createTeamMcpServer`(~3002)、host turn 调用点(~1327)、member 执行 `executeMemberTurn`(~3146)
  - `buildWorkflowSystemPrompt`(~5271)、`orderWorkflowNodes`、`getAllowedMcpServerIds`(~5341)
  - deps 注册两处（~650、~800）：goal 方法都要在两处接线
  - ledger：`getSessionUsageFromPersistence`（`UsageLedgerRepository.getSessionUsage` 用法参照）
- 契约纯函数：`packages/agent-runtime/src/services/goal-contract.ts`
- goal 存储：`packages/storage/src/repositories/goal.repository.ts`（`GoalStatus`、`ACTIVE_STATUSES`、`updateContract`、`updateStatus`、`clearCurrent`、`getCurrent`、`appendProgress`）
- 协议事件：`packages/protocol/src/events/index.ts`（`GoalEvent`、`GoalEventType`、`ProposedGoalContract`、`TeamA2AReply`）
- 命令：`packages/agent-runtime/src/core/command-registry.ts`（`CommandDeps` 接口 ~143、`/goal` handler ~603）
- 工作流类型：`packages/protocol/src/ipc/index.ts:2178`（`WorkflowNodeKind`/`WorkflowNode`/`WorkflowEdge`/`WorkflowGraph`/`WorkflowItem`）

## 8. 已知遗留 / 注意

- **既有 bug（不在范围，待后续）**：`session.service.ts` ~2130/2133 处 `updateGoalFromAssistantBlock` 被重复调用两次（同一 content）。M2 未动它（保持原样）。后续可单独修。
- `tsc --noEmit` 有一个**既有无关**错误 `scheduled-task.service.test.ts(192,44) TS2322`，非本改造引入，放行。
- `spark_team`→`spark_orchestrate` 重命名推迟到 M6（M1 计划已注明）。
- M2 前端契约模态推迟到 M6（后端+CLI 已闭环）。
- gitnexus MCP 当前**未连接**；CLI 可用。用 `npx gitnexus impact --repo /Users/zhangyang/spark_ai_project/Spark-Agent ...` 和 `npx gitnexus detect-changes --repo /Users/zhangyang/spark_ai_project/Spark-Agent --scope ...` 作为补偿。
- storage 测试本地需 better-sqlite3 切 Node ABI（项目记忆「Storage 测试 ABI 切换」）。

## 9. 立即可执行的第一步

1. `git fetch origin develop`（**不要** rebase，工作区有他人未提交改动）。
2. 读 §5.1、M4B completion record，以及 `docs/superpowers/plans/2026-06-30-unified-orchestration-kernel-M4B-workflow-agent-dispatch.md`，基于当前代码现制 M4C bite-sized 计划。
3. 派一个 fresh general-purpose subagent（**不带 model 覆盖**）执行 M4C 第一小步；精确 `git add <exact paths>`。
4. 每个小步后审 diff（spec 合规 + 质量）并跑 scoped tests；再进入下一个 M4 子任务。
