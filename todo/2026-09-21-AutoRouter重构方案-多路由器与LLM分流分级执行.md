# AutoRouter 重构方案 — 多路由器 + LLM 分流器 + 强度分级执行

> 状态: 已落地 | 最后核对: 2026-09-21

> 落地记录：Phase 0（763d0df1）协议地基与旧伪 provider 下线；Phase 1（a871ce62）管理弹层；
> Phase 2（b09cb67b）分流器核心闭环 + direct 模式 + 全部显示点 + 选择器分组；
> Phase 3（2385f5e05）decomposed 一次性强度 worker 同轮编排。
> Phase 4 执行链路已随 Phase 2/3 覆盖（画布/定时任务/工作流节点 provider 指向 router 即分流），
> 剩余打磨项（后续迭代）：本地路由统计 UI、dispatcher 连通性测试按钮、
> decompose 子任务块的渲染端强度色点（数据通道 TeamMemberEventContext.autoRouter 已就绪）、
> 端到端真机验证（UI 显示与分流行为需用户实机确认）。

## 一、背景与目标

旧 Auto Router（隐藏于提交 `08c507a4 feat(ui): hide Auto Router entry points`，运行时至今仍活着）因质量差被下线。本方案基于对现有架构的完整代码分析，规划彻底重构。

### 1.1 新需求（用户定义）

1. 用户可以创建**多个** auto router；
2. 每个 auto router 配置一个**分流器模型**，专门负责分析任务强度、派发任务到该 router 下配置的任务执行模型；
3. 每个 auto router 下的任务执行模型需配置**强度**：高、平衡、低；
4. 会话使用某个 auto router 执行任务时，先由分流器模型理解任务强度，再按强度分配给执行模型；**同一会话的同一轮次中，可以有多个模型执行不同的子任务**（包括子 agent 等）。
5. （2026-09-21 补充）**全链路日志**：各环节都要加好日志，适配统一日志服务（见 3.7 埋点矩阵）；
6. （2026-09-21 补充）**界面显示**：界面显示要设计好；模型被路由切换时必须显示实际模型名，让用户随时知道"这轮是谁在干活"（见 3.9 显示点设计）。

### 1.2 旧版核心缺陷（考古结论，均有代码证据）

| # | 缺陷 | 证据 |
|---|------|------|
| 1 | **无 LLM 参与**，靠 13 个 complex 正则 + 7 个 simple 正则 + "≤80 字符" 分类任务 | `packages/agent-runtime/src/services/model-router.service.ts:61-85,211-225` |
| 2 | **单实例**：只有 `claude-auto-router` / `codex-auto-router` 两个硬编码伪 provider（动态合成、不落库），用户不能创建多个 | `packages/protocol/src/auto-router-provider.ts:4-8`、`provider.service.ts:393-409,464-471` |
| 3 | **轮次单模型**：每轮只产出一个 `(providerProfileId, modelId)`，无法一轮内多模型协作 | `session.service.ts:2425-2455` |
| 4 | 只看当轮文本分类，无会话级状态（上下文 100k 的连续重构任务，一句"好的继续"会被判 simple 路由到小模型） | `model-router.service.ts:211`（member 路径甚至刻意排除线程上下文 `session.service.ts:8032`） |
| 5 | 默认候选荒谬：未配置时把全部允许渠道×全部模型塞进 default 槽，实际选中"第一个渠道的第一个模型" | `model-router.service.ts:171-188` |
| 6 | token 估算拍脑袋（`eventCount × 100` 系数，128k 阈值对所有模型一刀切） | `session.service.ts:2441`、提交 `79030b8d` |
| 7 | 伪 provider 身份到处打补丁：每个子系统都要硬编码"这俩 id 是假的"（spark 引擎排除、fast mode 排除、CLI bridge 排除、CLI override 排除、拒删、新建会话跳过…共 7+ 处） | `provider-adapter.ts:26`、`openai-fast-mode.ts:38`、`SparkCliBridgeService.ts:13-18`、`session.service.ts:2500`、`provider.service.ts:968`、`SessionSidebarContext.tsx:1143-1156` |
| 8 | UI 概念负担重：「伪渠道 + 路由模型卡」两层抽象 | `ProvidersView.tsx:2263-2601` RouteModelManagerModal |
| 9 | 路由决策黑盒，用户无法知道"为什么这轮用了这个模型" | 全链路无决策展示 |

## 二、现状架构分析（关键结论）

### 2.1 每轮模型解析与注入链路

```
渲染端 ComposerV2 (runtimePatch: providerProfileId+modelId 随轮携带)
  → IPC session:submit-turn (main/ipc/index.ts:4541)
  → SessionService.submitTurn → dispatchTurn(:1909) → startTurn(:2113)
  → startTurnExecution(:2220)  ← 【每轮 provider/model 解析核心，AutoRouter 现有分支 :2401-2455】
  → 按引擎分叉组装 config → engineRegistry.resolveExecutor(...).executeTurn (每 turn 新建 executor)
```

- 解析优先级：`runtimePatch` > 团队/@mention 的 agent 绑定 > 会话持久值（`session.service.ts:2306-2339`）。
- 模型注入：Claude 引擎经环境变量 `ANTHROPIC_MODEL` + 档位映射 `ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL`（`claude-sdk-executor.ts:305-316`）；Codex 经 `--model`/config.toml/thread.start（三载具）；Spark 经前缀变换 `spark-<protocol>-<model>`。
- **每 turn 重新解析模型，executor 每 turn 新建** —— 这是路由功能的天然挂点，旧版挂点位置选对了。

### 2.2 同轮多模型的现有载体（不必新建）

单轮多模型已有三种成熟通道，全部挂在「Host turn 内的工具调用」之下：

1. **团队/工作流成员派发（最强）**：Host 轮运行中调 `agent_dispatch` / `agent_dispatch_batch`（真并发）/ `workflow_run` → `executeMemberTurn`（`session.service.ts:7722`）为每个成员**独立解析 provider+model+adapter 并新建 executor**，事件归并回同一 host turnId。治理完备：每轮 dispatch 预算默认 10（`team-dispatch.service.ts:141`）、深度限制、超时 AbortController（默认 10min）、串行队列（`parallel:true` 绕过）。
   - 花名册合成范本：`createWorkflowAtomicMember` / `createWorkflowSubagentMember`（`session-workflow-helpers.ts:637,120`）+ `applyWorkflowNodeOverrides`（:162-209，节点级覆盖 provider/model/adapter）——**为每个强度档合成一次性 worker 的现成模式**。
2. **工作流节点级模型**：节点 config 可覆盖 `providerProfileId/modelId/agentAdapter/reasoningEffort`。
3. **Claude SDK 原生 Task 子代理**：模型由档位映射环境变量决定（`ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL`，`claude-sdk-executor.ts:305-316`，注释明确：SDK 子代理默认落 Haiku 档，第三方渠道必须把三档映射到渠道已有模型）——**这是把"强度分级"传导给子 agent 的零成本通道**。

**不存在的能力**：Host 主循环单次 query 内换模型（每 turn 定值一次，轮中不可切）；显式的"LLM 路由决策阶段"（旧版是规则不是 LLM）。

### 2.3 关键约束

