# 团队模式 A2A 深度协作升级方案

> 状态: 实施中 | 最后核对: 2026-07-04
>
> 目标：把当前"Host 单向调度 Member、Member 只能原路回复"的团队模式，升级为真正的多 Agent 协作——**成员之间可以互相对话、共享讨论上下文、跨多轮记住彼此说过什么**，同时保留"Host 是调度权威"的既定架构（不做成全自治蜂群）。
>
> 交给开发方 Agent 前必读：本文档基于对当前 `develop` 分支代码的实地核查（非仅凭旧文档推断），第六、七节的行号是核查时的近似位置——开工前务必用 `grep`/GitNexus 重新定位，因为 `apps/desktop/**` 与 `packages/agent-runtime/src/services/session.service.ts` 目前有其他 Agent 的并行未提交改动（见第九节"并发冲突警戒"），行号可能已漂移。

---

## 一、问题诊断（现状精确核查，非猜测）

用户报告的三个症状，逐一对应到代码里的确切原因：

### 症状 1：「成员分析完只能反向返回给主持人，无法和其他成员交互交流」

**根因**：当前 A2A 通道是纯 Hub-and-Spoke。

- 成员执行入口 `executeMemberTurn`（`packages/agent-runtime/src/services/session.service.ts`，约 3738 行起）里，成员的 system prompt 只有 `buildManagedAgentSystemPrompt(member, null)` + 环境变量脱敏段，**从未拼接任何团队花名册 / 协作说明**。
- 成员默认**没有** `spark_team` 工具。只有当会话 `teamConfig.allowNesting === true` 且当前调用深度 `memberDepth < maxDepth` 时，才会给成员注入一份"嵌套" `spark_team` MCP server（约 3816-3835 行）。而 `allowNesting` 默认 `false`，`maxDepth` 默认 `1`——绝大多数团队会话里，成员**物理上没有任何工具**可以联系别人。
- 即便手工把 `allowNesting` 打开，成员拿到的也只是跟 Host 一模一样的 `agent_dispatch` / `agent_dispatch_batch`，语义仍是"派发一个子任务、等结构化回执"，**不是**"发一条消息到共享讨论里"。没有花名册、没有共享上下文，成员根本不知道群里还有谁、聊到哪了。

### 症状 2：「一轮对话后，主持人发布新的讨论也没有继续触发下一轮」

**根因**：花名册 prompt 里对 Host 有一条明确的**收敛硬指令**（`buildTeamRosterPrompt`，约 5784-5819 行）：

> "Drive the session forward... Do NOT let the team loop, stall, or drift off-topic. If a dispatch is going in circles, stop and summarize for the user instead of dispatching again."

这条规则是为了防止早期版本的失控循环写的，但代价是模型被反复告诉"别再问了、赶紧收尾"，天然不适合"头脑风暴需要来回好几轮"的场景。且 SDK 一次 turn 内工具调用次数虽然理论上可以很多次（`DEFAULT_MAX_DISPATCHES_PER_TURN = 10`），但**没有"轮次"这个显式概念**——Host 没有工具可以说"第一轮结束，开始第二轮"，模型只能自己在自然语言里摸索，加上被明确要求"收敛"，实际表现就是问一轮就完事。

### 症状 3：「Agent 并不知道自己要调用什么工具调用其他 agent」

**根因**：与症状 1 同源——成员系统提示词里从没有"这是你的队友列表，这是联系他们的工具"这段话（`buildTeamRosterPrompt` 只有 Host 视角一个版本，从未以成员视角调用过）。工具就算挂载了，模型也没有被告知它的存在和使用场景。

### 附加结构性缺陷（用户未直接提到，但支撑不了"多轮长程协作"）

- **成员无记忆**：`executeMemberTurn` 里每次 dispatch 都是 `memberSdkSessionId = crypto.randomUUID()` + `continueSession: false`（约 3809、3860 行）——每次被调用都是全新 SDK 会话，成员对上一轮自己说过什么、别人说过什么**完全没有记忆**，只能看到当前这一条 `task.instruction`（`buildMemberUserMessage`，约 5837-5859 行只渲染 `instruction`/`inputs`/`attachments`/`expectedOutput`）。
- **值得注意的是，"@ 指定成员直答"路径已经解决了这个问题**：`isMentionTurn` 分支下用 `stableSdkSessionId = makeSdkRuntimeSessionId(sessionId, providerProfileId, model, agentAdapter, \`mention:${agent.id}\`)`（约 1172-1174 行）+ resume-safety 校验，实现了"重复 @ 同一个成员可以续上他自己的会话"。**这是本方案第 6.3 节"成员会话连续性"要复用的现成机制**，不需要从零发明。

### 症状 4：「团队模式调用 codex 配置类型的助手会失败」（用户 2026-07-03 反馈）

**根因（已实地核查，非猜测）**：`executeMemberTurn`（约 3738 行起）**完全无视成员的 `agentAdapter`，无条件用 Claude 执行器跑所有成员**。具体三处硬编码：

1. **执行器实例化写死**：约 4041 行 `const executor = new ClaudeSDKExecutor()`——不管 member 是 `claude-sdk`/`claude` 还是 `codex` adapter，永远走 ClaudeSDKExecutor。对比 Host 主循环（约 1603 行 `if (agentAdapter === 'claude-sdk' || agentAdapter === 'claude') {...} else { tryStartCodexCliTurn(...) }`）会按 adapter 分流，且 codex 路径还会用 `createCodexExecutorForConfig`（约 169-176 行）根据 `useLocalConfig`/`codexCliProvider`/`codexApiKind` 选 `CodexCliExecutor` / `CodexOpenAIExecutor` / `CodexSdkExecutor` 中的哪一个。**成员路径完全没有这套分流**。
2. **permissionMode 硬编码为 claude 体系**：约 3913 行 `const effectiveMemberMode = 'claude-auto' as SDKExecutorConfig['permissionMode']`。codex 执行器需要 `codex-auto`/`codex-full-access` 这族权限值，传 `claude-auto` 进去会让 codex 执行器在解析/应用权限时出错。
3. **provider config 解析只取 claude 字段**：约 3925-3932 行解构 `providerConfig` 时只取了 `defaultModel/model/apiEndpoint/haikuModel/sonnetModel/opusModel`，**完全没读 codex 必需的 `codexApiKind`、`codexCliProvider`、以及 `useLocalConfig` 标记**。Host 路径（约 1862-1920 行的 `codexConfig` 构造）读了这些字段，成员路径没读。结果：就算把执行器换对，config 里也没有 codex 需要的参数。

