# 团队模式 A2A 深度协作升级 · 实施文档

> 状态: 已落地 | 最后核对: 2026-07-04
>
> 收尾核对（2026-07-04，Phase G）：0a/0b/A/B/C/D/E/F 全部合入 develop（关键 commit：`8787adba3` 0a、`433d68a86`+`268b71bdb` 0b、`0d2712283` A、`ac5905ef1` B、`9ada968e5` C-1、`304307ec5` C-2+D+E+F 合并落地）。`@spark/protocol` / `@spark/storage` / `@spark/agent-runtime` / `desktop` typecheck 全绿；`team-dispatch.service.test.ts`、`team-roster-prompt.test.ts`、`session-team-reply-format.test.ts`、`session-runtime-config.test.ts`、`team-events.test.ts`、`team-member-bubble.test.tsx`、`team-dispatch-card.test.tsx`、`event-mapper.test.ts` 全绿。仓库既有环境失败（`@emoji-mart/data` JSON import 属性、`better-sqlite3` electron/node ABI、`@spark/desktop-dev` package.json 名称漂移）与本次改动无关，见 memory `storage-tests-better-sqlite3-abi`。手测矩阵 M-01~M-16 待在真实窗口按 CHANGELOG 逐条走查；预算联动已复用 `UsageLedgerRepository`（Phase F 已接入，非"留 TODO"）。
>
> 本文档是 [团队模式A2A深度协作升级方案.md](./团队模式A2A深度协作升级方案.md)（下称"原方案"）的**实施版**：在原方案基础上做了二次代码实地核查、修正了行号与迁移编号、**新增了一个原方案漏掉的 codex 阻断性问题（0b：in-process MCP 对 codex 不可见）**，并对若干开放问题直接拍板。开发方 Agent 以本文档为唯一执行依据；与原方案冲突时以本文档为准。
>
> **审查方**：本文档作者（另一 Agent 会话）将在开发完成后做验收审查，验收标准见第六节，请逐条自证（提供测试输出 / grep 证据，不接受"应该没问题"式汇报）。

---

## 一、说明（背景 · 定位 · 与原方案的差异）

### 1.1 要解决什么

当前团队模式是纯 Hub-and-Spoke：Host 单向 dispatch 成员，成员只能原路回复、互相不可见、无记忆、不知道自己有什么协作工具；Host 被 prompt 硬指令要求"收敛、别循环"导致多轮讨论跑不起来；codex 类型成员被无条件用 ClaudeSDKExecutor 执行必然失败。本次升级目标：

1. **codex 全面适配（最高优先级，用户明确要求往前排）**——codex 成员可被 dispatch、codex Host 可以调度团队。
2. **成员互相可见、可对话**（共享讨论线程 + `agent_message` 工具）。
3. **多轮讨论显式状态机**（`team_round_advance` / `team_conclude`），替代"道德劝诫式收敛指令"。
4. **成员讨论内记忆**（复用 mention 路径已验证的 stable SDK session 机制）。
5. Host 仍是调度权威，不做全自治蜂群；所有消息进事件流可审计。

### 1.2 竞品差异化定位（为什么这样设计能领先）

市面多 Agent 产品（AutoGen/CrewAI 类框架、各桌面端"团队"功能）普遍两个极端：要么纯串行编排（成员互不可见），要么全自治群聊（不可控、成本黑洞）。本方案的差异点：

- **显式轮次状态机**：轮次是工具语义（可推进、可收尾、有上限、UI 有分割线），不是模型自由发挥——比自治群聊可控，比串行编排灵活。
- **双通道记忆**：共享线程（知道别人说了什么）+ 成员 SDK 会话连续性（记得自己怎么想的），两者互补，多数竞品只有前者。
- **异构执行器混编**：claude 与 codex adapter 的 Agent 在同一个团队里协作（0a+0b 落地后），这是多数单一 SDK 绑定的产品做不到的。
- **默认安全**：peer messaging 默认关闭灰度、后端硬限额、全消息可审计。