| 约束 | 说明 | 影响 |
|------|------|------|
| resume 身份断裂 | `makeRuntimeSessionId = sha256(sessionId+providerProfileId+model+adapter)`（`session-resume-gate.ts:84-99`），路由换模型 → 原生 resume 失配 → 退化为 `buildConversationHistory` 历史 prompt 注入兜底（机制已存在） | 可接受代价，但要做"强度粘性"减少无谓切换 |
| 主循环单模型 | 主执行模型每 turn 定值一次，同轮多模型只能走派发通道 | decompose 模式的子任务必须经 member/worker 通道 |
| 成员治理上限 | 每轮 dispatch 预算 10、成员 maxTurnCount 30、成员禁用 Task/SendMessage（`session.service.ts:8338`） | 分流器拆分子任务数需受控 |
| 一次性 sdkSessionId | 分流产生的一次性执行体须用一次性身份（`mention:${turnId}` 模式 :2606 可参考），避免污染 Host resume 链 | 子 worker 身份设计 |
| 两套 LLM/多媒体过滤 | 路由端 `isProviderAllowedForRouterAdapter`（protocol/model-router.ts:70）与渲染端 `provider-model-kind.ts` 平行实现 | 重构需同步/收敛 |
| Hook V2 不能做分流 | Hook 是 fire-and-forget 观察者，"执行失败不改变 Turn 终态"（`hook-system-v2.ts:14`） | 分流决策必须在 `startTurnExecution` 解析段内同步完成 |

### 2.4 可复用资产

- `ModelService.complete`（`model.service.ts:237`）：直连 HTTP 单轮 LLM 调用（anthropic `/v1/messages` / openai `/chat/completions`）—— **分流器调用的载体基底**，不 spawn 执行器、不碰 resume 链。⚠️ 复核修正：其现有签名为 `complete(prompt, {maxTokens})`，provider/model 取自 `settings('memory','extraction*')` 回退链（:250-286），**并不支持调用方指定渠道+模型，也不支持 AbortSignal/自定义超时** —— Phase 2 须先扩展签名：`opts.providerId / model / systemPrompt / timeoutMs / abortSignal`（HTTP 分流、凭据解析 `resolveProviderApiKey`、anthropic/openai 双协议、永不抛异常的 `{available, reason}` 语义均现成可复用）。
- `resolveProviderApiKey`（`provider-credential-resolver.ts:23`）：Keychain 凭据解析。
- `provider_profiles` 表 + `ProviderService` CRUD + `provider:create/update/delete` IPC 全套：富配置都在 `config_json`，扩展新 provider 类型成本低。
- 派发通道全家桶：`TeamDispatchService` / `executeMemberTurn` / 事件归并（`team_member_message`、`team_dispatch_*`）。
- 统一日志：`createLogger(namespace)`（`packages/shared/src/logger/index.ts:306`）+ `Resolved runtime for turn` 结构化日志（`session.service.ts:2764`）+ `TurnRuntimeMetricsTracker` → `turn_perf_metrics` 表。
- UI：`.badge.dot + .badge.success/.warning/.info` 色点徽标（强度标签）、`ModelPickerMenuItem`（需扩展 trailing 节点）、`ProviderLogo`、`usePinnedModels`、SettingsView 分区模式。

## 三、总体设计

### 3.1 核心概念模型

AutoRouter 从「伪 provider + 魔法 id + model_profiles 路由卡」重构为**一等公民实体**：

```ts
// packages/protocol/src/auto-router-config.ts（新建）
export type RouterIntensity = 'high' | 'balanced' | 'low'   // 强度：高/平衡/低

export interface AutoRouterExecutorRef {
  id: string                      // executor 条目 id（router 内唯一）
  providerProfileId: string       // 具体渠道
  modelId: string                 // 具体模型
  intensity: RouterIntensity      // 强度档位
  enabled: boolean
}

export interface AutoRouterDispatcherConfig {
  providerProfileId: string       // 分流器模型所在渠道
  modelId: string                 // 分流器模型（建议用快、便宜的小模型）
  timeoutMs: number               // 分流决策超时（默认 8000）
}

export interface AutoRouterConfig {
  kind: 'auto-router'             // config_json 判别字段
  version: 1
  adapter: 'claude' | 'codex'     // 绑定引擎（沿用旧约束：claude=anthropic 渠道，codex=openai 系）
  dispatcher: AutoRouterDispatcherConfig
  executors: AutoRouterExecutorRef[]          // 1..n，同一强度可配多个（取第一个有效的）
  fallbackIntensity: RouterIntensity          // 分流失败时兜底档位（默认 'balanced'）
  allowDecomposition: boolean                 // 是否允许分流器拆分子任务（默认 true）
  maxConcurrentSubtasks: number               // 拆分并发上限（默认 3，受派发预算 10 约束）
  subagentIntensityMapping: boolean           // 是否将档位映射注入引擎子代理 env（默认 true，仅 claude 引擎生效）
}

// zod schema：AutoRouterConfigSchema（严格校验，替代旧版无 zod 的 isRoutingModelConfig）
```

**强度语义**（替代旧版 simple/default/complex/longContext 四档复杂度）：
- `high`：高难度/高价值任务 —— 架构设计、跨模块重构、复杂调试；
- `balanced`：常规任务 —— 默认档位，分流失败兜底；
- `low`：轻量任务 —— 格式化、简单问答、翻译润色、批量机械操作。

> 长上下文不再作为独立档位：分流器输入包含会话 token 估算，超长上下文天然会被判为 high；各渠道 `contextWindow` 元数据（provider config 已有）用于执行器**资格校验**而非分类档位。

### 3.2 存储方案：落库 provider_profiles，而非新表

**决策：AutoRouter 作为 `provider_profiles` 表中 `provider_type = 'auto-router'` 的真实行**（`config_json` 存 `AutoRouterConfig`），不再动态合成伪 provider。

理由（对比三个候选）：

| 候选 | 评估 |
|------|------|
| A. 沿用旧方案（动态合成伪 provider + model_profiles 路由卡） | 否决：魔法 id 补丁问题无解；单实例硬编码；路由卡两层抽象是旧版被弃用的直接原因 |
| B. 新表 `auto_routers` + 独立 repository/IPC | 可行但成本高：session.provider_profile_id 外键语义断裂，选择器/导入导出/会话绑定全部要新开通道，重复造轮子 |
| C. **落库 provider_profiles（provider_type='auto-router'）** ✅ | 一等公民：session 绑定（`session.provider_profile_id` 直接存 router 的 uuid）、`provider:list` 天然返回、CRUD/导入导出/健康检查基础设施全复用；`ProfileIdSchema` 的 uuid 分支天然覆盖（可删旧的两个魔法 literal）；UI 按 `provider_type` 分组渲染 |