**为什么"一定失败"而不是"静默降级"**：codex 类型的 provider（如 OpenAI/Codex CLI）apiKey 模型、endpoint、甚至 CLI 调用方式都和 Anthropic 不同。ClaudeSDKExecutor 拿着 codex provider 的 apiKey 去打 Anthropic 接口（或本地 Claude CLI），认证/模型名/endpoint 全对不上，必然报错——这就是用户看到的"调用失败"。

**好消息**：三个 codex 执行器（`CodexCliExecutor`/`CodexOpenAIExecutor`/`CodexSdkExecutor`）都实现了 `onEvent(listener)` 接口（grep 确认），与 `ClaudeSDKExecutor` 的事件模型形制一致。`executeMemberTurn` 里那套 `executor.onEvent(event => { assistant_message / usage_update / agent_error / tool_call ... })` 监听逻辑**理论上可直接复用**——但实现时必须验证 codex 执行器实际发出的 `AgentEvent` 类型是否和 ClaudeSDKExecutor 一致（尤其 `team_member_message` 依赖的 `assistant_message` 事件、token 统计依赖的 `usage_update` 事件），不一致就要做事件适配。这是复用能否成立的关键验证点。

**这是本方案的前置依赖**：Phase C/D 都要在 `executeMemberTurn` 上动刀（注入花名册 prompt、改 SDK session 连续性），如果这个函数连 codex member 都跑不起来，后续 A2A 升级对 codex 用户毫无意义。故单列为 **Phase 0（前置修复）**，不与 A2A 协作升级耦合，可独立验证、独立合并。

---

## 二、与既有文档的关系（重要：先核对，避免重复造轮子）

| 文档 | 状态核查结论 |
|---|---|
| [团队模式开发.md](../docs/团队模式开发.md) | Phase 0-5 全部落地（Host↔Member 基础 dispatch、群聊 UI、嵌套执行、Inspector）。本方案在此基础上扩展，不改动其已交付部分的对外行为。 |
| [团队模式agent相互调用改造.md](../docs/团队模式agent相互调用改造.md) | 状态行写"实施中"（2026-06-19 核对），但实地核查发现**只有 Phase 2/3（`mentionAgentId` 协议字段 + `MentionPopover` 组件 + `isMentionTurn` 路由）已经落地**；Phase 1 提出的 `allowCallHost`、`resolveDispatchableAgents`、`buildTeamRosterPrompt` 双视角重构**全部未实现**（`grep allowCallHost` 全仓零命中）。**建议**：该文档 Phase 1 的残留范围（成员感知队友、Member→Host 回呼）由本方案的 Phase C/D 吸收并取代，原文档 Phase 1 章节应标记废弃、状态行改为指向本文档，避免两份文档同时声称拥有这块设计权。这不是本方案的强制交付物，但开发方 Agent 动工前应先处理这处文档冲突（更新旧文档状态行），否则会误导后续读者。 |
| [工作流循环节点设计方案.md](./工作流循环节点设计方案.md) | **不建议合并成一个功能**（语义不同：workflow loop 是"确定性子图重复执行"，本方案的多轮讨论是"Host 用工具自由决定要不要再来一轮"），但**两者共享同一条底层派发引擎**（`TeamDispatchService` 单例 + `createTeamMcpServer` + `executeMemberTurn`），必须协调开发顺序、不能各写各的互不通气。具体交叉点见第九节新增小节「与工作流循环节点方案的联动」。 |

---

## 三、目标与非目标

### 目标

1. **成员可以直接和其他成员对话**（广播 / 点对点 @），不必每次都绕回 Host 中转。
2. **多轮讨论有显式状态**：Host（以及后续可选地成员）可以推进"下一轮"，UI 上能看到轮次分界，而不是模型自己在文本里瞎猜要不要继续。
3. **成员在一次"讨论"内有记忆**：跨多次被调用，能记得自己和别人说过什么，不是每次从零开始的陌生人。
4. **成员知道自己能做什么**：拿到工具的同时必须拿到对应的花名册/使用说明 prompt。
5. **Host 仍是调度权威**：不做成完全自治、无人监督的多 agent 蜂群。是否发起讨论、是否推进下一轮、何时收尾，默认仍由 Host（背后是模型 + 现有工具审批链路）决定，只是把"决定权"从"prompt 里一句模糊的收敛指令"变成"有明确工具语义的显式动作"。
6. **不炸预算、不死循环**：新增能力必须比现状更强的防护，而不是打开一个无底洞。

### 非目标（本轮明确不做）

- **不做**跨用户消息边界的全自主循环（即"用户不发新消息，Agent 自己无限continue"）。仍然是"一次用户 turn 内，Host 可以驱动任意多轮内部讨论"，用户随时能看到进度、随时能打断。真正的自治多轮（类似 goal loop）留给 `feat/unified-orchestration-kernel` 分支的编排内核统一收敛，本方案不重复建设。
- **不做**成员间脱离事件总线的"私聊"通道——沿用现有原则（老文档十一节已定的原则，本方案继续遵守）：所有 Agent 间消息都进事件流、都可审计、都在 UI 可见。
- **不做**去掉 Host 的调度权限或允许成员单方面拉起新成员（成员集合仍由会话 `teamConfig.memberAgentIds` 圈定）。
- **不做**跨 session 的 Agent 调用。

---

## 四、总体设计

### 4.1 核心概念：共享讨论线程（Team Thread）