### 1.3 与原方案的差异清单（实施时以本节为准）

| # | 原方案内容 | 本文档修正/增强 |
|---|---|---|
| Δ1 | 迁移编号 `042_team_discussions.sql` | **042/043 已被并行开发的记忆系统占用**（`042_memory_v2_temporal_fts.sql`、`043_memory_entities.sql`），新迁移从 **044** 起，且开工时必须再 `ls packages/storage/migrations/ | sort | tail` 确认最新编号 |
| Δ2 | codex 适配只覆盖"成员执行器分流"（原 Phase 0） | 拆成 **0a（成员执行器分流）+ 0b（spark_team 对 codex 的 HTTP 桥接）**。0b 是原方案完全没发现的阻断性问题，见 2.2 |
| Δ3 | `agent_message` 广播与定向 @ 都触发目标执行完整 turn（开放问题 1 悬而未决） | **拍板**：广播 = 只写线程不触发任何执行（零额外成本）；定向 @ = 触发目标一次完整 turn。成本可控且语义清晰，见 4.2 |
| Δ4 | 开放问题 2（成员能否推进轮次） | **拍板**：首版仅 Host 可调 `team_round_advance`/`team_conclude`，不做投票机制 |
| Δ5 | 开放问题 3（默认轮数） | **拍板**：`maxDiscussionRounds` 默认 6，硬上限 20 |
| Δ6 | 开放问题 4（线程可见性分组） | **拍板**：首版全员可见，不做保密分组 |
| Δ7 | 行号（约 3738 / 4041 / 5784 等） | 已按 2026-07-03 develop 重新核定，见 2.1；但仓库有并行改动，**开工时仍须重新 grep** |
| Δ8 | 并发警戒只提 unified-orchestration-kernel 与 desktop 前端 | 新增：**记忆系统 Agent 正在改 `session.service.ts` 与 `packages/agent-runtime/src/services/memory/**`（git status 可见未提交改动）**，规则见 7.1 |

原方案的第四节（总体设计）、第九节第 8 条（与工作流循环节点的三条语义联动）依然全部有效，本文档不重复抄写，实施前必须读原方案对应章节。

---

## 二、代码核查结论（2026-07-03 实测，开工时需复核）

### 2.1 关键符号定位（`packages/agent-runtime/src/services/session.service.ts`）

| 符号 | 行号（近似） | 现状 |
|---|---|---|
| `createCodexExecutorForConfig` | 171 | 已有工厂，按 `useLocalConfig`/`codexCliProvider`/`codexApiKind` 选 3 个 codex 执行器，直接复用 |
| Host 主循环 adapter 分流 | ~1600s（`agentAdapter === 'claude-sdk' || 'claude'` 分支） | Host 有分流，成员没有 |
| mention 稳定会话 ID | 1180 `makeSdkRuntimeSessionId(..., \`mention:${agent.id}\`)` | Phase D 复用的现成机制 |
| `createTeamMcpServer` | 3404 | in-process（`createSdkMcpServer`，type 'sdk'）server，名字保留 `spark_team` |
| `executeMemberTurn` | 3943 | 三处硬编码：`effectiveMemberMode = 'claude-auto'`（~3968）、providerConfig 只解构 claude 字段（~3981）、`new ClaudeSDKExecutor()`（~4106） |
| `buildTeamRosterPrompt` | 5989 | 单视角（仅 Host），签名 `(host, members, teamConfig)` |
| `buildMemberUserMessage` | 6042 | 只渲染 instruction/inputs/attachments/expectedOutput |

其余：`TeamModeConfig` 在 `packages/protocol/src/ipc/index.ts:2082`（尚无 `maxDiscussionRounds`/`enablePeerMessaging`）；repository 参考 `packages/storage/src/repositories/team-dispatch.repository.ts`。

### 2.2 【新发现·阻断级】codex 执行器丢弃 in-process MCP server