配套调整：
- `ProviderService.listProviders`：删除 `createAutoRouterProvider`/`hasRouteableTextProvider` 动态合成（:393-471）；router 行读取时做**配置有效性校验**（dispatcher/executors 指向的渠道和模型仍存在且启用，失效条目剔除并在 UI 标红）。普通渠道分组渲染须**排除 router 行**（`conversationalProviders` 链，ComposerV2.tsx:5693 有 `models.length>0` 过滤，router 行 modelIds 为空会被误滤/误混，需显式分流到独立分组）。
- `deleteProvider`：router 可正常删除（去掉旧版拒删特判 :964-971）；删除前校验无会话/Agent 正在引用（引用则提示）。
- 各处"魔法 id 特判"统一改为 `provider_type === 'auto-router'` 判断：`SparkCliBridgeService` 的 `NON_HTTP_PROVIDER_IDS`、`openai-fast-mode.ts`、`provider-adapter.ts`、`SessionSidebarContext` 新会话解析等。
- 执行器防线（保留旧版正确语义）：router 没有 endpoint/key，`startTurnExecution` 解析到具体执行器**之前**不得进入引擎 config 组装；CLI spark override 不允许指向 router（沿用 :2500 校验，改判据）。
- **导入导出引用重映射**（复核补充，缺口修复）：`importProviders` 新建走 `newId = crypto.randomUUID()`（:1505），router config_json 里 dispatcher/executors 的 `providerProfileId` 引用**必然断裂**。导入 router 时须按 name 匹配重建引用：导出 payload 为 router 行附带被引用渠道的 name 清单（或导入后二次 pass，按 name → 本地 id 映射改写 config_json）；匹配不到的条目标红提示。仅"replace 同名已存在"路径保留原 id 无此问题。
- **默认 provider 策略**（复核补充）：`setDefault` 无类型限制（:957），router 可被设为默认渠道 → 新建会话默认解析（SessionSidebarContext 等）会拿到 router。决策：**允许**（用户显式意图），但新建会话解析链必须按 router 分支处理（走分流而非报错），Phase 2 一并覆盖；ProvidersView 默认渠道交互对 router 行不做特殊禁用。

### 3.3 分流器（Dispatcher）设计 — 方案核心

**位置**：替换 `startTurnExecution` 的旧 AutoRouter 分支（`session.service.ts:2425-2455`，成员侧对称点 `:7810-7832` 同步替换）。该作用域内用户消息、会话事件数、token 估算、会话/agent 运行时、router 配置全部可用，且在 provider/model 定值前 —— 是唯一同时满足"读得到输入、改得了执行"的位置。

**调用方式**：复用 `ModelService.complete` 直连 HTTP 单轮调用（不 spawn executor、不产生事件流、不碰 resume 链），指定 dispatcher 的 provider+model，凭据走 `resolveProviderApiKey`。

**输入**（system prompt + user payload，控制在 ~2k token 内）：
- 用户当轮消息全文；
- 会话状态：事件数、估算 token（消息 tokenizer 精确值 + 历史粗估）、最近 2 轮用户消息摘要（解决"好的继续"误判）、当前工作目录/项目类型（可选）；
- router 可用执行器清单：`[{intensity, capabilityHint}]`（不泄露渠道细节给分流器，保持决策稳定）。

**输出**（强制 JSON schema，zod 严格解析，最多重试 1 次）：

```jsonc
{
  "intensity": "high" | "balanced" | "low",     // 本轮主执行强度
  "decompose": true | false,                     // 是否建议拆分子任务
  "subtasks": [                                  // decompose=true 时 1..maxConcurrentSubtasks 条
    { "summary": "…", "intensity": "low", "parallelizable": true }
  ],
  "reason": "一句话决策理由"                      // 用于日志与 UI 展示
}
```

**兜底链**（任何环节失败不阻塞轮次）：

```
分流器 LLM 调用
  ├─ 成功且 schema 合法 → 按决策执行
  ├─ 超时(8s)/HTTP 失败/JSON 不合法(重试1次后) → 规则兜底分类器（见下）
  └─ 规则分类也异常 → fallbackIntensity 执行器直连
```

规则兜底分类器：精简改造旧 `classifyTurn`（保留 token 阈值 + 收敛后的正则，simple→low / complex→high / 其余→balanced），仅作 LLM 失败的降级路径，不再承担主分类职责。

**强度粘性（减少 resume 断裂）**：分流器 prompt 中注入"上一轮实际执行强度"；决策为连续对话且语义强度未变化时，维持上一轮档位（prompt 约束 + 代码层校验：`intensity` 与上轮相同且执行器未变 → 直接复用，不再额外判断）。**上轮强度的读取来源**（复核补充）：从 `session_events` 反查该会话最近一条 `auto_router_decision` 事件的 `decision.intensity`（事件落库已在 3.7 设计，无需新增持久化结构）；无历史记录时视为首轮。

**取消联动**（复核补充）：分流调用必须传入轮次的 AbortSignal —— 用户在分流进行中点"停止"时同步中止分流 HTTP 请求，不得出现"轮次已取消、分流结果迟到仍替换执行器"的竞态。8s 超时与 AbortSignal 以先到者为准。

**成本与延迟预算**：每轮新增 1 次小模型调用（目标 < 2s、< 2k token）。分流器耗时计入轮次 TTFT 指标并单独上报（见 3.7）。

### 3.4 执行编排 — 两种模式

#### 模式一：direct（直答，默认路径，Phase 2 交付）

分流器判强度 → 该强度的第一个有效执行器**原地替换** `effectiveRuntimeProviderProfileId + model`（与旧版挂点语义一致），主循环单模型执行。同时（仅 claude 引擎且 `subagentIntensityMapping=true`）：

```
ANTHROPIC_MODEL              = high 执行器模型（当轮主强度）
ANTHROPIC_DEFAULT_HAIKU_MODEL = low 执行器模型    ← SDK 原生 Task 子代理自动获得「低强度」模型
ANTHROPIC_DEFAULT_SONNET_MODEL = balanced 执行器模型
ANTHROPIC_DEFAULT_OPUS_MODEL  = high 执行器模型
```

即 **SDK 原生子代理（含 Explore/Plan 等泛型子代理）天然按 router 强度分级执行** —— 需求 4"包括子agent等"在 direct 模式下零编排代码达成。某强度未配置执行器时该档回退主强度模型（防第三方渠道 invalid_model，沿用现有注释语义 `claude-sdk-executor.ts:305-316`）。

**替换实现要点**（复核补充，旧分支 `session.service.ts:2451-2455` 为范本）：分流完成后必须**同步替换四个变量** —— `effectiveRuntimeProviderProfileId` + `provider`（重新 `loadProvider`）+ `config`（重新解析执行器渠道的 config_json）+ `model`。下游首轮标题精炼（:3659/:3866/:4026 构造点）、分支名生成、fast mode 判断等均在替换点之后取值，拿到的是具体执行器渠道，链路自然贯通（已核实）。档位映射优先级：router 注入 > 执行器渠道 config 自带的 `haikuModel/sonnetModel/opusModel` 字段（渠道级配置作为 router 未启用映射时的回退）。

#### 模式二：decomposed（拆分派发，Phase 3 交付，`allowDecomposition` 开关控制）

分流器判定 `decompose=true`（多子任务且可并行/分强度的复合任务）时：

1. **Host 主持**：主循环使用分流器判定的主强度（复杂任务通常为 high）执行器主持 —— 负责理解任务、调用派发工具、汇总结果；
2. **子任务派发**：Host 轮内经派发通道（复用 `runSingleDispatch` + `executeMemberTurn`）为每个子任务合成**一次性强度 worker**：
   - 仿 `createWorkflowAtomicMember` 模式，用 `applyWorkflowNodeOverrides` 注入 `{providerProfileId, modelId}` = 子任务强度对应执行器，生成临时 AgentItem（id 形如 `autorouter:${routerId}:${turnId}:${subtaskIdx}`），注册进本轮 `allowedWorkerIds` 花名册；
   - 可并行子任务用 batch 语义（`parallel:true` 绕过串行队列，`agent_dispatch_batch` 已验证真并发）；`maxConcurrentSubtasks` 封顶，总派发数受每轮预算 10 治理；
   - 子 worker 用一次性 sdkSessionId（`mention:${turnId}` 模式），不污染 Host resume 链；
   - 所有子执行事件归并 host turnId（`team_member_message` / `team_dispatch_*` 现成形态），UI 正常流式展示。