新增一个"讨论"维度，独立于单次 `team_dispatches` 记录：一次讨论（`discussionId`）从 Host 第一次注入 `spark_team` 工具开始，到 Host 调用收尾工具或会话结束为止，可以跨多个用户 turn。讨论期间产生的所有消息（Host 派发、成员回复、成员之间的对等消息）都追加进同一条**共享、可截断的时间线**，每次有人被调度执行时，把这条时间线（近 N 条或按 token 预算截断）渲染进它的 prompt，让它"知道群里聊到哪了"，而不是只看到孤立的一条 `instruction`。

### 4.2 新工具面：对等消息 `agent_message`

区别于现有 `agent_dispatch`（"派一个子任务、等结构化回执，用完即走"），新增 `agent_message`：

- 语义："在共享讨论里说一句话"，可以 `广播`（不填 target）或 `@ 某个成员`（填 `targetAgentId`，触发对方执行一次 turn 并把结果写回线程）。
- **任何**在讨论中处于"激活"状态的 Agent（Host、以及被赋予了该工具的 Member）都可以调用，不再局限于"只有 Host 能发起"。
- 执行机制复用现有 `TeamDispatchService.run`（校验、超时、取消、预算计数这些都不重新发明），但 caller 不再固定是 Host——`TeamDispatchRunContext.hostAgentId` 字段的语义从"会话 Host"放宽为"本次调用的发起者"（`团队模式agent相互调用改造.md` 第 3.4 节已经指出这个字段实际上早就是"发起者"语义，本方案把它坐实）。
- 回复内容除了返回给调用方的工具结果，**还要追加进共享线程**，这样"A 问 B，C 后来才被派发"时，C 也能看到 A 和 B 之前聊了什么，不需要 A 或 B 手动转述。

### 4.3 轮次控制：`team_round_advance` / `team_conclude`

给 Host（默认仅 Host，除非会话显式打开"成员也能推进轮次"）新增两个工具：

- `team_round_advance(summary)`：标记"当前轮结束"，把 `summary` 写入线程作为本轮小结，`roundIndex + 1`，emit `team_round_advanced` 事件，UI 画一条轮次分割线。调用后 Host 可以继续 `agent_dispatch` / `agent_message` 发起下一轮。
- `team_conclude(summary)`：标记讨论结束，emit `team_discussion_concluded`，之后再调度会被拒绝（除非用户发新 turn 重新开一场讨论）。

配合花名册 prompt 的改写（见 4.5），把"必须收敛、不许循环"的硬指令，换成"最多 N 轮（受 `teamConfig.maxDiscussionRounds` 约束，默认给个合理值如 6），每轮结束调用 `team_round_advance` 推进，觉得讨论出结果了就调用 `team_conclude` 收尾"——**给模型一个可操作的状态机，而不是一句模糊的道德劝诫**。这是修复症状 2 的关键：不是"允许无限循环"，而是"把循环这件事从模型的自由发挥，变成显式、可控、可观测的状态转移"。

### 4.4 成员会话连续性

复用 `isMentionTurn` 分支已经验证过的 `stableSdkSessionId` 机制（4.x 节提到的 `mention:${agent.id}` 命名规则），把它推广到 dispatch/message 路径：

- 引入 `discussionId`（讨论级唯一 ID，Host 首次进入团队编排时生成，随 turn 状态持久化）。
- 成员被 dispatch/message 时，`sdkSessionId` 改用 `makeSdkRuntimeSessionId(sessionId, providerProfileId, model, agentAdapter, \`team:${discussionId}:${member.id}\`)`，并复用现有 `sdkResumeSafe` + `previousPromptSnapshot` 校验逻辑判断是否能 `continueSession: true`。
- 效果：同一场讨论里，某个成员被反复 @ 或 dispatch 时，能在**自己的 SDK 会话**里保留连贯记忆（不需要每次都靠共享线程文本复述），共享线程负责"知道别人说了什么"，自身会话连续性负责"记得自己怎么想的、做到哪一步了"。两者互补。

### 4.5 花名册 Prompt 双视角重写

`buildTeamRosterPrompt` 拆成 Host 视角 / Member 视角两套文案（`团队模式agent相互调用改造.md` 5.5 节已经提出这个方向，本方案落地）：

- **Host 视角**：保留"你是主持人，负责协调"的定位，但把"CONVERGE, do NOT loop"改写成"用 `team_round_advance` 显式推进轮次，最多 N 轮，用 `team_conclude` 收尾"。
- **Member 视角**（这是当前完全空白、也是症状 3 的直接修复）：明确告诉成员——
  - 你在参与一场多 Agent 讨论，主题是 XXX（讨论开场白）。
  - 队友名单：谁是谁、擅长什么（复用现有 roster 渲染逻辑）。
  - 你可以用 `mcp__spark_team__agent_message` 直接跟队友说话（广播或 @ 某人），不必每次都等 Host 转达。
  - 防呆规则：不要对刚刚 @ 你的人做即时回 ping（防止 A→B→A→B 死循环，见 4.6）；单轮内你自己最多主动发起 M 条消息。

### 4.6 安全防护（比现状更严，不是更松）

| 风险 | 防护 |
|---|---|
| 成员间 ping-pong 死循环 | 沿用并强化现有 `dispatchCountByTurn`（仍按"每次 dispatch/message 一次"累加，上限沿用/收紧 `DEFAULT_MAX_DISPATCHES_PER_TURN=10`，讨论级再加一层 `maxMessagesPerDiscussion` 总量上限）；新增"不得对上一条消息的直接发送者做即时回 ping"的 prompt 规则 + 后端可选的时间窗硬拦截。 |
| 讨论轮数失控 | `teamConfig.maxDiscussionRounds`（默认 6，可配置，硬上限如 20），超过后端直接拒绝 `team_round_advance`。 |
| 成本失控 | 复用 `unified-orchestration-kernel` 分支已经在做的 `UsageLedgerRepository` 按会话累计成本预算方案（见该分支 M3 决策），不重复发明一套新的美元预算机制；`agent_message`/`team_round_advance` 走同一条 ledger。 |
| 共享线程无限增长撑爆 prompt | 线程渲染进成员 prompt 时按 token 预算截断（保留最近 N 条 + 每轮小结 `team_round_advance` 的 summary 作为压缩锚点，旧轮次只保留 summary 不保留逐条消息）。 |
| 成员越权升级权限 | 不变：成员权限固定 `claude-auto`（`executeMemberTurn` 现有逻辑），`agent_message`/新工具都不改变这条既有约束。 |
| 取消/超时 | 复用 `TeamDispatchService` 现有 `AbortController` + `cancelAll()` 机制，`agent_message` 触发的执行走同一套。 |