三个 codex 执行器把 MCP 配置传给 codex 进程时**显式跳过 type 'sdk' 的 server**：

- `packages/agent-runtime/src/sdk/codex-sdk-executor.ts` `buildCodexMcpConfig`：`if (server.type === 'sdk') continue`
- `codex-cli-executor.ts` 同款逻辑；`codex-openai-executor.ts` 只渲染一个 MCP 名字清单提示，无真实连接。

而 `spark_team` 恰恰是 in-process sdk server（`session.service.ts:3403` 注释明说"需要在同进程内直接回调 dispatcher"）。后果：

- **codex Host 在团队模式下拿不到任何 `spark_team` 工具**（`session.service.ts:2140` 把 server 塞进 mcpServers，codex 执行器直接丢弃）→ codex Host "有团队但永远不调度"。goal/workflow 走同一个 server，同样对 codex Host 失效。
- 即便 0a 修好 codex 成员执行，**codex 成员也无法参与 peer messaging / 嵌套 dispatch**（同理拿不到工具）。

**修复方向（0b）**：把 `spark_team`（以及未来 `agent_message` 等）对 codex 侧改为**本机 HTTP 桥接**——主进程起一个 streamable HTTP MCP server（监听 `127.0.0.1` 随机端口 + 每会话随机 Bearer token），内部直接调用与 in-process server 相同的 tool handler；codex 执行器的 `buildCodexMcpConfig` 已支持 `url + headers` 型 server，无需改执行器。详见 4.1。

**根因定性与波及范围（2026-07-03 补充核查）**：这不是"codex 不支持 MCP"——Codex CLI/SDK 原生支持 stdio 与 url 两种 MCP transport（`spark_search`/`spark_debug` 都是 stdio 子进程形态，codex 会话里工作正常）。真正的限制是：type 'sdk' 的 in-process server 本质是**主进程内的 JS 闭包回调**，只有同进程运行的 ClaudeSDKExecutor 消费得了；codex 是独立子进程，闭包物理上传不过去。仓库里所有 in-process server 都受此影响：**`spark_team`、`spark_canvas`（画布 47 工具）、`spark_memory`（search_memory/recall_memory）**——实测 codex 主循环路径（`tryStartCodexCliTurn` 附近，~2685 行）也确实从未挂载这三者，即**单 codex 会话今天就没有画布和记忆工具**。因此 0b 的桥接必须做成**通用组件**（见 4.1 第 1 条），本期只接 `spark_team`，但 canvas/memory 后续可零改造接入。

**现成先例**：`spark_debug` 已经验证了同构模式——主进程长驻 `DebugLogServer`（127.0.0.1:port，跨 turn 存活），MCP 侧只是一个 stdio 瘦桥接子进程把工具调用代理到该 HTTP 端口（`resolveDebugMcpServer`，~3096 行）。0b 实现时优先参照这套已上线的写法（stdio 瘦桥接或直接 url 型二选一，实现者按工程量取舍；url 型省掉桥接脚本，但 stdio 形态在本仓库已被验证跨平台可用）。

### 2.3 codex 执行器事件兼容性（已实测 grep，比原方案的"待验证"前进一步）

三个执行器实际 emit 的事件类型：

| 事件 | CodexSdk | CodexCli | CodexOpenAI |
|---|---|---|---|
| `assistant_message` | ✅ | ✅ | ✅ |
| `usage_update` | ✅ | ✅ | ✅ |
| `agent_error` | ✅ | ✅ | ✅ |
| `tool_call` / `tool_result` | ✅ | ✅ | ❌（无工具事件） |

结论：`executeMemberTurn` 的 `onEvent` 监听逻辑对三者都基本可复用；剩余验证点收窄为——`assistant_message` 的 `segmentId`/`isFinal`/`mode` 字段语义是否与 ClaudeSDKExecutor 一致（影响成员气泡分段渲染）。0a 验收时必须给出实测结论。

### 2.4 executeMemberTurn 是公共入口（CRITICAL）