3. **Codex 引擎说明**：无档位映射能力，direct 模式仅主模型分级；同轮多模型唯一路径是 decomposed 派发（引擎无关，成员可异构引擎）。

> Host 侧实现方式：给 router 会话的 Host 注入一个平台级 MCP 工具（如 `autorouter_dispatch`，参数 `{summary, intensity}`），由分流决策预填建议、Host 模型自主调用；比"分流器直接改写 turn 结构"更贴合现有 Agent 自主编排范式（dispatchTurn 拆写消息的方式侵入性大，不采用）。

### 3.5 会话接入形态（模型选择器）

- **选择器分组**：`ProviderModelPicker` 新增独立「智能路由」分组（不与具体渠道混排；置顶策略与 managed 渠道同级，`prioritizeManagedProviderGroups` 处插组）。每个 router 一行，`trailing` 节点显示三强度色点摘要（高●红 / 平衡●绿 / 低●蓝，未配置档置灰）+ 分流器模型小图标。
- **选中语义**：`runtimePatch.providerProfileId = <router 的 provider 行 id>`，`modelId = ''`（不再需要"路由卡"二级概念 —— **旧版两层抽象消灭**，选中 router 即完成全部配置）。
- **会话卡片/Composer 显示**：当前 router 名称 + 徽标；轮次执行后显示当轮实际模型 —— 详细显示点设计见 3.9（Composer 标签分支 / 轮次边界提示条 / 轮次 meta 行 / decompose 子任务标识）。
- `ModelPickerMenuItem.tsx` 扩展 `trailing` 渲染节点（现仅有 leading，`ModelPickerMenuItem.tsx:11-65`）。
- 接入点同步：Agent 配置（AgentsView provider 下拉，模型选项=router 即选 router）、画布（`canvas-agent-model-options.ts` 补 router 分组）、定时任务/工作流节点覆盖（`applyWorkflowNodeOverrides` 的 modelId 留空+provider 指向 router 即生效）。**统一规则：凡 provider 指向 router，modelId 必须为空，运行时由分流器决定**（旧版"modelId=路由卡 UUID"的反模式消除）。

**引擎匹配过滤**（复核补充，缺口修复）：现状 `conversationalProviders`（ComposerV2.tsx:5653-5661）**不按会话引擎过滤渠道** —— 普通渠道无碍，但 router 声明了 `adapter: 'claude'|'codex'`，codex 会话选中 claude router 会直接执行失败。双防线：① 选择器「智能路由」分组按当前会话 adapter 过滤 router；② 运行时兜底 —— 解析到 router 且 adapter 与当前引擎不匹配时，不抛错，回退 `fallbackIntensity` 对应执行器中匹配当前引擎的第一条（无则回退会话默认渠道），决策事件标注 `adapterMismatch`。AgentsView 同理按 agent.adapter 过滤。

**`modelId=''` 下游消费方适配清单**（复核补充）：旧分支 :2427 的"modelId 空 → throw"语义反转为"空 = 触发分流"；另需逐一适配以下消费点（现状假设 modelId 非空）：
- 记忆抽取回退链 `getActiveChatModel()`（`model.service.ts:261-274`，`model.length > 0` 校验）：router 会话该回退**静默失效** → 改为回退到 router 的 dispatcher 模型（分流器自己就是现成的小模型）；
- 会话卡片/Composer 当前模型名显示（显示 router 名称+徽标，轮后显示实际模型）；
- fast mode / spark 引擎 / CLI bridge 的特判（统一 `provider_type` 判断时一并处理空 modelId 分支）。

### 3.6 存量兼容与旧代码清理

**存量数据**（三个来源。**决策（2026-09-21 确认）：废弃清理，不做自动转换** —— 旧 UI 已隐藏且旧实现体验差、无有效存量使用；该决策同时消除了复核缺口 G6 的中间态断链问题：Phase 0 不再生成 router 行，引用旧魔法 id 的会话从下线当刻起直接走既有回退路径，无需等待 Phase 2）：

| 存量 | 处理 | 生效时机 |
|------|------|----------|
| `model_profiles` 中 `kind:'router'` 旧路由卡 | storage migration 标记 `enabled=0` 停用（保守不物理删除，防回滚需求；后续版本再清理）；**不生成**新 router 行，需要 AutoRouter 的用户在 Phase 1 管理页重新创建 | Phase 0 |
| 存量会话 `provider_profile_id` 指向旧魔法 id / `model_id` 存旧路由卡 UUID | 不做引用改写：伪 provider 下线后解析处按"渠道不存在"既有回退路径回退默认渠道，**不崩**；在该回退分支上加一次性轻量提示（「原 Auto Router 已下线，本轮起使用默认渠道」），避免用户困惑模型为何变化 | Phase 0（与伪 provider 下线同 PR） |
| `ProfileIdSchema` 旧 literal（schemas/index.ts:66-73） | 删除两个魔法 literal（新 router 为 uuid，天然覆盖）；`model_profiles` 路由卡专用通道若再无其他 kind 使用则一并下线 | Phase 0 |

**删除清单**（旧实现全量下线）：

- `packages/protocol/src/auto-router-provider.ts`（魔法 id 常量与判别 → 改为 `provider_type` 判断，文件删除）
- `packages/protocol/src/model-router.ts` 的 `RoutingModelConfig`/`normalizeRoutingCandidates`/`isProviderAllowedForRouterAdapter`（候选资格过滤逻辑并入新 `auto-router-config.ts` 的执行器校验；多媒体渠道排除规则收敛：与渲染端 `provider-model-kind.ts` 共享一份 `isConversationalProviderProfile`，消除两套平行实现）
- `model-router.service.ts` 正则分类主体（仅精简版迁入新服务作兜底）
- 渲染端 `auto-router-ui.ts` 开关及 12 个视图的 `filterProvidersForVisibleUi` 调用点（恢复为直读 provider 列表，router 由 `provider_type` 分组）、ProvidersView 旧路由卡 UI（:211-2261 区段、RouteModelManagerModal、自动路由按钮、'路由'筛选类别）、`providerCardFilterPrefs` 旧分支、`ChatView.tsx:433-439` 死导入
- `ProviderLogo` 旧 id 映射 → 新 router 类型图标（沿用配色）

### 3.7 日志与可观测性（强制要求，适配统一日志服务）

> 2026-09-21 补充需求：**各处都要加好日志**。以下为全链路埋点矩阵 —— 每个环节的日志在对应 Phase 实现时**随代码同步交付**，不做事后补埋。

**日志规范**：统一 `createLogger('auto-router')` namespace；全部结构化 JSON（键值对，不拼字符串）；分级语义 —— info=正常决策链路 / warn=降级与兜底触发 / error=配置失效且无可用执行器；**脱敏约束**：不落用户消息全文与 prompt 原文（只落 `msgLen`/`inputDigest`），不落 API Key。

**全链路埋点矩阵**：