---

## 五、功能需求清单

| # | 需求 | 优先级 |
|---|---|---|
| FR-1 | 成员在获得团队协作能力时，system prompt 必须包含花名册 + 协作说明（否则视为需求未满足，这是当前最直接的 bug） | P0 |
| FR-2 | 新增 `agent_message` 工具，支持广播（无 target）与定向 @（`targetAgentId`），发起方不限于 Host | P0 |
| FR-3 | 新增共享讨论线程，任意被调度的 Agent 都能在 prompt 中看到线程内已有的消息（按预算截断） | P0 |
| FR-4 | 新增 `team_round_advance` / `team_conclude` 工具 + 对应事件 + UI 轮次分割线 | P0 |
| FR-5 | 成员在同一场讨论内跨多次调度保留 SDK 会话连续性（复用 `stableSdkSessionId` 机制） | P1 |
| FR-6 | 讨论级/轮次级/消息总量安全上限，可配置且有合理默认值 | P0（与 P0 功能同批，防止裸奔上线） |
| FR-7 | 前端：群聊气泡区分「Host→Member」「Member→Member」「Member 广播」三种来源，可视觉区分 | P1 |
| FR-8 | 团队配置（会话级 + 长期 `ManagedTeam`）新增 `maxDiscussionRounds`、`enablePeerMessaging`（默认是否开启对等消息，向后兼容默认可以是 `false`，逐步放量） | P0 |
| FR-9 | `团队模式agent相互调用改造.md` 遗留的 Member→Host 回呼场景，纳入 `agent_message` 的定向 @ 能力覆盖（@ 目标可以是 Host），不再单独维护 `allowCallHost` 开关 | P2 |
| FR-10 | Inspector / 团队配置面板暴露上述新开关，并有默认值兜底（老会话不炸） | P1 |
| FR-11 | **codex 兼容（前置）**：`executeMemberTurn` 必须按 member 的 `agentAdapter` 分流到正确的执行器（ClaudeSDKExecutor 或 `createCodexExecutorForConfig` 选出的 codex 执行器），permissionMode、provider config 字段（`codexApiKind`/`codexCliProvider`/`useLocalConfig`）一并对齐——否则团队模式下所有 codex 类型的成员/被 @ 的 codex 助手都会失败。详见第 6.8 节 | P0（前置） |

---

## 六、详细开发方案

> 以下文件路径/行号均为核查时（2026-07-03，`develop` 分支）的近似定位，开工前必须重新 `grep` 确认，尤其是 `session.service.ts`、`event-mapper.ts`、`ChatView.tsx`、`team-events.test.ts` 这几个文件当前有其他 Agent 的未提交改动。

### 6.1 协议层（`packages/protocol/src`）

- `events/index.ts`：
  - 新增 `TeamPeerMessageEvent`（type: `team_peer_message`，字段：`discussionId, senderAgentId, targetAgentId?, content, roundIndex`）。
  - 新增 `TeamRoundEvent`（`team_round_advanced` / `team_discussion_concluded`，字段：`discussionId, roundIndex, summary, hostAgentId`）。
  - `TeamA2ATask`/`TeamA2AReply` 不破坏性扩展：`TeamA2ATask` 加可选 `discussionId?`、`roundIndex?`。
- `ipc/index.ts`：`TeamModeConfig` 新增 `maxDiscussionRounds?: number`（默认 6）、`enablePeerMessaging?: boolean`（默认 `false`，见 6.6 灰度策略）；同步 `ManagedTeam` 接口。
- `schemas/index.ts`：对应 Zod schema 同步更新，注意上下限（如 `maxDiscussionRounds` 硬上限 20，防止用户配置出失控值）。

### 6.2 存储层（`packages/storage`）

新增 migration `042_team_discussions.sql`（当前最新是 `041_fullstack_workflow_node_prompts.sql`，实际编号以开工时仓库最新为准）：

```sql
CREATE TABLE IF NOT EXISTS team_discussions (
  id TEXT PRIMARY KEY,                  -- discussionId
  session_id TEXT NOT NULL,
  host_agent_id TEXT NOT NULL,
  topic TEXT,
  round_index INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','concluded','canceled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_thread_messages (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  sender_agent_id TEXT NOT NULL,
  target_agent_id TEXT,                 -- null = 广播
  round_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (discussion_id) REFERENCES team_discussions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_thread_discussion ON team_thread_messages(discussion_id, created_at);
```

新增 `packages/storage/src/repositories/team-discussion.repository.ts`（仿照现有 `team-dispatch.repository.ts` 的写法），提供 `createDiscussion` / `advanceRound` / `conclude` / `appendMessage` / `renderThreadForPrompt(discussionId, tokenBudget)`。

### 6.3 派发引擎（`packages/agent-runtime/src/services/team-dispatch.service.ts`）

- `TeamDispatchRunContext` 新增可选 `discussionId?: string`、`callerAgentId`（把当前隐含的"caller = ctx.hostAgentId"字段名语义坐实成"发起者"，不一定是会话 Host）。
- 新增 `runPeerMessage`（或复用 `run()` 加一个 `kind: 'dispatch' | 'message'` 参数）：`message` kind 在成功后额外调用 `team-discussion.repository` 的 `appendMessage`，并在 emit 的事件里带上 `discussionId`。
- 校验层保持"目标必须在 `allowedWorkerIds ∪ {host if targetable}`"这条底线不变，只是发起方不再限定为 Host。

### 6.4 成员执行入口（`session.service.ts` 的 `executeMemberTurn` / `createTeamMcpServer`）