团队 dispatch、workflow_run 节点派发、嵌套团队三条路径都汇到 `executeMemberTurn`。**每个动它的 commit 前必须跑 `gitnexus_impact({target: "executeMemberTurn", direction: "upstream"})` 并在汇报中附 blast radius**（CLAUDE.md 铁律）。

---

## 三、功能需求

| # | 需求 | 优先级 | 阶段 |
|---|---|---|---|
| FR-0a | codex 成员可被 dispatch：`executeMemberTurn` 按 `member.agentAdapter ?? session.agent_adapter` 分流执行器、permissionMode、provider config（`codexApiKind`/`codexCliProvider`/`useLocalConfig`） | **P0 前置** | 0a |
| FR-0b | codex Host 可用团队工具：`spark_team` 提供 127.0.0.1 HTTP 桥接形态，codex adapter 的 Host/成员经桥接获得与 claude 侧等价的工具面 | **P0 前置** | 0b |
| FR-1 | 成员获得团队协作工具时，system prompt 必含花名册 + 协作说明（Member 视角） | P0 | C |
| FR-2 | `agent_message` 工具：广播（只写线程，不触发执行）/ 定向 @（触发目标一次 turn），发起方不限 Host；`enablePeerMessaging=true` 时才注入给成员 | P0 | B/C |
| FR-3 | 共享讨论线程：持久化（新表）、按 token 预算渲染进被调度者 prompt（近 N 条 + 历史轮 summary 锚点） | P0 | A/B |
| FR-4 | `team_round_advance` / `team_conclude` 工具 + `team_round_advanced`/`team_discussion_concluded` 事件 + UI 轮次分割线；仅 Host 可调 | P0 | D/E |
| FR-5 | 成员讨论内 SDK 会话连续性：`team:${discussionId}:${member.id}` 稳定 session id + resume-safety 校验 | P1 | D |
| FR-6 | 安全上限（后端硬拦截）：`maxDiscussionRounds`（默认 6，硬上限 20）、`maxMessagesPerDiscussion`（默认 40）、沿用 `DEFAULT_MAX_DISPATCHES_PER_TURN` | P0 | B/F |
| FR-7 | 前端气泡区分 Host→Member / Member→Member 定向 / Member 广播三种来源 | P1 | E |
| FR-8 | `TeamModeConfig` + `ManagedTeam` 新增 `maxDiscussionRounds?`、`enablePeerMessaging?`（默认 false）；Inspector/团队面板暴露开关，老会话零迁移成本 | P0 | A/E |
| FR-9 | Member→Host 回呼由 `agent_message` 定向 @（目标可为 Host）覆盖，不做 `allowCallHost` | P2 | B |
| FR-10 | 工具名集中定义（单一常量模块），为 `spark_team → spark_orchestrate` 改名预留 | P1 | A |

---

## 四、开发方案

### 4.0 Phase 0a · codex 成员执行器分流

落点全在 `executeMemberTurn`。照抄原方案 6.8 节的 6 条改动（成员 adapter 解析 → 执行器分流复用 `createCodexExecutorForConfig` → providerConfig 补齐 codex 三字段（含 `isLocalCodexCliProvider` 判定与 `buildCodexCliModelProviderConfig` 构造，对照 Host 路径 codexConfig 组装段直接抄）→ `effectiveMemberMode` 按 adapter 取 `claude-auto`/`codex-auto` → 事件兼容性验证（2.3 已收窄为 segmentId/isFinal 语义验证）→ 其余一律不动）。

补充两点原方案没写的：

- `executeMemberTurn` 头部注释（"成员统一经 ClaudeSDKExecutor 执行，故取 claude-auto"）在改完后已不成立，同步改注释。
- codex 成员的 `disallowedTools: ['Task', ...]` 语义对 codex 执行器是否生效需确认（codex 没有内置 Task 工具，大概率是无害 no-op，确认即可，不必修）。

### 4.1 Phase 0b · spark_team HTTP 桥接（codex Host/成员工具面）