| 环节 | 日志事件 | 级别 | 关键字段 | 交付 Phase |
|------|----------|------|----------|-----------|
| 配置·CRUD | router 创建/更新/删除 | info | `{action, routerId, routerName, adapter, dispatcher:{providerId,model}, executorCount, intensitySlots}` | 1 |
| 配置·读取校验 | 有效性校验剔除失效条目 | warn | `{routerId, invalidEntries:[{entryId, providerId, reason:'provider_missing'|'model_missing'|'provider_disabled'}]}` | 0/2 |
| 配置·导入导出 | name 引用重映射结果 | info/warn | `{routerId, remapped:n, unmatched:[names]}` | 0 |
| 迁移·旧卡清理 | storage migration 执行 | info | `{disabledProfileCount, migratedSessions:0, strategy:'deprecate'}` | 0 |
| 迁移·旧引用回退 | 旧魔法 id 会话触发回退提示 | info | `{sessionId, oldProviderId, fallbackProviderId}` | 0 |
| 解析·识别 router | startTurnExecution 进入 router 分支 | info | `{sessionId, turnId, routerId, adapterMatch:true/false}` | 2 |
| 分流·调用 | 分流请求发出/返回 | info | `{turnId, dispatcherModel, latencyMs, inputDigest:{msgLen, estTokens, eventCount, prevIntensity}}` | 2 |
| 分流·决策 | 决策结果落定 | info | `{turnId, decision:{intensity, decompose, subtaskCount}, fallbackUsed:false, reason}` | 2 |
| 分流·失败 | 超时/HTTP 失败/JSON 不合法（重试后） | warn | `{turnId, failureStage:'timeout'|'http'|'schema', attemptCount, degradedTo:'rule'|'fallbackIntensity'}` | 2 |
| 分流·粘性 | 强度粘性命中（复用上轮档位） | info | `{turnId, prevIntensity, kept:true}` | 2 |
| 分流·取消 | 轮次取消中止分流 | info | `{turnId, aborted:true, elapsedMs}` | 2 |
| 执行·替换 | 四变量替换完成 | info | `{turnId, from:{providerId,model:''}, to:{providerId,model}, tierEnvInjected:{haiku,sonnet,opus}}` | 2 |
| 执行·adapterMismatch | 跨引擎兜底 | warn | `{turnId, routerAdapter, sessionAdapter, resolvedExecutor}` | 2 |
| decompose·合成 | 一次性 worker 合成 | info | `{turnId, workerId, intensity, providerId, modelId, parallelizable}` | 3 |
| decompose·派发 | 子任务派发结果 | info/warn | `{turnId, workerId, status:'dispatched'|'succeeded'|'failed'|'timeout', budgetRemaining}` | 3 |
| 预算·治理 | 派发预算/并发上限约束触发 | warn | `{turnId, budgetUsed, budgetMax, cappedSubtaskCount}` | 3 |

- **决策日志**：上述"分流·决策"行即原设计 —— 每次分流输出结构化 JSON：`{sessionId, turnId, routerId, dispatcherModel, latencyMs, inputDigest: {msgLen, estTokens, eventCount, prevIntensity}, decision: {intensity, decompose, subtaskCount}, fallbackUsed, reason}`。
- **决策事件**：新增 session 事件 `auto_router_decision`（落 `session_events`，随事件流广播）——渲染端在轮次边界展示路由提示条（详见 3.9），**消除旧版黑盒**；成员派发路径复用 `team_dispatch_*` 事件。**事件 payload 自渲染所需全量字段**（主进程侧一次解析完成）：`{routerId, routerName, intensity, resolvedProviderId, resolvedModelId, modelDisplayName, reason, fallbackUsed, fallbackStage?, adapterMismatch?, latencyMs, prevIntensity}` —— 渲染端直接用 `modelDisplayName` 显示模型名，无需按 providerId/modelId 二次反查。
- **性能指标**：分流器耗时并入 `TurnRuntimeMetricsTracker`（TTFT 拆 `routingMs + firstTokenMs`）；`turn_perf_metrics` 已有 providerId/modelId 字段记录当轮实际执行模型（`ChatInspectorPerf.tsx:26` 已消费展示「第 N 轮 · model」），router 会话额外记 routerId + intensity。
- **失败可观测**：分流失败/兜底触发必须 warn 级日志 + 事件标记（UI 显示「分流降级」角标），符合"补全各层日志方便排查"的项目要求。

### 3.8 UI 方案

**管理页**（满足需求 1/2/3）：ProvidersView 工具栏「自动路由」按钮（原入口位置，用户认知连续）→ `AutoRouterManagerModal`（重构自 RouteModelManagerModal 的数据层模式，槽位语义全部重写）：

- 左侧 router 列表（名称 + adapter 色点 + 启用状态）+ 新建按钮；
- 右侧编辑表单（扁平风，`pv_form_grid` 模式）：
  - 基础：名称、引擎（claude/codex）、启用；
  - **分流器**：渠道下拉 + 模型下拉（两级联动，LobeSelect，AgentsView 模式）+ 超时；
  - **执行模型列表**（可增删行）：每行 = 渠道下拉 + 模型下拉 + 强度三选一（`.badge.dot` 色点 chip：高=danger/平衡=success/低=info）；
  - 高级：兜底强度、允许拆分开关、拆分并发上限、子代理档位映射开关；
- 保存走 `provider:create/update/delete`（router 即 provider 行）。

**表单校验**：dispatcher/executors 只列该 adapter 允许的文本渠道（收敛后的共享过滤）；至少 1 个启用执行器；高强度建议必配（decompose 主持默认高强度）。

**UI 风格约束**：遵循扁平基线 —— 无卡片盒子分组、分割线分节、色点+文字明暗分层（项目既定规范）；强度徽标复用 `.badge.dot` 体系。

### 3.9 会话界面显示设计 — 模型名可见性（2026-09-21 补充需求）

> 需求原文：「界面显示要设计好，切换模型显示时，要显示下模型名让用户知道怎么用的」。核心原则：**任何时候用户都能看到"这轮是谁在干活"** —— 选中态看 router，执行态看实际模型名。

**现成资产（已核实）**：手动切模型提示条 `ModelSwitchNotice`（"模型已从 X 更改为 Y"，`ChatView.tsx:5157-5165` 挂载，`ModelSwitchMarkers.ts` localStorage 存储）；Composer 主标签 `getPickerModelDisplayLabel(selectedProvider, selectedModelId)`（`ComposerV2.tsx:5775`）；Inspector 每轮模型展示 `第 N 轮 · model`（`ChatInspectorPerf.tsx:26`，消费 turn_perf_metrics）。

#### 显示点 1 — Composer / 会话头（选中态，Phase 2）

- router 选中时主标签分支：显示 **`⚙ {router 名称}`** + 「智能路由」徽标（`selectedModelId=''` 时不显示空白模型名）；标签构造点即 `ComposerV2.tsx:5775` 的 `primaryLabel` 处按 `provider_type === 'auto-router'` 分支。
- 悬停 tooltip 展开配置摘要：「分流器: {model} · 高: {model} · 平衡: {model} · 低: {model}」，让用户不进管理页也能知道这个 router 会怎么派活。
- 会话 Tab / 侧栏会话卡片的当前模型显示（`ChatTabbar` 等消费点）同步适配 router 显示分支。

#### 显示点 2 — 轮次边界路由提示条（核心，Phase 2）