- `createTeamMcpServer` 新增参数 `discussionId`、`threadPromptSnippet`（已渲染好的共享线程文本，调用方负责按预算截断）；工具集追加 `agent_message`，且当 `teamConfig.enablePeerMessaging === true` 时才把这个工具也注入到**成员**（不只是 Host）——这是 4.6 节"默认关闭、逐步放量"的落地点。
- `executeMemberTurn` 组装成员 system prompt 时改为：

  ```ts
  const memberSystemPrompt = joinPromptSections(
    buildManagedAgentSystemPrompt(member, null),
    buildTeamRosterPrompt(member, hostAgent, members, teamConfig, 'member', threadPromptSnippet),
    memberEnvPrompt || undefined,
  )
  ```

  这一行是修复症状 1/3 的核心改动——成员第一次真正拿到"我在一场协作里、队友是谁、怎么联系他们"的说明。
- `sdkSessionId` 按 4.4 节改用 `team:${discussionId}:${member.id}` 命名 + resume-safety 校验，`continueSession` 视校验结果为 `true`/`false`（不再永远 `false`）。

### 6.5 花名册 Prompt（`buildTeamRosterPrompt`）

按 4.5/4.3 节重写为双视角签名：

```ts
export function buildTeamRosterPrompt(
  caller: AgentItem,
  hostAgent: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  perspective: 'host' | 'member',
  threadSnippet?: string,
): string
```

- Host 视角：加入"用 `team_round_advance`/`team_conclude` 显式推进/收尾，最多 `teamConfig.maxDiscussionRounds` 轮"的说明，替换掉原来"必须收敛、别循环"的硬指令。
- Member 视角：花名册 + `agent_message` 使用说明 + 防呆规则（不即时回 ping 发起方）+ 若 `threadSnippet` 非空则拼进 `[Discussion So Far]` 段。

### 6.6 灰度与向后兼容

- `enablePeerMessaging` 默认 `false`：老会话、老 `ManagedTeam` 配置不受影响，行为与现状完全一致（保护现有用户）。
- 轮次机制（`team_round_advance`/`team_conclude`）本身**不依赖** `enablePeerMessaging`，只要会话是团队模式就注入给 Host——这部分修复症状 2，风险较低（只改 Host 侧，不新增成员权限），可以默认开启。
- Inspector / 长期团队编辑面板新增开关的默认态：`maxDiscussionRounds` 给合理默认值（如 6）而不是 unlimited；`enablePeerMessaging` 默认关闭，作为"实验性"标注呈现给用户，用户主动打开才生效。

### 6.7 前端（`apps/desktop/src/renderer`）

- `event-mapper.ts`：新增 `team_peer_message` / `team_round_advanced` / `team_discussion_concluded` 三类事件的归约逻辑，映射成新的 UI block kind（如 `TeamPeerMessageBlock`、`TeamRoundDividerBlock`）。
- `ChatView.tsx` / 相关 team 组件：
  - Member→Member 消息用不同气泡样式区分于 Host→Member（比如箭头方向、次要配色），复用现有 `TeamMemberBubble` 但加一个 `origin: 'host' | 'peer'` prop。
  - 轮次分割线：类似日期分割线的横线 + "第 N 轮"文字。
- `TeamInspectorSection.tsx`：新增 `maxDiscussionRounds` 数字输入、`enablePeerMessaging` 开关（标注"实验性"）。

### 6.8 codex 执行器兼容性修复（前置，独立于 A2A 升级）

落点全在 `packages/agent-runtime/src/services/session.service.ts` 的 `executeMemberTurn`（约 3738-4095 行）。核心思路：**把 Host 主循环里已经验证过的 adapter 分流逻辑，下沉/复用到成员执行路径**，而不是新发明一套。

具体改动：

1. **成员 adapter 解析**：在 `executeMemberTurn` 顶部取 `member.agentAdapter ?? session.agent_adapter`（与 Host 主循环 `isMentionTurn` 分支约 1164 行同样的取数方式），得到 `memberAdapter`。`session.agent_adapter` 兜底是必要的——单独配置了 member 但没显式设 adapter 时回落会话级。
2. **执行器分流**：把约 4041 行的 `const executor = new ClaudeSDKExecutor()` 改为按 adapter 选——`memberAdapter === 'claude-sdk' || memberAdapter === 'claude'` 时仍用 `ClaudeSDKExecutor`；否则调 `createCodexExecutorForConfig(sdkConfig)`（约 169 行已有的工厂函数，直接复用，不重写）。**关键：工厂函数依赖 `sdkConfig.useLocalConfig`/`codexCliProvider`/`codexApiKind` 三个字段，这三个字段当前 `sdkConfig` 里完全没有（见下一条），必须先补齐 config 组装**。
3. **provider config 解析补齐 codex 字段**：约 3925-3932 行的 `providerConfig` 解构，加上 `codexApiKind?: 'chat' | 'responses'`、`codexCliProvider`（类型参照 Host 路径）、以及判定 `useLocalConfig`（本地 CLI provider 标记，可用现成的 `isLocalCodexCliProvider` helper——约 57/7230 行）。然后在约 3988 行的 `sdkConfig` 对象里用展开运算符透传：
   ```ts
   ...(isLocalCli ? { useLocalConfig: true } : {}),
   ...(providerConfig.codexApiKind != null ? { codexApiKind: providerConfig.codexApiKind } : {}),
   ...(providerConfig.codexCliProvider != null
     ? { codexCliProvider: buildCodexCliModelProviderConfig({ /* 同 Host 路径约 1882 行 */ }) }
     : {}),
   ```
   这段和 Host codex config 构造（约 1862-1920 行）**几乎完全对称**——实现时直接对照抄，不要自己另想一套字段拼装方式。可考虑抽一个共享 helper `buildCodexMemberSdkConfigExtras(member, session, providerConfig)` 避免两处漂移，但这是优化项不是必须，首版可先内联。