**目标**：codex adapter 的 Agent 拿到与 claude 侧完全等价的 `spark_team` 工具，且工具执行仍回到主进程同一套 handler（`runSingleDispatch`/未来的 `agent_message` handler），事件流、预算、审计零分叉。

**设计**：

1. 新增 `packages/agent-runtime/src/services/team-mcp-http-bridge.ts`（**做成通用组件**，命名建议 `sdk-mcp-codex-bridge` 之类的中性名）：
   - 用 `@modelcontextprotocol/sdk` 的 Streamable HTTP transport 起一个 `http.createServer`，绑定 `127.0.0.1`、端口 0（随机），每个会话（或每次 turn）生成随机 Bearer token，请求头不匹配直接 401。实现可参照 `spark_debug` 的 `DebugLogServer` + stdio 瘦桥接先例（见 2.2 补充核查段）。
   - **不重写工具逻辑**：把 `createTeamMcpServer` 重构为"先构造 tool 定义数组（name/schema/handler）"，in-process sdk server 与 HTTP 桥接共用这份定义。这是本 Phase 的核心重构，避免两份工具实现漂移。
   - **通用性要求**：桥接组件的接口按"传入任意 tool 定义数组 + 会话上下文 ⇒ 返回可挂载的 url 型 SDKMcpServerConfig"设计，不写死 team 语义——`spark_canvas`/`spark_memory` 对 codex 的同源缺口（见 2.2）后续直接复用本组件接入，本期不接但不留死路。
2. 注入点：Host 主循环与 `executeMemberTurn` 里，若目标 adapter 是 codex 且需要团队工具，则不塞 sdk server，改塞 `{ url: 'http://127.0.0.1:{port}/mcp', headers: { Authorization: 'Bearer …' } }` 型 server（codex 执行器的 `buildCodexMcpConfig` 已支持 url+headers，执行器零改动）。
3. 生命周期：turn 结束/会话取消时关停或吊销 token；进程内单例复用一个 HTTP server、按 token 路由到不同会话上下文均可，实现者自选，但必须保证**跨会话隔离**（token A 不能调到会话 B 的 dispatcher）。
4. `CodexOpenAIExecutor`（纯 chat-completions kind）没有 MCP 连接能力，**明确豁免**：该类型 Host 不支持团队模式，检测到时给用户可读报错，而不是静默无工具。

**为什么不做 stdio 子进程桥**：需要额外的进程间回调通道，复杂度高于 HTTP 且没有收益；codex 两个可用执行器都原生支持 url 型 MCP。

### 4.2 Phase A/B · 协议 + 存储 + 派发引擎

按原方案 6.1/6.2/6.3 执行，差异与细化：

- 迁移编号 **044 起**（开工时确认），表结构沿用原方案 6.2 的 `team_discussions` / `team_thread_messages` DDL。
- `agent_message` 两种形态（Δ3 拍板）：
  - **广播**（不填 `targetAgentId`）：仅 `appendMessage` 入线程 + emit `team_peer_message` 事件，**不触发任何成员执行**，工具立即返回成功。给模型的描述里写清楚"广播是异步留言，队友下次被调度时才会看到"。
  - **定向 @**（填 `targetAgentId`）：走 `TeamDispatchService.run` 完整链路（校验/超时/取消/预算计数），回复同时写入线程。
- `TeamDispatchRunContext` 增加 `callerAgentId`（坐实"发起者"语义）与 `discussionId?`。
- 消息计数：定向 @ 计入 `dispatchCountByTurn`；广播计入独立的 `maxMessagesPerDiscussion`（默认 40）计数，两者都在后端硬拦截。
- 工具名常量（FR-10）：新建 `packages/agent-runtime/src/services/team-tool-names.ts`（或就近常量模块），`agent_dispatch`/`agent_dispatch_batch`/`agent_message`/`team_round_advance`/`team_conclude`/`workflow_run` 全从这里引用。