- **触发条件**：仅当**本轮实际执行模型与上一轮不同**时，在该轮用户消息上方渲染提示条（与手动 `ModelSwitchNotice` 同视觉模式：左右细线 + 居中内容，避免每轮刷屏）；首轮必显示（用户第一次看到 router 实际选了什么）。
- **内容**：`⚙ 已路由 → ●高 {强度色点} {模型名} · {理由}`，例：`⚙ 已路由 → ●高 claude-opus-4-5 · 跨模块重构任务`。
- **数据源**：`auto_router_decision` 事件（session_events 持久化）—— **不用 ModelSwitchMarkers 的 localStorage 方案**（仅客户端、重装即丢、无法跨设备），仅复用其视觉样式与挂载位置模式（ChatView 轮次渲染处按事件流插条）。
- **与手动切换的关系**：手动切模型仍走既有 localStorage markers 机制，两条提示条视觉可区分（路由条带 ⚙ 图标与强度色点，手动条维持 Box 图标）。
- **降级态**：分流失败走兜底时，提示条变为 `⚠ 分流降级 → ●平衡 {model}（规则兜底）`；adapterMismatch 回退时标注 `⚠ 引擎不匹配回退 → {model}`。

#### 显示点 3 — 轮次内常驻模型标识（Phase 2）

- 每轮 assistant 回复的 meta 行（时间/耗时同一行，轮次头部小字）追加：`●{强度色点} {模型名}` —— 即使没有提示条，用户扫一眼也知道该轮用的什么模型。
- 数据源同为 `auto_router_decision` 事件（事件随轮次归属，渲染时按 turnId 关联）。
- 非 router 会话不受影响（无事件则不渲染，零侵入）。

#### 显示点 4 — decompose 子任务展示（Phase 3）

- 每个子任务的 `team_member_message` 块头部显示：`{子任务摘要} · ●{强度色点} {模型名}`，例：`搜索相关文件 · ●低 gemini-2.5-flash`。
- 多 worker 并发时用户能清楚看到"哪些子任务给了哪个强度的哪个模型"——需求 4「同轮多模型」的直观呈现。

#### 显示点 5 — Inspector 性能面板（Phase 2）

- `ChatInspectorPerf` 现有「第 N 轮 · model」行扩展：router 会话追加强度色点 + `routingMs`（分流耗时），便于用户核对路由开销。

#### 交互细节

- 提示条与 meta 行的模型名统一用**模型显示名**（渠道配置的 displayName/modelNameById 映射），无显示名时回退原始 modelId，绝不显示空串。
- 提示条支持点击展开决策详情浮层：分流器完整输出（强度/理由/子任务建议/延迟/fallbackUsed），满足"想深究的人能看到全部"。
- 色点语义全局一致：高=danger 红 / 平衡=success 绿 / 低=info 蓝（与选择器、管理页、提示条同色）。

## 四、实施计划（分期交付）

> 每期独立可验证、可回退；类型检查 + 聚焦单测随代码交付，关键链路按项目惯例做真实界面验证。

### Phase 0 — 地基与清理（协议/存储/旧代码下线）

1. `packages/protocol/src/auto-router-config.ts`：新类型 + zod schema + 执行器资格校验（收敛多媒体过滤）；`schemas/index.ts` 删旧 literal、provider schema 允许 `provider_type='auto-router'`；
2. `provider.service.ts`：删动态合成、router CRUD 走真实行、读取侧有效性校验、导入导出 name 引用重映射；`SparkCliBridgeService`/`openai-fast-mode`/`provider-adapter`/`SessionSidebarContext` 特判改 `provider_type`；
3. 存量路由卡废弃清理（storage migration：旧卡标记 `enabled=0`，**不生成**新 router 行）；旧魔法 id 会话引用回退默认渠道 + 一次性下线提示；`model_profiles` 路由通道下线评估；
4. 渲染端删 `auto-router-ui.ts` 开关链 + 旧路由卡 UI + 死导入（选择器暂不出现 router 分组，Phase 2 接入）。
   - 验证：storage 迁移单测（旧卡停用、不生成新行）、旧魔法 id 会话回退默认渠道 + 提示单测、protocol schema 单测、导入导出重映射单测、typecheck。

### Phase 1 — 管理页与实体 CRUD

1. `AutoRouterManagerModal` + ProvidersView 入口；表单两级联动、强度行编辑、校验；
2. `provider:list` 返回 router 行，管理页消费；导入导出兼容 router 行；配置 CRUD / 读取校验 / 导入重映射日志（3.7 矩阵"配置"与"迁移"行）。
   - 验证：管理页真实界面操作（建/改/删/校验拦截），ProvidersView 既有测试回归；日志抽查（CRUD 操作在统一日志服务可见结构化记录）。

### Phase 2 — 分流器与 direct 模式（核心闭环，最小可用版）

1. `ModelService.complete` 签名扩展（`opts.providerId/model/systemPrompt/timeoutMs/abortSignal`，向后兼容旧调用）；记忆抽取回退链适配（router 会话回退 dispatcher 模型）；
2. `AutoRouterService`（新，packages/agent-runtime/src/services/）：加载 router 配置、调扩展后的 `complete` 分流（带轮次 AbortSignal）、zod 解析、规则兜底、强度粘性（session_events 反查上轮强度）、全链路结构化日志（3.7 矩阵"分流"与"执行"行随代码交付）；
3. `startTurnExecution` 替换旧分支（含成员侧对称点）：router provider → 分流决策 → 四变量替换（id/provider/config/model）+ claude 档位 env 映射（子代理分级）+ adapter 不匹配运行时兜底（替换/兜底动作均落日志）；
4. `auto_router_decision` 事件 + TTFT 拆分指标 + 分流失败降级路径；
5. **界面显示（3.9 显示点 1/2/3/5）**：Composer router 标签分支（⚙ 名称 + tooltip 配置摘要）、轮次边界路由提示条（事件驱动、模型变化才显示、点击展开决策详情）、轮次 meta 行强度色点+模型名、Inspector 强度与 routingMs；
6. 模型选择器「智能路由」分组（按会话 adapter 过滤）+ `ModelPickerMenuItem` trailing + AgentsView 接入（按 agent.adapter 过滤）+ 默认渠道=router 的新会话解析。
   - 验证：分流决策单测（mock LLM：正常/超时/坏 JSON/强度粘性/取消中止）、端到端真实会话（选 router → 提问简单/复杂任务 → 验证落不同强度模型 + 决策事件 + 子代理 env）、codex 会话选 claude router 的兜底路径、resume 兜底路径回归；**界面验证（真实 UI 操作）**：选中 router 后 Composer 显示 ⚙ 名称（非空白模型名）、简单与复杂任务交替提问时轮次边界出现「已路由 → 强度 · 模型名」提示条、连续同强度任务不刷屏、降级场景显示 ⚠ 角标、每轮 meta 行可见实际模型名；**日志验证**：完整走一轮后在统一日志服务中可见 识别→分流调用→决策→替换 全链路结构化日志。

### Phase 3 — decomposed 多模型同轮编排

1. `autorouter_dispatch` 平台 MCP 工具（Host 可调）+ 分流决策预填建议注入 Host 上下文；**前置确认**：现有 MCP 工具注册为全局/agent 级，"仅对 router 会话的 Host 条件注入平台工具"机制需先核实现成能力（工具白名单/系统 prompt 注入通道），若无可复用机制则该工具改为随 router 选择器一并全局注册、内部按会话是否绑定 router 短路返回；
2. 一次性强度 worker 合成（花名册注册 + `applyWorkflowNodeOverrides` 注入）+ batch 并发 + 预算/超时治理接线（合成/派发/预算约束日志按 3.7 矩阵 decompose 行交付）；
3. 事件归并展示（3.9 显示点 4：子任务块头部「摘要 · 强度色点 · 模型名」，多 worker 各自显示实际模型）。
   - 验证：复合任务真实会话（如"重构 X 并补测试再写总结"→ 3 强度 3 worker）、预算耗尽续跑、并发上限约束、事件流归属正确性；**界面验证**：子任务块可见各自强度与模型名，同轮多模型对用户可辨识。