4. **permissionMode 按 adapter 对齐**：约 3913 行 `effectiveMemberMode = 'claude-auto'` 改为：
   ```ts
   const effectiveMemberMode: SDKExecutorConfig['permissionMode'] =
     memberAdapter === 'claude-sdk' || memberAdapter === 'claude'
       ? 'claude-auto'
       : 'codex-auto'   // codex 成员同样"自动放行、不弹审批"，对齐 claude 成员的语义
   ```
   `hostIsFullAccess` 的判断（约 3911-3912 行已经包含 `codex-full-access`）不用改。
5. **事件接口兼容性验证（实现时必须实锤，不能只靠代码审查）**：`executeMemberTurn` 里 `executor.onEvent` 监听了 `assistant_message`/`usage_update`/`agent_error`/`tool_call`/`tool_result` 等事件（约 4055 行起）。三个 codex 执行器虽都有 `onEvent`，但**实际发出的事件类型集合是否和 ClaudeSDKExecutor 完全一致需要验证**——尤其 `team_member_message` 渲染依赖的 `assistant_message`（含 `mode`/`isFinal`/`segmentId` 字段）和 token 统计依赖的 `usage_update`。如果某个 codex 执行器不发 `segmentId` 或不发 `usage_update`，成员气泡可能无法分段或 token 统计缺失。首版至少要跑通 `CodexSdkExecutor`（最常见的 codex provider 类型），并记录另外两个执行器的兼容性现状。
6. **不要顺手改的东西**：`memberMcpServers` 拼装、`buildMemberUserMessage`、嵌套 `spark_team` 注入逻辑都不受 adapter 影响，保持不动。改的越少越安全。

**这个 Phase 和 Phase C/D 的关系**：Phase C（注入花名册 prompt）和 Phase D（会话连续性）都在改 `executeMemberTurn` 的 systemPrompt 组装和 sdkSessionId，Phase 0 改的是执行器选择和 config 组装——三者在同一函数但改动区域不重叠。建议 Phase 0 先做（它是最独立的 bug 修复），合并后 Phase C/D 基于已支持 codex 的代码继续改。如果排期上 Phase 0 和 A2A 升级同一批做，注意三者改同一函数时的合并顺序，建议 Phase 0 → Phase C → Phase D 串行提交，避免大范围冲突。

---

## 七、任务拆解

每个 Phase 独立可测、可合并，按依赖顺序排列。

### Phase 0 · codex 执行器兼容性修复（前置，0.5 天，独立可合并）

- [ ] `executeMemberTurn`：加 `memberAdapter` 解析、执行器按 adapter 分流（复用 `createCodexExecutorForConfig`）、provider config 补齐 `codexApiKind`/`codexCliProvider`/`useLocalConfig`、`effectiveMemberMode` 按 adapter 取 `claude-auto`/`codex-auto`。详见第 6.8 节。
- [ ] 验证 codex 执行器的 `onEvent` 事件兼容性（至少 `CodexSdkExecutor` 跑通；记录 CLI/OpenAI 两执行器现状）。
- [ ] **动工前必跑 `gitnexus_impact({target: "executeMemberTurn", direction: "upstream"})`**——该函数是团队/workflow/mention 三条路径的公共执行入口，CRITICAL 级别无疑，改动前确认 blast radius。
- **验收标志**：见 M-09/M-10。可独立于 A2A 升级先合并，让 codex 用户立即受益，不必等整个方案落地。

### Phase A · 协议 + 存储层（0.5–1 天）

- [ ] `packages/protocol`：新增事件类型、`TeamModeConfig` 新字段、Zod schema 同步。
- [ ] `packages/storage`：migration `042_team_discussions.sql`、`team-discussion.repository.ts` + 单测。
- **验收标志**：`pnpm --filter @spark/protocol typecheck`、`pnpm --filter @spark/storage test` 全绿；新表可通过 repository 增删查改讨论 + 线程消息。

### Phase B · 派发引擎扩展（0.5–1 天，依赖 A）

- [ ] `TeamDispatchService` 支持 `kind: 'message'`、`callerAgentId` 泛化、写入线程。
- [ ] 单测：peer message 成功路径、越权目标拒绝、讨论级消息总量上限拒绝。
- **验收标志**：`team-dispatch.service.test.ts` 新增用例全绿，覆盖 peer message 与现有 dispatch 两条路径不互相干扰。

### Phase C · 成员感知（花名册双视角 + prompt 注入）（1 天，依赖 A）

- [ ] `buildTeamRosterPrompt` 双视角重构。
- [ ] `executeMemberTurn` 注入成员视角 prompt（这是修复症状 1/3 的关键提交，建议单独一个 commit，方便 GitNexus impact 审查）。
- **验收标志**：单测断言"成员拿到 `spark_team` 工具时，其 system prompt 必含花名册段落"；手工构造一个开了 `allowNesting`/`enablePeerMessaging` 的会话，验证成员system prompt 内容。

### Phase D · 轮次控制 + 成员会话连续性（1 天，依赖 B/C）

- [ ] `team_round_advance` / `team_conclude` 工具接入 `createTeamMcpServer`。
- [ ] `executeMemberTurn` 的 `sdkSessionId` 改用 `team:${discussionId}:${member.id}` + resume-safety。
- [ ] Host 视角 prompt 替换"禁止循环"为"显式轮次"指令。
- **验收标志**：单测覆盖"轮次超限拒绝"；集成测试模拟一场 3 轮讨论，验证同一成员第 2、3 轮能"记得"自己第 1 轮说过什么（断言 SDK session 复用、非每次新建）。

### Phase E · 前端渲染（1 天，依赖 A，可与 B/C/D 并行）

- [ ] `event-mapper.ts` 新增事件归约。
- [ ] 群聊气泡 origin 区分 + 轮次分割线。
- [ ] `TeamInspectorSection` 新开关。
- **验收标志**：`webapp-testing`/`verify` 技能跑一遍真实窗口，构造一场开启 peer messaging 的讨论，肉眼确认气泡区分与轮次分割线正确渲染。

### Phase F · 安全防护收口 + 预算联动（0.5 天，依赖 B/D）