### 4.3 Phase C · 成员感知（花名册双视角）

按原方案 6.4/6.5 执行。**强制验收点**（原方案第九节 8-1 条）：Member 视角 prompt **只在真实团队会话**注入（`hasDispatchableTeamMembers && teamConfig.enablePeerMessaging`），workflow 合成 teamConfig 场景（`dispatchTeamConfig`，`session.service.ts` ~1390s）绝不注入"你在参与团队讨论"文案——必须有单测断言 workflow 路径的成员 prompt 不含花名册段。

`buildTeamRosterPrompt` 新签名带 `perspective: 'host' | 'member'` 与可选 `threadSnippet`；现有单测 `team-roster-prompt.test.ts` 同步改造，Host 视角快照里的"CONVERGE do NOT loop"替换为显式轮次指令。

### 4.4 Phase D · 轮次控制 + 会话连续性

按原方案 6.4/4.3/4.4 执行，补充：

- 连续性 key 抽成通用函数 `buildMemberContinuityKey(scope, memberId)`（`scope` = `team:${discussionId}` 或未来 `workflow-loop:${loopNodeId}`），给工作流循环节点方案预留复用（原方案第九节 8-2 条）。
- `discussionId` 生成时机：Host 本次 turn 首次注入团队工具时创建 discussion 记录（state=active），随 turn 持久化；用户新 turn 若上一 discussion 未 conclude 则**延续同一 discussion**（这是"跨多个用户 turn 的讨论"语义的落点，注意与"轮次仍发生在单 turn 内"不矛盾——轮次推进只在 turn 内，但线程与成员记忆跨 turn 延续）。
- codex 成员的会话连续性：codex 执行器的 resume 机制与 claude 不同，首版**允许 codex 成员降级为无连续性**（每次新会话），在代码注释与验收报告中明示即可，不阻塞合并。

### 4.5 Phase E · 前端

按原方案 6.7 执行（event-mapper 归约、气泡 origin 区分、轮次分割线、Inspector 开关）。注意 `apps/desktop/src/renderer` 当前有并行未提交改动（`ChatView.tsx`、`TeamMemberBubble.tsx`、`AgentsView.tsx` 等），开工前先看工作区现状再定改法。

### 4.6 Phase F · 安全收口

按原方案 Phase F，预算联动 `UsageLedgerRepository` 之前先确认 `feat/unified-orchestration-kernel` 是否已合入 develop：已合入则直接对接；未合入则**本期只做消息/轮次硬限额，预算联动留 TODO 注释 + 在验收报告标注**，不要跨分支抄实现。

---

## 五、任务拆解

依赖关系：`0a → 0b →(可与 A 并行)→ A → B → C → D → F`；E 依赖 A，可与 B/C/D 并行。0a、0b 各自独立可合并，**先行交付**。

### Phase 0a · codex 成员执行（0.5 天）★首个交付物
- [ ] `gitnexus_impact executeMemberTurn`（upstream）跑通并记录 blast radius
- [ ] 成员 adapter 解析 + 执行器分流 + providerConfig codex 字段补齐 + permissionMode 对齐（4.0 节）
- [ ] 单测：mock provider config，断言 codex adapter 成员选中 codex 执行器且 config 含 `codexApiKind`/`codexCliProvider`/`useLocalConfig`；claude 成员行为不变
- [ ] 实测记录：`assistant_message` 分段字段兼容性结论（三执行器）

### Phase 0b · spark_team HTTP 桥接（1–1.5 天）★第二个交付物
- [ ] `createTeamMcpServer` 重构为共享 tool 定义（in-process 与 HTTP 两个形态消费同一份定义）——此重构本身需 `gitnexus_impact createTeamMcpServer`
- [ ] `team-mcp-http-bridge.ts`：127.0.0.1 + 随机端口 + Bearer token + 跨会话隔离 + 生命周期回收
- [ ] Host 主循环 / `executeMemberTurn` 按 adapter 选择注入形态
- [ ] `CodexOpenAIExecutor` Host 的可读报错路径
- [ ] 单测：token 错误 401、会话隔离、工具调用穿透到同一 dispatcher（可用真实 HTTP 请求打桥接端点断言）