### Phase 4 — 打磨与推广接入

1. 画布/定时任务/工作流节点覆盖接入 router；
2. 路由命中率统计（各强度使用占比、分流延迟分布、成本对比普通单模型会话）；
3. router 健康检查（dispatcher 连通性测试按钮）。
   - 验证：各入口真实操作 + 统计数据准确性。

## 五、影响面与风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 每轮新增分流调用推高 TTFT 与成本 | 中 | 强制小模型建议 + 2k token 上限 + 8s 超时直降级；强度粘性跳过重复决策；统计面板暴露实际开销 |
| 路由换模型 → 原生 resume 断裂（历史注入兜底） | 中 | 已有 `resumeRecoveryHistoryPrompt` 机制；强度粘性减少切换频次；`sdkResumeOptIn` 渠道灰度不受影响 |
| decompose 并发放大成本/竞态 | 中 | `maxConcurrentSubtasks≤3` 默认 + 派发预算 10 + 超时 AbortController + 串行队列默认开启 |
| 分流器误判（比正则好但仍可能错） | 低 | 决策理由 UI 透明展示 + reason 落库可复盘；Composer 强制强度覆盖暂不做（决策 4，Phase 4 评估） |
| 存量旧路由卡/会话引用（废弃清理策略） | 低 | 旧卡标记停用不物理删除（可回滚）；引用旧魔法 id 的会话走既有"渠道不存在"回退 + 一次性下线提示；需要 router 的用户在管理页重建 |
| 与 fast mode / CLI override / spark 引擎的互斥边界 | 低 | 统一 `provider_type` 判断后边界集中一处维护；互斥规则在 router 保存时校验提示 |
| 分流调用与轮次取消竞态（取消后迟到决策仍替换执行器） | 低 | 分流请求绑定轮次 AbortSignal，8s 超时与取消信号先到者生效（Phase 2 任务项） |
| router 跨引擎误选（codex 会话选 claude router） | 低 | 选择器分组按 adapter 过滤 + 运行时 adapterMismatch 兜底双防线（3.5） |
| 导入 router 后渠道引用断裂 | 中 | 导入时按 name 重建 providerProfileId 引用映射，匹配不到标红提示（3.2）；迁移/导入后读取侧有效性校验兜底 |
| 并行开发冲突 | 低 | Phase 0-2 集中在 protocol/agent-runtime/provider UI，与当前工作树 `OptionalCapabilityManager` 等改动无交集 |

## 六、开放问题 → 决策记录（2026-09-21 用户已全部确认）

1. **管理入口位置**：✅ **ProvidersView 工具栏**（原入口认知连续，与渠道管理同域，复用管理弹层架构）。
2. **decompose 默认开关**：✅ **默认开启**（`allowDecomposition=true`；分流器仅高置信判定可拆分时才拆，风险由并发上限/预算治理兜住）。
3. **迁移策略**：✅ **废弃清理，不做自动转换**（旧 UI 已隐藏且无有效存量使用；Phase 0 旧路由卡停用 + 会话引用走既有回退 + 一次性下线提示，详见 3.6；G6 中间态断链风险随之消除，Phase 2 原「会话引用改写迁移」任务取消）。
4. **强度快捷覆盖**：✅ **暂不做**（Phase 4 根据分流决策透明展示后的实际使用反馈再评估是否纳入 Composer 强制强度入口）。
5. **路由统计遥测**：✅ **暂不接入云端遥测**，保持本地统计（Phase 4）；后续有需要再扩展上报通道。

**全部开放问题已闭环，方案定稿，进入 Phase 0 开发。**

---

## 附：关键代码位置索引（实现时直接定位）

| 关注点 | 文件:行号 |
|--------|-----------|
| 每轮解析核心 / 旧路由分支（替换点） | `packages/agent-runtime/src/services/session.service.ts:2220`（分支 :2401-2455） |
| 成员侧对称替换点 | `session.service.ts:7774-7856` |
| 分流器调用载体 | `packages/agent-runtime/src/services/model.service.ts:237`（complete） |
| 凭据解析 | `packages/agent-runtime/src/services/provider-credential-resolver.ts:23` |
| 档位 env 映射（子代理分级） | `packages/agent-runtime/src/sdk/claude-sdk-executor.ts:305-316` |
| 派发通道 | `packages/agent-runtime/src/services/team-dispatch.service.ts:191`（预算 :141）、`session.service.ts:6706`（runSingleDispatch）、`executeMemberTurn :7722` |
| 一次性 worker 合成范本 | `packages/agent-runtime/src/services/session/session-workflow-helpers.ts:637,120,162-209` |
| resume 身份 | `packages/agent-runtime/src/services/session-resume-gate.ts:84-99` |
| 旧伪 provider 合成（删除） | `packages/agent-runtime/src/services/provider.service.ts:393-471,964-971` |
| 旧分类器（精简保留作兜底） | `packages/agent-runtime/src/services/model-router.service.ts:211-225` |
| 旧 UI 开关链（删除） | `apps/desktop/src/renderer/design/utils/auto-router-ui.ts` + 12 视图调用点 |
| 模型选择器分组 | `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx:5584-5987`（router 合并 :5707-5716） |
| 管理弹层重构基底 | `apps/desktop/src/renderer/design/views/ProvidersView.tsx:2263-2601` |
| 强度徽标样式 | `apps/desktop/src/renderer/design/styles/components.css:179-230`（.badge.dot） |
| 统一日志 | `packages/shared/src/logger/index.ts:306` |
| 模型切换提示条（视觉模式复用，路由条改事件驱动） | `apps/desktop/src/renderer/design/views/chat/ModelSwitchNotice.tsx` + `ModelSwitchMarkers.ts` |
| 提示条挂载点（轮次边界插条位置） | `apps/desktop/src/renderer/design/views/ChatView.tsx:5157-5165` |
| Composer 主标签构造（router 显示分支落点） | `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx:5775` |
| Inspector 每轮实际模型展示（turn_perf_metrics 消费） | `apps/desktop/src/renderer/design/views/chat/ChatInspectorPerf.tsx:26` |

## 附二：全链路闭环复核记录（2026-09-21，第二轮）

按「开发 / 配置 / 使用 / 执行」四维矩阵复核，逐项回源码核实。**通过项**：执行主链路（分流挂点 → 四变量替换 → 标题/分支名生成位于替换点之后，链路贯通）、配置 CRUD、派发通道范本、观测设计。**发现 8 处缺口并已回写本方案**：