- [ ] 消息总量/轮次上限的后端硬拦截（不只是 prompt 劝阻）。
- [ ] "不即时回 ping 发起方"的规则：先上 prompt 层，评估效果后再决定是否加后端硬拦截。
- [ ] 接入 `UsageLedgerRepository` 预算联动（复用 `unified-orchestration-kernel` 分支已有机制，不重复实现，需要与该分支协调避免冲突，见第九节）。
- **验收标志**：构造一个刻意互相 @ 的对抗性 prompt 场景，验证在 N 条消息内被后端拦截而不是无限跑下去。

### Phase G · 灰度上线 + 回归 + 文档收尾（0.5 天，最后）

- [ ] 全量 `pnpm test` / `pnpm typecheck` / `pnpm lint`。
- [ ] `gitnexus_detect_changes()` 确认改动范围符合预期，无 HIGH/CRITICAL 意外扩散。
- [ ] 更新 [团队模式开发.md](../docs/团队模式开发.md) 补充章节；更新 [团队模式agent相互调用改造.md](../docs/团队模式agent相互调用改造.md) 状态行（标记其 Phase 1 范围已被本文档吸收/废弃）。
- [ ] CHANGELOG 补充用户可见变更。
- [ ] 手测矩阵（见第八节）全过。

---

## 八、验收标准

### 8.1 自动化

- 各 Phase 的单元测试（见第七节）全部通过。
- 全量 `pnpm test`、`pnpm --filter <涉及包> typecheck` 无新增失败。
- `gitnexus_detect_changes()` 在每次提交前跑一遍，确认受影响 symbol/流程与预期一致，出现 HIGH/CRITICAL 必须先向用户说明再继续（遵循 CLAUDE.md 铁律）。

### 8.2 手测矩阵（真实窗口，`verify`/`webapp-testing` 技能）

| # | 场景 | 期望 |
|---|---|---|
| M-01 | 老会话（未开 `enablePeerMessaging`），Host 正常 dispatch | 行为与现状完全一致，无回归 |
| M-02 | 开启 `enablePeerMessaging`，Host 布置头脑风暴任务给 3 个成员 | 成员之间能互相 @、能看到彼此发言，不需要每次经 Host 中转 |
| M-03 | Host 调用 `team_round_advance` | UI 出现轮次分割线，下一轮讨论正常发起 |
| M-04 | 讨论进行 `maxDiscussionRounds` 轮后 Host 再尝试推进 | 后端拒绝，Host 收到明确错误提示并据此收尾 |
| M-05 | 同一成员在讨论中被多次 @ | 成员的回答能体现出"记得"自己之前说过什么（而非从零开始） |
| M-06 | 构造 A↔B 互相 @ 的对抗场景 | 在消息总量/防呆规则下被拦截，不会无限跑、不会拖垮费用 |
| M-07 | 讨论中途用户点击取消 | 所有进行中的成员执行被 abort，session 回到 idle，UI 不卡死 |
| M-08 | 关闭 `enablePeerMessaging` 的团队，成员依旧无法互相调用 | 确认灰度开关真实生效，不是摆设 |
| M-09 | Host 是 claude 类型、某个 Member 是 codex 类型（OpenAI/Codex SDK provider），Host dispatch 该成员 | 成员正常执行、产出 `team_member_message` 气泡、token 统计正常，不再失败 |
| M-10 | 用户 `@` 一个 codex 类型的成员（mention 直答路径） | 该成员直接响应，不再报错（mention 路径虽然走 `tryStartCodexCliTurn`，但要确认成员级 codex 配置解析与 Host 级一致，不被 Phase 0 改动 regression） |
| M-11 | 全 codex 团队（Host + 所有成员都是 codex adapter）做一场小讨论 | 全链路 codex 执行无异常（这是 Phase 0 + A2A 升级联调的最终场景） |

---

## 九、注意事项与风险

1. **并发冲突警戒（高优先级，动工前必读）**：当前 `develop` 分支上有其他 Agent 在 `apps/desktop/**`（含 `event-mapper.ts`、`ChatView.tsx`、`TeamInspectorSection.less`、`team-events.test.ts` 等，恰好与本方案 Phase E 要改的文件重叠）以及可能仍在 `feat/unified-orchestration-kernel` 分支上有长期未提交改动。开工前：
   - 确认这些文件当前的工作区状态，不要用 `git add -A` 或 `git stash` 处理未提交改动（可能冲掉别人的在制品）。
   - 提交时精确 `git add <path>`，只加自己确实改过的文件。
   - 如果发现 `event-mapper.ts`/`ChatView.tsx` 已经被改得面目全非（例如为了其他需求重构了气泡渲染），Phase E 要基于当时的最新代码重新对齐，而不是死套本文档给出的旧行号。