### Phase A · 协议 + 存储（0.5–1 天）
- [ ] protocol：`TeamPeerMessageEvent`/`TeamRoundEvent`、`TeamModeConfig`+`ManagedTeam` 新字段、Zod schema（`maxDiscussionRounds` 上限 20）
- [ ] storage：迁移 `044_team_discussions.sql`（编号开工时确认）、`team-discussion.repository.ts`（createDiscussion/advanceRound/conclude/appendMessage/renderThreadForPrompt）+ 单测
- [ ] 工具名常量模块（FR-10）

### Phase B · 派发引擎（0.5–1 天）
- [ ] `TeamDispatchService`：`callerAgentId`/`discussionId`、`agent_message` 两形态（广播只写线程；定向走 run()）、`maxMessagesPerDiscussion` 硬拦截
- [ ] 单测：广播零执行、定向成功、越权目标拒绝、消息总量超限拒绝、与既有 dispatch 路径互不干扰

### Phase C · 成员感知（1 天）
- [ ] `buildTeamRosterPrompt` 双视角重构 + 既有测试改造
- [ ] `executeMemberTurn` 注入 member 视角 prompt（含 threadSnippet），**单独 commit**
- [ ] 单测：成员有团队工具 ⇒ prompt 必含花名册；workflow 合成 teamConfig ⇒ prompt 必不含花名册（强制验收点）

### Phase D · 轮次 + 连续性（1 天）
- [ ] `team_round_advance`/`team_conclude` 工具 + 事件 + 轮次上限后端拒绝
- [ ] `buildMemberContinuityKey` 抽象 + `executeMemberTurn` sdkSessionId 改造 + resume-safety
- [ ] Host 视角 prompt 换显式轮次指令
- [ ] 单测：轮次超限拒绝；多成员并发共享同一 discussionId 时 session id 不交叉污染；集成测试三轮讨论成员记忆连贯

### Phase E · 前端（1 天，可并行）
- [ ] event-mapper 三类新事件归约 + 单测
- [ ] 气泡 origin 区分、轮次分割线、Inspector 新开关（`enablePeerMessaging` 标"实验性"）

### Phase F · 安全收口（0.5 天）
- [ ] 硬限额兜底复查（对抗性互 @ 场景集成测试）
- [ ] 预算联动（视 unified-orchestration-kernel 合入状态，见 4.6）

### Phase G · 回归收尾（0.5 天）
- [ ] 全量 typecheck/lint + 涉及包测试；`gitnexus_detect_changes()`
- [ ] 更新 `docs/团队模式开发.md`、`docs/团队模式agent相互调用改造.md` 状态行（其 Phase 1 标记被本方案吸收）；两份 todo 方案状态行改"实施中/已落地"
- [ ] CHANGELOG；手测矩阵全过

---

## 六、验收标准

### 6.1 自动化（每 Phase 合并门槛）

- 各 Phase 单测全绿；全量 `pnpm --filter <涉及包> typecheck` 与 `pnpm lint` 无新增失败。
- 每次提交前 `gitnexus_detect_changes()`，受影响 symbol 与预期一致；HIGH/CRITICAL 必须先向用户说明。
- 验收汇报必须附：测试命令与输出摘要、关键断言的 grep 自证（例如成员 prompt 中花名册段落的实际渲染文本）。

### 6.2 手测矩阵（真实窗口）

沿用原方案 M-01 ~ M-11 全部场景，另增：