| # | 维度 | 缺口 | 源码证据 | 修正落点 |
|---|------|------|----------|----------|
| G1 | 执行/开发 | `ModelService.complete` 不支持指定渠道+模型、无 AbortSignal/超时（原方案表述不实） | `model.service.ts:237-286`（provider/model 取自 settings memory 回退链） | 2.4 修正 + Phase 2.1 |
| G2 | 使用 | 选择器无引擎过滤，router 跨引擎误选直接失败 | `ComposerV2.tsx:5653-5661`（conversationalProviders 无 adapter 过滤） | 3.5 引擎匹配双防线 + Phase 2.5 |
| G3 | 使用/执行 | `modelId=''` 下游消费方未适配（记忆抽取回退静默失效、显示链、旧分支 throw 语义） | `model.service.ts:261-274`、`session.service.ts:2427` | 3.5 消费方清单 + Phase 2.1 |
| G4 | 配置 | 导入 provider 重新生成 uuid，router 渠道引用必然断裂 | `provider.service.ts:1505`（newId = randomUUID） | 3.2 name 重映射 + Phase 0.2 |
| G5 | 配置 | router 可被设默认渠道，新会话解析链未适配 | `provider.service.ts:956-958`（setDefault 无类型限制） | 3.5 默认策略 + Phase 2.5 |
| G6 | 开发 | Phase 0 改写会话引用 → Phase 2 才有分流服务，中间态断链 | 分期时序 | 3.6 迁移拆分 + Phase 0.3/2.4 |
| G7 | 执行 | 强度粘性"上轮强度"读取来源未定义 | — | 3.3 session_events 反查 |
| G8 | 执行 | 取消轮次时分流请求竞态；decompose 平台工具条件注入机制未确认 | — | 3.3 AbortSignal + Phase 3.1 前置确认 |

## 附三：代码审查修复记录（2026-09-21，第三轮）

对 5 个提交（`763d0df1` → `fd48d0281`）逐条回源码审查，**4 个真实缺陷 + 3 个边界缺陷**已全部修复并补回归测试；同时闭环 Phase 4 的两个入口缺口。每项修复前均回源码复核证据，修复后跑与风险匹配的验证。

### 缺陷与修复

| # | 严重度 | 缺陷 | 源码证据 | 修复 |
|---|--------|------|----------|------|
| P1 | 高 | decomposed 的派发工具面未打通：Host 拿到"请用 agent_dispatch 派发"的提示却没有该工具，静默退化为单模型执行（需求 4 失效） | `session.service.ts:3139` 只按 `hasDispatchableTeamMembers` 判定，与建 server 的花名册判定（:3083 含 `hasAutoRouterSubtasks`）不一致 | 抽出 `shouldExposeDispatchTools` 纯函数统一口径；`orchestration_status.source`/编排提示词按 `team > auto-router > workflow` 互斥推导（新增 `resolveOrchestrationSource`），router 拆分轮次不再谎报"挂了工作流" |
| P2 | 中高 | 用户取消轮次被报成"没有可用执行模型…请检查配置"，并经 `handleQueuedTurnStartFailure` 写成 agent_error + 会话 error | `auto-router.service.ts:285-303` 取消分支返回 `resolved=null`；`session.service.ts:2530` 直接 throw | 主侧先判 `routing.cancelled` 安静退出本轮启动（cancelTurn 已写 user_cancelled_turn 终态）；成员侧按既有 abort 语义 `return { content:'', partial:true }` |
| P3 | 中 | 规则兜底 + 该强度档未配置执行器时，强度标签与实际执行模型不一致（提示条显示"●低"、实际跑高强度模型） | `auto-router.service.ts:342-357` 强度修正被 `!fallbackUsed` 守卫挡住 | 强度一律对齐实际执行器强度（reason 追加"X 档未配置，回落 Y"） |
| P4 | 中 | router 行按普通渠道卡片渲染（显示"OpenAI 格式 · 默认 "），点编辑可进普通面板把 `provider_type` 改掉留下脏行 | `ProvidersView.tsx:1208-1220` 列表未过滤；`provider.service.ts:840` `updateProvider` 无 router 拦截 | 渠道网格按 `providerType` 过滤 router 行（仍由工具栏「自动路由」弹层管理）；`updateProvider` 除启停外一律拒绝 router 行 |
| P5 | 边界 | router 分支用 `getAgentAdapterFromSession(..., null)` 推导会话引擎：会话未显式声明 adapter/chat_mode 时硬判 codex，claude router 被误判 adapterMismatch（无 codex 系执行器时直接报错） | `session.service.ts:2456-2470` vs 主线 `:2652` 传执行器 `provider_type` | 新增 `resolveRouterSessionAdapter`：显式 adapter/chat_mode 优先，缺省时按 router 声明 adapter 假定；原始信号传入 `routeAutoRouterTurn` 统一推导（主/成员两侧同源） |
| P6 | 边界 | 子任务 worker 在"该强度档无执行器"时回落 host 绑定（= router 行）→ 成员侧二次分流，白烧一次分流调用 | `session.service.ts:8777-8779` | 抽出 `resolveAutoRouterWorkerBinding`：回落本轮已解析主执行器，绝不回落 router 行 |
| P7 | 中（本轮新发现） | `getProviderAdapterKind` 无 router 分支：claude 会话选中 claude router 时，"选中 provider 即校准引擎"的协调逻辑会把会话 `agentAdapter` 改成 codex，运行时随即判 adapterMismatch，claude 档位执行器全部失配 | `provider-adapter.ts:51`（`provider='auto-router'` ≠ `'anthropic'` → codex）；消费方 ComposerV2 协调 effect / AgentsView / 画布 | `getProviderAdapterKind` 增加 router 分支（按声明 adapter）；`agent-execution-config.getLockedAgentAdapterForProvider` 改为委托，消除两处口径分叉 |

### Phase 4 入口缺口闭环

- **画布**：`buildCanvasAgentModelOptions` 原按 `models.length > 0` 过滤，router 行（modelIds 恒空）根本选不到。现为 router 生成单条说明性条目「智能路由（由分流器决定执行模型）」，`resolveCanvasAgentProviderModel` 对 router 恒返回空 modelId，分组不提供置顶。
- **定时任务**：模型候选抽为 `buildScheduledTaskModelOptions`，router 以「名称（智能路由）」出现、value 为其 provider id；主进程 `resolveScheduledTaskRuntime` 新增优先按 router id 命中分支（置空 modelId + 取声明引擎）。

### 验证结果（本轮实跑）

| 范围 | 结果 |
|------|------|
| typecheck | protocol / shared / storage / agent-runtime / desktop 全绿 |
| agent-runtime 全量（HEAD + 本轮改动，干净 worktree） | 2892 tests：2876 通过、6 失败 —— 6 个全部是基线 7 个失败的子集（media contract、platform media routing、session-runtime-config spark_computer/spark_canvas、session.service 关闭等待），**零新增失败** |
| desktop 全量（主树） | 5739 tests：40 失败 —— 基线 44 失败，**零新增失败**，其中 2 个为本次修复的既有失败（`canvas-agent-model-options`、`provider-model-picker-utils` 的旧魔法 id fixture） |
| 本轮新增/更新单测 | **27 个新用例全过**：派发面口径 8、会话引擎推导 4（engine-kinds 共 17）、分流决策链 +2（共 13）、provider 编辑拦截 +1（共 11）、渲染端 provider-adapter 5、定时任务候选 3、画布 router 分组 +2（共 5）、显示点 4 数据通道 2；另修正 2 个既有失败 fixture（provider-model-picker-utils、canvas legacy router） |
| 日志 | P1/P2/P3/P6 修复均补齐结构化日志（`auto-router` namespace：取消安静退出、强度回落、worker 绑定） |

**未覆盖（如实说明）**：UI 真机验收（画布/定时任务/Composer 选择 router 的实机交互）需用户手动确认；主树全量测试存在既有的 vite-node 收集失败（`spark-engine/dist` 旧产物触发裸 `string_decoder` 解析失败），与本轮改动无关（基线同样存在），建议重建 `spark-engine/dist`。