2. **与 `feat/unified-orchestration-kernel` 分支的关系**：该分支正在把 goal/workflow/team 三套机制收敛成统一编排内核，其中 M3 已经在设计"编排者预算联动 `UsageLedgerRepository`"和"编排者硬约束工具集"。本方案 Phase F 的预算联动**应该复用该分支的成果，而不是重新实现一套**；如果该分支已合并 `develop`，直接对接其暴露的接口；如果尚未合并，需要和负责该分支的开发者协调改动顺序，避免两边都改 `createTeamMcpServer`/`session.service.ts` 同一批代码产生大范围冲突。
3. **`spark_team` 后续会重命名为 `spark_orchestrate`**（`unified-orchestration-kernel` 分支 M6 计划），本方案新增的 `agent_message`/`team_round_advance`/`team_conclude` 工具全限定名会跟着变，注意不要把工具名硬编码在多处、集中定义方便统一改名。
4. **"轮次"不是"自治循环"**：Phase D 的轮次机制仍然发生在**一次用户 turn 内**（SDK 一次 query 的多次工具调用），不是"用户不说话、Agent 自己无限跑下去"。如果后续要做真正跨 turn 的自治多轮讨论，那是 goal loop 编排内核的范畴，不在本方案内，避免范围蔓延。
5. **成员会话连续性（4.4/6.4 节）依赖的 `stableSdkSessionId`/resume-safety 机制目前只在 `isMentionTurn` 路径验证过**，推广到 dispatch/message 路径前，务必先看这条 resume 逻辑在"多个成员并发被调度、共享同一个 `discussionId`"场景下是否有交叉污染风险（不同成员的 `sdkSessionId` 因为都拼了 `member.id` 理论上互不冲突，但要写测试实锤，不能只靠代码审查）。
6. **对抗性 prompt 防护是概率性的，不是绝对的**：花名册里的"不要即时回 ping"规则是给模型的建议，不保证 100% 遵守，所以 Phase F 的后端硬拦截（消息总量/轮次上限）才是真正的安全底线，务必先做后端拦截、再做 prompt 层优化体验，顺序不能反。
7. **默认关闭灰度**：`enablePeerMessaging` 默认 `false`，除非产品侧明确决定这是要立刻全量的功能。避免"一上线所有团队会话成本突然上涨"的意外。
8. **与 [工作流循环节点设计方案.md](./工作流循环节点设计方案.md) 的联动（核查后新增，2026-07-03）**：两份方案表面看是两个功能（自由讨论 vs. 确定性图循环），但实地核查代码发现它们**共用同一个 `TeamDispatchService` 单例和 `createTeamMcpServer`/`executeMemberTurn` 调用链**——`workflow_run` 工具内部的 `runSingleDispatch`（`session.service.ts` 约 3226-3278 行）和本方案要改的 Host/Member 团队 dispatch 路径，最终都走同一个 `this.getTeamDispatchService().run(...)` 和同一个 `executeMemberTurn`。这意味着：
   - **不能合并成一个功能**：workflow loop 的循环体是"预先画好的固定子图，按拓扑序确定性重跑"，团队讨论是"Host 用工具在运行时自由决定跟谁说、说几轮"，两种控制流模型不同，硬凑成一套抽象只会让两边都变复杂。**结论：保持两份独立方案、两个独立工具面（`agent_message`/`team_round_advance` vs. workflow `loop` 节点），不做功能合并。**
   - **但必须联动处理，否则会出真实 bug**：
     1. Phase C 给 `executeMemberTurn` 注入的"团队花名册 + 协作说明" system prompt，**必须严格限定在"真实团队会话"场景**（`hasDispatchableTeamMembers === true` 且 `teamConfig.enablePeerMessaging === true`），**不能**在 workflow-only 场景下也注入——因为 workflow 场景会构造一份*合成* `teamConfig`（`session.service.ts` 约 1390-1398 行 `dispatchTeamConfig`，`memberAgentIds: [...enabledWorkflowWorkerIds]`）喂给同一套 `createTeamMcpServer`/`executeMemberTurn`。如果不加区分地按"只要有 `teamConfig` 就注入讨论 prompt"，workflow 循环体里被派发的 agent 节点会莫名其妙收到一段"你在参与团队讨论"的系统提示词，污染 workflow 的执行语义。**这是本方案 Phase C 实现时的强制验收点，不是可选优化。**
     2. Phase D 的成员 SDK 会话连续性（`team:${discussionId}:${member.id}`）目前只为"团队讨论"设计。如果 workflow loop 节点后续也想要"循环体内同一个 agent 节点跨迭代记住自己上一轮做过什么"，**不应该另起一套命名方案**，而应该把连续性 key 的生成逻辑抽成一个通用小函数（如 `buildMemberContinuityKey(sessionId, scope, memberId)`，`scope` 可以是 `team:${discussionId}` 或 `workflow-loop:${loopNodeId}`），两边共用。本方案 Phase D 实现时顺手做这个抽象，不要写死在 team 分支里，方便 loop 节点后续零成本复用。
     3. **共享预算/串行队列**：`TeamDispatchService` 的 `dispatchCountByTurn`（同一 turn 内所有 dispatch 累加，默认上限 10）和 `executionQueueByTurn`（同一 turn 内串行执行队列）是全局共享的——如果一次 turn 里同时有"团队多轮讨论"和"workflow loop 节点跑多次迭代"（理论上可能，比如一个 Agent 既挂了 workflow 又开了团队模式），两者会抢同一个预算计数器和同一条串行队列，互相顶占。目前两份方案都没有对这个交互场景单独设计，**开发时至少要写一个集成测试覆盖"team 与 workflow 同时触发 dispatch"场景，确认预算耗尽时报错信息不会互相误导（比如团队讨论只用了 3 次却因为 workflow loop 用掉另外 7 次而被拒绝，Host 不知道为什么）**。
   - **建议开发顺序**：两份方案改动的具体代码区域基本不重叠（本方案主要动 1330-1450/3738-3860/5784-5820 行区域，loop 节点主要动 3479/3548 行区域及新增 `case 'loop'` 分支），行级冲突概率低，但上面三条语义联动必须有一方先落地、另一方在其基础上对齐，不能两个 Agent 完全不通气地并行开发。谁先排期就谁先做，后做的一方开工前必须重读对方当时的最新代码。

---

## 十、开放问题（需要负责人在动工前拍板）

1. **`agent_message` 的执行成本**：定向 @ 一个成员会触发它跑一次完整 SDK turn（等同一次 dispatch 的成本），如果讨论是"3 人 6 轮自由发言"，成本可能是现状的数倍。是否需要一个更轻量的"纯文字表态"模式（不跑完整 SDK turn，只做文本层面的意见征集）？本方案默认按"每条消息都是一次真实 turn"设计，如果成本不可接受，需要重新设计一个更便宜的表态机制。
2. **轮次是否允许成员发起，还是只能 Host**：4.3 节默认只给 Host `team_round_advance`/`team_conclude`。如果产品期望更"民主"的讨论（成员也能喊"我觉得可以进入下一轮了"），需要额外设计投票/提议机制，本方案未覆盖，需要明确是否要做。
3. **`maxDiscussionRounds` 默认值 6 是否合理**：偏保守，具体数字建议由负责人根据真实头脑风暴场景的预期时长拍板。
4. **共享线程的可见范围**：当前设计是"讨论内所有被调度的 Agent 都能看到全部历史"，如果未来有"某些成员的发言应该保密、不给其他成员看"的需求，需要额外的可见性分组设计，本方案未覆盖。