| # | 场景 | 期望 |
|---|---|---|
| M-12 | **codex Host**（CodexSdk provider）+ claude 成员，Host dispatch | codex Host 经 HTTP 桥接看到并成功调用 `agent_dispatch`，成员正常执行（0b 核心验收） |
| M-13 | 桥接端点安全：用错误/缺失 token 直接 curl 桥接地址 | 401，且无法触达任何会话上下文 |
| M-14 | CodexOpenAI（chat kind）Host 开团队模式 | 用户收到明确"该 provider 类型不支持团队编排"报错，非静默失联 |
| M-15 | 成员广播 `agent_message`（不填 target） | 立即返回、不触发任何成员执行；下一个被调度的成员 prompt 中能看到这条广播 |
| M-16 | workflow_run 派发的节点成员 | system prompt 无花名册/讨论文案（Phase C 强制验收点） |

M-09（claude Host + codex 成员）、M-10（@ codex 成员）、M-11（全 codex 团队）依赖 0a/0b，为 codex 适配的最终验收。

---

## 七、注意事项

### 7.1 并发开发警戒（最高优先级）

当前仓库同时有**记忆系统升级 Agent**在开发（git status 可见 `session.service.ts`、`memory-extraction.prompt.ts`、`memory-consolidation.*` 等未提交改动），前端 `ChatView.tsx`/`TeamMemberBubble.tsx` 等也有在制品。规则：

1. **禁止 `git add -A` / `git add .` / `git stash`**。提交前必看 `git diff --cached --name-only`，只 add 自己确实改过的文件，别把他人已 stage 的文件卷进 commit。
2. 本文档给的行号是核查时快照，**每次动手前重新 grep 定位**，不要盲改。
3. 若发现要改的函数正被并行改动（工作区 diff 与 HEAD 不一致且非自己所为），优先只动自己的区域；typecheck/全量测试若因他人半成品失败，确认失败与自己改动无关后照常汇报，不要去"顺手修"别人的在制品。
4. 迁移编号、`session.service.ts` 行结构随时可能漂移——每个 Phase 开工时重新确认。

### 7.2 GitNexus 铁律（CLAUDE.md）

改任何 symbol 前 `gitnexus_impact`（`executeMemberTurn`、`createTeamMcpServer`、`buildTeamRosterPrompt`、`TeamDispatchService.run` 均为多路径公共入口，预期 HIGH/CRITICAL，需先向用户报 blast radius）；提交前 `gitnexus_detect_changes()`；索引 stale 先 `npx gitnexus analyze`。

### 7.3 语义联动（原方案第九节第 8 条，全部有效）

- workflow 合成 teamConfig 不得注入讨论 prompt（已列为 Phase C 强制验收点 + M-16）。
- 连续性 key 抽象共享（Phase D 已列）。
- `dispatchCountByTurn`/串行队列被 team 与 workflow 共享，预算耗尽的报错信息要写明"本 turn 总额度"而非误导性归因；至少一个集成测试覆盖两者同 turn 混跑。

### 7.4 其他

- `spark_team` 未来改名 `spark_orchestrate`：工具名只从常量模块引用（FR-10），prompt 文案里的全限定名同样从常量拼接。
- 防 ping-pong：先 prompt 层（"不要即时回 ping 刚 @ 你的人"），后端硬底线是消息/轮次限额；顺序不能反（原方案第九节第 6 条）。
- `enablePeerMessaging` 默认 false 灰度，老会话/老 ManagedTeam 行为与现状逐字节一致（M-01/M-08 验收）。
- 文档保鲜：本文档与原方案的状态行随 Phase 推进同步更新。

---

## 八、遗留开放问题（不阻塞开发）

1. 轻量"表态"之外是否还需要"结构化投票"工具（成员对某提案 +1/-1）——首版不做，视 M-02 真实体验再议。
2. codex 成员会话连续性（4.4 节已允许首版降级）后续是否补 codex resume 对接。
3. 预算联动若因 unified-orchestration-kernel 未合入而推迟，何时补上（Phase F 会留 TODO 标记）。
4. `spark_canvas` / `spark_memory` 对 codex 单会话的接入（复用 0b 通用桥接组件即可，工程量小）——不属于本方案范围，0b 合并后另立任务排期。
