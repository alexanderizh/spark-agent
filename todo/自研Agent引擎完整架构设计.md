# 自研 Agent 引擎（spark-engine）完整架构设计

> 状态: 实施中 | 最后核对: 2026-08-26
>
> 本文档是「第三套自研 SDK/CLI」的**完整架构设计**：目标是对标 Claude Code / Codex 的顶级 Agent 工程水平，吸收 dsh（DeepSeek Harness）的四大哲学——微内核、插件可逆 effect、事件日志事实源、能力 seam。
>
> **已定案（2026-08-26 复核后）**：① 命名 `spark-engine/` + `@spark/agent` + CLI `spark`，数据/配置目录同步统一为全局 `~/.spark/` 与项目内 `.spark/`、env 前缀 `SPARK_*`；② 语言 TypeScript + Node ≥22.14；③ 模型协议**内置仅双协议**：Anthropic Messages + OpenAI Responses，统一 IR 内部自行适配（§5.2）；④ 会话落点：**全局事实库 + 项目内仅配置**（§4.2，依据 Codex/Claude 实测布局）；⑤ 差异化优势对标见 §17；⑥ TUI 设计已通过，随第一轮（M1）开发，界面定稿见 `todo/spark-engine-TUI终端界面设计.md`。
> 本设计不分「一期/二期砍需求」：下文所有子系统全部在范围内；文末的「构建顺序」只是施工排期，每个里程碑交付的都是完整设计中已定型的切片，而非简化版。
>
> **逐功能细化（2026-08-26 起）**：本文是总纲（不变量、边界、里程碑）；每个功能域的实现级细化设计在 [`todo/spark-engine-features/`](spark-engine-features/README.md) 下独立成文件（含统一模板与状态表），开源选型见其中 000 号文件。两处冲突时以功能文件为准并回改本文。

---

## 0. 定位与硬性边界

### 0.1 产品形态（三位一体）

| 形态       | 入口                                   | 说明                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------- |
| CLI        | `spark "任务"` / 交互式 TUI            | 终端独立使用，零宿主依赖                                |
| App Server | `spark serve`                          | 无头守护进程，stdio 双向 JSON-RPC，SparkWork 等宿主接入 |
| SDK        | `import { Agent } from '@spark/agent'` | 程序化嵌入，同一内核                                    |

### 0.2 可移植性四条硬规则（“搬走即用”的工程化定义）

1. **目录自包含**：全部代码在仓库根 `spark-engine/` 一个目录内；内部模块只允许 import（a）本目录内模块（b）npm 外部包，**禁止 import 仓库其他任何目录**。
2. **禁止 workspace 依赖**：package.json 不使用 `workspace:*` 指向目录外包；与 SparkWork 的耦合面只允许版本化 Host 协议（模型渠道 bridge 与 App Server）和发布的 npm 包。
3. **边界由工具强制**：ESLint `no-restricted-imports` 规则 + CI 边界检查脚本（扫描越界 import 即失败），不靠自觉。
4. **拷贝即用**：`cp -r spark-engine /anywhere && npm install && npm run build` 可直接构建出 `spark` CLI；后续可选 Bun `--compile` 打单文件二进制实现零依赖分发。

### 0.3 与 SparkWork 的关系

SparkWork 只是**第一个宿主**：app 侧新增一个 `EngineDescriptor`，spawn `spark serve` 并讲协议（与现在接 codex app-server 同构）。引擎内**不写任何 UI 逻辑、不 import 宿主类型**。反向同理：`packages/plugin-sdk`、`SDKExecutorConfig` 等仓库既有类型**不进入**引擎 ABI。

M2 已先落地独立 CLI 所需的模型渠道 Host Bridge：SparkWork 在 loopback 随机端口发布当前有效模型目录并代理模型请求，每个桌面实例在 `~/.spark/hosts/sparkwork/bridge-<instanceId>.json` 写入独立描述文件，CLI 自动选择仍存活且最新的实例。Provider Key 始终留在宿主 Keychain/加密凭据库，不复制进 TOML、CLI 进程环境或事实账本；完整契约见 `todo/spark-engine-features/016-配置系统.md`。这不替代 M3 App Server，后者仍负责宿主驱动的会话、事件、权限与取消协议。

### 0.4 非目标（由宿主/生态承担，非砍需求）

- GUI：宿主应用承担，引擎只发事件。
- 模型训练/托管：引擎只做适配。
- 云同步：本地优先，同步是上层服务。

---

## 1. 总体分层

```
┌──────────────────────────────────────────────────────────┐
│  消费层   CLI(TUI)      App Server(JSON-RPC)      SDK     │
├──────────────────────────────────────────────────────────┤
│  协议层   协议 codec / 握手 / 事件流 / 双向 request          │
├──────────────────────────────────────────────────────────┤
│  内核层   Agent Kernel（微内核）                            │
│           Turn/Step 状态机 · 事件账本 · 调度 · 取消          │
│           预算 · 权限链路底线 · 插件宿主                      │
├──────────────────────────────────────────────────────────┤
│  能力层（seam，全部可替换）                                  │
│   LlmService · ToolRegistry · ToolExecutor                │
│   PermissionPolicy · ExecutionSandbox · FileSystem        │
│   ProcessRunner · SessionStore · ContextProjector         │
│   PromptComposer · ArtifactStore · SubagentProvider       │
│   CredentialResolver · Telemetry                          │
├──────────────────────────────────────────────────────────┤
│  插件层   工具插件 · Prompt 片段 · Hooks · Policy            │
│           模型适配器 · 上下文提供者 · MCP 桥 · Skills        │
├──────────────────────────────────────────────────────────┤
│  存储层   事件日志(JSONL+SQLite) · 制品库(hash 寻址)         │
└──────────────────────────────────────────────────────────┘
```

关键分层原则（dsh 哲学的落地）：

- **内核小而可信**：只掌握生命周期、事件账本、取消/终态唯一性、权限底线、插件隔离。模型、工具、提示词、策略、存储、沙箱**全部**是 seam 上的可替换实现。
- **插件不能破坏内核不变量**：插件通过「注册事务 + 可逆 effect」扩展能力，卸载时按逆序回滚。

---

## 2. 领域模型与内核不变量

### 2.1 核心名词

| 名词         | 定义                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Session**  | 持久会话：事件日志 + 工作区绑定 + 配置快照，磁盘上有唯一 id                                                                          |
| **Turn**     | 一次用户提交 → agent 工作 → 唯一终态。状态：queued → running → (waiting_permission / waiting_input) → completed / cancelled / failed |
| **Step**     | Turn 内一轮：构建上下文 → 调模型 → 执行其工具调用                                                                                    |
| **Event**    | 不可变事实，append-only 日志的唯一条目；**一切皆投影**                                                                               |
| **Tool**     | 声明式 schema + 执行器 + 权限类别 + 风险元数据                                                                                       |
| **Plugin**   | 能力打包单元（工具/hooks/prompt 片段/策略/模型适配器）                                                                               |
| **Context**  | 某一步真实发给模型的消息数组（事件投影 + 注入的结果）                                                                                |
| **Artifact** | 大体积产物（工具完整输出/图片），hash 寻址存储，事件只存引用                                                                         |

### 2.2 八条内核不变量（顶级 Agent 与 Demo 的分水岭）

1. **事件日志是唯一事实源**：UI、模型上下文、恢复、fork、回放全部从日志投影；日志没有的不存在。
2. **终态唯一性（exactly-once）**：每个 Turn 恰好一个终态事件；finalize 幂等，崩溃/取消竞态下不双写。
3. **模型可见 ⟹ 已记录**：任何进入模型上下文的内容必须先落事件（审计与回放的根基）。
4. **权限 fail-closed**：未知工具、策略求值异常、沙箱缺失但模式要求 → 一律拒绝，永不放行。
5. **上下文组装确定性**：相同事件 + 相同配置 ⇒ 相同请求字节（除显式标记的易变尾部）；这是提示缓存命中与可复现的前提。
6. **一切可取消**：AbortSignal 贯穿模型流、工具子进程、文件写入；取消不产生半态损坏。
7. **可重放**：resume / fork / replay / 回归测试全部从日志重建，无需额外状态。
8. **插件可逆**：注册产生的每个 effect 都有 disposer；停用按逆序回滚；内核持有注册事务日志。

---

## 3. Agent Kernel：Turn/Step 完整状态机

### 3.1 状态机总览

```
turn.start(input)
  ├─ append turn.started（先落账本）
  ├─ 获取 Turn 租约（每 session 单活动 turn；并发提交 → 排队或拒绝，可配置）
  ▼
┌─ Step 循环 ─────────────────────────────────────────────┐
│ 1. context = Projector(events, config, injections)      │
│    （含压缩检查：超阈值 → 先 compact 再发）                │
│ 2. append step.started                                   │
│ 3. LlmService.stream(context, tools, budget)             │
│     ├─ 增量 delta → assistant.delta 事件 → 传输层         │
│     └─ 流错误 → 分类重试（见 §5.5）                       │
│ 4. 解析完整 assistant 消息：                              │
│     ├─ 纯文本 → 循环出口 A                                │
│     ├─ tool_calls(N 个，可并行) → 工具阶段                 │
│     └─ 空响应 → empty-response 策略（重试/终止）           │
│ 5. 工具阶段（每个 call）：                                 │
│    a. JSON Schema 校验参数（失败→带错误回喂，有界重试）      │
│    b. append tool.call                                   │
│    c. PermissionEngine.check → allow/deny/ask            │
│       ask → park 至 waiting_permission，经传输层问宿主/    │
│       用户，append permission.decided，带超时策略          │
│    d. 冲突检测：并行写同目标 → 串行化或拒绝                 │
│    e. append tool.intent（执行前标记，崩溃恢复用）          │
│    f. ToolExecutor 执行（超时/取消/输出捕获）              │
│    g. append tool.result（截断入库 + artifact 全文引用）   │
│    h. 更新工作状态（FS 索引、token 台账）                   │
│ 6. 预算检查：token/费用/墙钟/步数/工具次数                  │
│    超限 → 注入警告或按策略终止                             │
│ 7. 回到 1                                                │
└──────────────────────────────────────────────────────────┘
出口 A：模型不再调工具且给出最终文本 → turn.completed
出口 B：预算耗尽 → turn.completed(budget_stop)
出口 C：取消 → 停流+杀子进程(SIGTERM→SIGKILL 阶梯) → turn.cancelled
出口 D：不可恢复错误 → turn.failed
```

### 3.2 顶级特性逐项规范

**Steering（运行中插话）**

- 输入队列：turn 运行中来的新消息默认排为下一 turn；
- steer 模式：在 **step 边界**注入当前 turn（模型下一轮即可看到，不必打断工具）；
- 紧急打断：宿主可先 cancel 再补提交（保留已产出事件）。

**并行工具调度**

- 工具声明 `concurrency: parallel | serial | exclusive`；
- 只读工具（read/grep/glob）默认并行；写类串行；同目标写冲突 → 拒绝并回喂冲突说明；
- 有界并发池，上限可配。

**崩溃恢复**

- 启动加载会话时发现非终态 turn → 标记 `turn.failed(crash)` 并发 recovery 事件；
- `tool.intent` 无对应 `tool.result` → 孤儿执行告警；对非幂等工具**绝不自动重放**，向用户呈现「可能已部分执行」清单 + 校验手段。

**检查点（撤销的前提）**

- 破坏性工具批次执行前记录工作区快照引用：git 仓库内做 shadow commit，仓库外做文件快照；
- `/rewind` = 回滚快照 + 截断事件日志（截断本身也是事件）。

**提示缓存工程（成本的决定性因素）**

- 系统提示 + 工具定义 + 历史消息构成**稳定前缀**，永不重排；
- 工具定义按注册序稳定排序；
- 易变信息（日期、cwd、git 状态）放系统提示**尾部**的显式 volatile 段，避免击穿缓存；
- 每步记录 cache_read/cache_write token，命中率进入 telemetry。

### 3.3 预算系统

- 四类预算：token、货币成本、墙钟时间、步数/工具次数；
- 来源分层：全局默认 < 用户配置 < 会话配置 < 单 turn 覆盖 < 子代理继承份额；
- 软超限 → 注入提醒让模型自我收敛；硬超限 → 终止并出报告。

---

## 4. 事件系统与持久化

### 4.1 事件 schema（v1 核心）

```ts
type AgentEvent =
  // 会话
  | { type: 'session.started'; sessionId; ts; configSnapshot }
  // Turn
  | { type: 'turn.started'; turnId; input: UserInput; parentId? }
  | { type: 'turn.queued'; turnId }
  | { type: 'turn.completed'; turnId; reason: 'final' | 'budget'; stats: TurnStats }
  | { type: 'turn.cancelled'; turnId; partial: ItemRef[] }
  | { type: 'turn.failed'; turnId; error: ErrInfo; recoveryHint? }
  // Step
  | { type: 'step.started'; stepId; turnId }
  | { type: 'assistant.completed'; stepId; message; usage: Usage }
  // 注：assistant.delta 是传输层瞬态，不入事实账本（实时增量经协议层内存转发）。
  // 事实日志只记 completed——这是「黄金日志逐字节确定性」的前提：网络分片粒度天然不确定，不能成为事实。
  // 工具
  | { type: 'tool.call'; callId; tool; args }
  | { type: 'tool.intent'; callId } // 执行前 WAL 标记
  | { type: 'tool.result'; callId; result; artifactRef? }
  // 权限
  | { type: 'permission.requested'; requestId; callId; risk }
  | { type: 'permission.decided'; requestId; decision; grantScope? }
  // 上下文
  | { type: 'context.compacted'; summaryRef; droppedRanges }
  | { type: 'log.rewind'; toSeq }
  // 其他
  | { type: 'plugin.activated' | 'plugin.deactivated'; pluginId; effects }
  | { type: 'user.answered'; requestId; answer }
```

每条事件带全局递增 `seq` + 会话 id + 单调时间戳；协议层按 `seq` 保序。

### 4.2 存储设计

- **JSONL**（可移植、可 grep、可 diff）为事实文件 + **SQLite**（索引/FTS/查询加速）为投影，二者都过 `SessionStore` seam，可替换（M1 纯 JSONL，SQLite 投影 M3 进，接口先留位）。

### 4.2.1 会话落点（已定案：全局事实库 + 项目内仅配置）

对照两家主源实测（本机验证，2026-08-26）：

| 产品             | 会话事实日志                                                        | 项目内放什么                           |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------- |
| Claude Code      | `~/.claude/projects/<项目路径编码>/<sessionId>.jsonl`               | `.claude/`（settings、CLAUDE.md 指令） |
| Codex            | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + 全局 `config.toml` | `AGENTS.md`                            |
| **spark-engine** | `~/.spark/projects/<munged-cwd>/<sessionId>/events.jsonl`           | `.spark/`（仅配置与规则）              |

我们的布局（采用 Claude 的「按项目分组」而非 Codex 的「按日期分桶」——列出一个项目的全部会话是高频操作）：

```
~/.spark/
  config.toml                      # 全局用户配置
  credentials/                     # 凭据引用（值在系统 Keychain）
  projects/<munged-cwd>/           # munged-cwd = 绝对路径中 '/' → '-'（Claude 同款编码）
    <sessionId>/
      events.jsonl                 # 事实日志（唯一事实源）
      session.json                 # 会话元数据（title、创建时间、configSnapshot 引用）
  artifacts/<sha256前2位>/<hash>    # 全局内容寻址制品库（跨会话去重）
  index.db                         # SQLite 投影（会话/事件索引、FTS、指标聚合）
项目内 .spark/
  config.toml                      # 项目配置（可提交，团队共享）
  config.local.toml                # 项目本地配置（不提交，gitignore 模板提供）
  AGENTS.md                        # 项目规则文件（指令注入，见 §11.3）
```

**为什么事实库放全局、项目内只放配置**：① 会话日志是「机器事实」而非「人的协作意图」，放项目内会污染 git、膨胀仓库；② 多设备/备份只需同步一个 `~/.spark/`；③ 跨项目的会话检索（"我上周在哪个项目做过 X"）只在全局库才能成立；④ 项目内保留的是**可提交的共享意图**（权限规则、模型路由、AGENTS.md），与两家主流产品的共识一致。checkpoint 的 git shadow commit 例外（必须落在本仓库内，见 §3.2）。

- **ArtifactStore**：内容 hash 寻址（`sha256` 前缀分桶），存工具完整输出/图片/大 diff；事件与上下文只带引用 + 摘要。
- **fork**：复制日志前缀到新 session id（O(seq) 拷贝）；**resume**：重放日志重建上下文续跑；**export**：session → markdown/json。

### 4.2.2 事件 schema 版本与迁移（日志是永久资产）

- 每条事件带 `schemaVersion`；每个会话目录首事件 `session.started` 记录当时的引擎版本与 schema 版本；
- 读取策略：**读时升级（lazy migration）**——旧版本事件在投影层经已注册的迁移函数逐条升级，**落盘文件永不重写**（append-only 的代价就是不回头改）；
- 迁移函数链：`migrations/` 目录按 `fromVersion → toVersion` 注册，与数据库 migration 同构；未注册迁移的版本 → 拒绝加载并明示引擎版本要求，不静默误读；
- 新增字段只能可选；枚举值只增不删；`type` 判别字段永不改名——这些约束写进 schema 的 CI 兼容性测试（§14.2）。

---

## 5. 模型适配层（LlmService）

### 5.1 适配器接口

```ts
interface LlmAdapter {
  id: string // 内置仅 'anthropic' | 'openai-responses'；更多协议经插件扩展
  capabilities(modelId): ModelCaps // 工具/并行调用/思考流/缓存断点/prefill/图像
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmDelta>
}
```

统一内部请求/增量格式（内核不感知任何厂商协议），适配器负责双向翻译：

- 请求：内部消息树 → 厂商格式（工具 schema、system 位置、多模态分块、缓存断点插入）
- 响应流：厂商增量 → 统一 delta（text / thinking / tool_call_partial / usage / heartbeat）

### 5.2 双协议决策与统一 IR（已定案：可以做到 CLI 内部自行适配）

内置适配器**只有两个**，内核、工具、上下文逻辑只面对统一 IR，永不感知厂商协议：

1. **Anthropic Messages**——缓存断点、thinking、interleaved tool use
2. **OpenAI Responses**——Codex 同源协议，原生工具调用与 reasoning

覆盖面说明：国内主流渠道（GLM / Kimi / Qwen / DeepSeek 官方与聚合网关）普遍提供 Anthropic Messages 兼容端点，OpenAI 系生态普遍提供 Responses——双协议的实际覆盖远大于表面。若某渠道只提供 Chat Completions：出路是渠道侧转换，或第三方以**插件**形式提供 `openai-chat` LlmAdapter（seam 天然开放，加协议 = 加插件，不改内核）；官方不维护第三协议。

**统一 IR（内部中间表示）**——适配的全部复杂度收敛在这里：

```ts
interface LlmRequest {
  system: SystemSection[] // 稳定段与 volatile 尾段分开声明（提示缓存工程，§3.2）
  messages: IrMessage[] // user / assistant / tool_result 标准消息树
  tools: IrToolDef[] // JSON Schema 工具定义（按注册序稳定排序）
  thinking?: { budgetTokens: number }
  cacheBreakpoints?: number[] // 逻辑断点位置，由 adapter 翻译为各家原生机制
  maxTokens: number
  stopSequences?: string[]
  metadata: Record<string, string> // 透传审计字段（sessionId/turnId）
}
```

adapter 双向职责：IR → 厂商请求（system 位置、工具 schema 形态、多模态分块、缓存机制翻译）；厂商流式增量 → 统一 `LlmDelta`（`text | thinking | tool_call_partial | usage | heartbeat`）。

**能力降级矩阵（能力协商）**：`ModelCaps` 按模型声明能力位，投影器按位裁剪，内核零 `if 厂商`：

| IR 能力           | Anthropic Messages       | OpenAI Responses          | 两者皆无时               |
| ----------------- | ------------------------ | ------------------------- | ------------------------ |
| 工具调用          | `tool_use` blocks        | `function_call` items     | 系统提示内 JSON 协议模拟 |
| 思考流            | thinking blocks + budget | reasoning summary         | 剥离 thinking，不请求    |
| 提示缓存          | `cache_control` 断点     | `prompt_cache_key` / 自动 | 不打缓存标记，照常请求   |
| 并行工具调用      | 原生多 block             | 原生多 item               | 强制串行化               |
| assistant prefill | 尾部拼接                 | 上一条 assistant 消息     | 丢弃 prefill 并告警      |

**自动协议适配（决策序）**：

1. 显式配置 `protocol: 'anthropic' | 'responses'` 最高优先；
2. base URL / 模型名启发（`claude-*`、路径含 `/anthropic` → anthropic；`gpt-*` / `o*` / `codex-*`、路径含 `/responses` → responses）；
3. 握手探测：最小请求验证响应形态，失败自动换另一协议重试一次；
4. 探测结论缓存进 `models.json`，`spark doctor` 可见、可手动覆盖。

运行期形态不符（声明 anthropic 却返回 Responses 结构）→ 报明确错误并给修正建议，**不静默误读**。每次适配结论（含探测依据）写入 telemetry，`doctor` 可解释「为什么走了这个协议」。

### 5.3 模型与 Provider 注册表

- `~/.spark/config.toml` + 项目 `.spark/config.toml`：provider(baseUrl、apiKeyEnv、协议) + 模型列表（上下文窗口、价格表、能力位）；
- SparkWork 运行时渠道通过版本化 Host Bridge 动态加入同一注册表，不复制配置；
- `spark models` 查看，`spark doctor` 诊断；本地凭据只经 env seam 读取，宿主凭据只在受认证 loopback 代理内按需解析，**永不落配置快照或日志**。

### 5.4 路由与故障转移

- 任务类 → 模型路由规则（如 plan 用强模型、compact 用便宜模型、子代理按预设）；
- 失败链（failover chain）+ 每 provider 健康度跟踪；上下文超长错误 → 自动 compact 后重试。

### 5.5 重试策略（按错误类别）

| 错误                 | 策略                                |
| -------------------- | ----------------------------------- |
| 429                  | 尊重 retry-after，抖动退避          |
| 5xx / 超时           | 指数退避，有界次数，然后走 failover |
| overloaded           | 直接切备 provider                   |
| context overflow     | 自动 compact → 重试一次             |
| 流中断（已产 delta） | 续传或整轮重试，按厂商支持决定      |

### 5.6 成本台账

- 每步记录 input/output/cache_read/cache_write token × 价格表 → 会话/日/工具/模型多维聚合；`spark stats`。

---

## 6. 工具系统

### 6.1 工具契约（注册的元数据驱动调度与权限默认值）

```ts
interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
  readonly: boolean // 无副作用 → 可并行
  destructive?: boolean // 永不自动重试，权限从严
  approval: 'never' | 'once' | 'session' | 'always'
  concurrency: 'parallel' | 'serial' | 'exclusive'
  timeoutMs: number
  interruptible: boolean // 可否中途 abort
  costClass: 'io' | 'cpu' | 'network'
}
```

### 6.2 内置工具全家桶（对标 Claude Code）

| 类    | 工具                             | 关键工程细节                                                                                                                    |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 文件  | read / write / edit / multi-edit | read 带行号、范围、图像直读；edit 精确匹配替换，未命中时给模糊定位建议（"did you mean…"），临时文件+rename 原子写，改后复读校验 |
| 搜索  | glob / grep / find               | 内嵌 riprep 优先，降级纯 JS 实现；结果带上限 + 「缩小范围」提示                                                                 |
| Shell | bash                             | 一次性与持久 shell 会话两种模式；后台任务 spawn + 输出监控 + kill 阶梯；大输出尾部 tail；退出码语义                             |
| 代理  | task（spawn 子代理）             | 见 §12                                                                                                                          |
| Web   | fetch / search                   | 搜索 provider 插件化；抓取结果脱敏进 artifact                                                                                   |
| 交互  | ask_user / request_permission    | 结构化提问（选项/自由文本）                                                                                                     |
| 计划  | todo                             | 任务清单工具，状态驱动渲染                                                                                                      |
| 笔记  | notebook_edit                    | Jupyter 单 cell 替换                                                                                                            |
| 记忆  | memory_write                     | 落长期记忆 seam                                                                                                                 |
| 桥接  | mcp\_\_\*                        | MCP 工具命名空间化接入                                                                                                          |

### 6.3 工具输出管道（质量放大器）

```
执行 → 流式捕获 → 截断(头 N + 尾 M + 省略标记) → 全文入 ArtifactStore(hash)
     → tool.result 事件存引用+摘要 → 投影层按策略展开
```

省略标记必须**教模型如何取更多**（如 read 的 offset 参数），模型不会卡死在截断上。

### 6.4 工作区状态感知

- 轻量 FS 索引（path→mtime/size/hash）做新鲜度检查；
- 「文件在你上次读取后被外部修改」告警注入；
- edit 前置校验：old_string 所在内容与模型所见一致。

### 6.5 MCP 桥

- 传输：stdio / Streamable HTTP（含 SSE 向后兼容）；
- 工具命名空间：`mcp__<server>__<tool>`（与 Claude Code 一致，技能与提示词跨引擎可复用）；
- 生命周期归插件体系：一个 MCP server = 一个能力包（T1/T2），崩溃自动重启、重启期间其工具临时下线（fail-closed，调用得到明确「server 重启中」错误而非静默失败）；
- MCP JSON Schema → `IrToolDef` 转译（不可表达的字段降级并在 doctor 中提示）；OAuth 授权流经宿主/CLI 交互完成；
- MCP 工具输出同样过 §6.3 输出管道与 §7 权限链路（MCP 工具默认 `ask`，规则引擎可放行）。

---

## 7. 权限与安全（双轴设计）

```
PermissionPolicy：允不允许做        （规则引擎，人的意图）
ExecutionSandbox：即使允许，最多能做什么（隔离机制，机器的边界）
```

### 7.1 权限规则引擎

- 规则 = 工具名模式 + 参数匹配器（路径 glob 限定工作区内 / 命令前缀如 `git status`、`npm test`）→ allow / ask / deny；
- 合并序（后者覆盖前者）：内置默认 < 用户配置 < 项目配置 < CLI flag < 宿主运行时授权 < 会话内用户临时授权；
- 权限模式：`default`（风险询问）/ `acceptEdits` / `plan`（只读强制：写类工具直接不可用，模型被引导输出计划）/ `bypass`（显式危险警告后放行）；
- 审批 UX 展示**真实命令与真实路径**；选项：允许 / 本会话不再问 / 永久(写配置) / 拒绝(可附理由回喂模型)；
- 每次决策都是事件（可审计、可回放）。

### 7.2 沙箱矩阵

| 层       | 手段                                                                                   |
| -------- | -------------------------------------------------------------------------------------- | ------------------------ |
| L1 路径  | 工作区根限定、`..`/symlink 解析防逃逸                                                  |
| L2 命令  | shell 危险模式静态分析（rm -rf、sudo、curl                                             | sh…）、网络策略 per-tool |
| L3 OS 级 | macOS Seatbelt / Linux namespace+seccomp / Windows job object + 降权（分平台渐进落地） |
| 进程     | 超时、资源上限、进程组管理                                                             |

### 7.3 提示注入防御（诚实定位：纵深缓解，非根除）

- 工具输出标记为数据（taint 标记，尤其 web 抓取内容）；
- 带 taint 内容触发的敏感工具调用 → 强制升级审批；
- 系统提示中的规则优先级声明 + 注入模式启发式检测。

### 7.4 fail-closed 清单

未知工具 → deny；策略求值抛错 → deny；L3 模式要求沙箱但沙箱不可用 → block；审批超时 → 按拒绝处理。

---

## 8. 插件体系（热插拔脊柱）

### 8.1 清单（spark-plugin.json）

```json
{
  "id": "com.example.web-tools",
  "version": "1.2.0",
  "apiVersion": "1.x",
  "entry": "./dist/index.js",
  "capabilities": ["tool", "hook", "prompt-section", "policy", "context-provider"],
  "dependencies": { "other-plugin": "^1" },
  "pluginPermissions": ["fs.read:./", "net:api.example.com"],
  "configSchema": { "...": "JSON Schema" }
}
```

### 8.2 隔离分级

| 层级 | 运行方式                                                      | 用途                      |
| ---- | ------------------------------------------------------------- | ------------------------- |
| T0   | 内核内置进程内                                                | 官方核心工具              |
| T1   | 进程内隔离 realm/worker，能力按句柄传递（拿不到内核对象引用） | 高性能官方/认证插件       |
| T2   | 子进程（同一 JSON-RPC 插件协议）                              | 崩溃隔离 + 任意语言       |
| T3   | 远程                                                          | 网络 marketplace 动态加载 |

插件自身的 `pluginPermissions` 声明**插件能调用哪些内核能力**（最小权限）。

### 8.3 可逆 effect 与注册事务（dsh 核心）

```
activate(manifest)
  → 开启注册事务 → 逐个 capability 注册，每个返回 disposer
  → 全部成功 → 提交事务，append plugin.activated(含 effect 清单)
  → 任一失败 → 立即逆序回滚，会话零残留
deactivate(id) → 逆序执行 disposer → append plugin.deactivated
```

内核维护注册事务日志：哪些插件注入了哪些工具/hooks/prompt 片段，随时可查、可整体回滚。

### 8.4 热插拔静止点（工程上可靠的热更新）

| 能力类别                                         | 可热更时机 |
| ------------------------------------------------ | ---------- |
| 工具 / prompt 片段 / hooks / policy / 模型适配器 | step 边界  |
| FileSystem / Shell / Sandbox / SubagentProvider  | turn 边界  |
| 事件存储 / 协议 codec / 凭据库 / 隔离宿主        | 仅启动时   |

升级 = 新版本 side-by-side 加载 → 停止路由新调用 → 排水旧实例 → dispose。

### 8.5 Hooks（事件驱动扩展点）

`session:start · turn:start · step:start · context:assemble(可变) · llm:request(可变) · llm:response · tool:call(可否决/改参) · tool:result · permission:evaluate(可覆盖) · compact · turn:end · error`

- 契约标注：同步快速路径 vs 异步、超时、失败策略（critical → 中止 turn；advisory → 记日志继续）；
- 排序：priority + 注册序；单插件 hook 崩溃不拖垮 turn（隔离舱）。

### 8.6 分发

npm / git / 本地目录三种来源；清单签名校验；加载时 semver ABI 兼容检查（不兼容 → 拒载并明说）；类型化插件 SDK 包 `@spark/agent-plugin`（schema 生成）。

---

## 9. App Server 协议（宿主接入面）

### 9.1 传输与握手

- stdio，按行分隔的 JSON-RPC 2.0（与 codex app-server 同构；后续加 WebSocket）；
- `initialize` 握手做能力协商与协议 semver；事件通知带 `(sessionId, turnId, seq)` 保序幂等。

### 9.2 方法表（v1）

```
宿主→引擎   initialize / shutdown
           session.create / session.load / session.list / session.fork
           turn.start / turn.steer / turn.cancel
           question.answer / permission.decide
           config.get / config.set
           plugin.list / install / enable / disable
           model.list / model.route.set
引擎→宿主   notification:event          （增量事件流，批量+有序）
           request:permission           （审批请求，双向 request）
           request:question             （向用户提问）
           notification:usage / status / log
```

- schema-first：zod 定义 → 生成 TS 类型 + JSON Schema + 文档；
- 所有跨边界数据版本化；SparkWork 侧以宿主适配器消费，引擎侧零 UI 知识。

---

## 10. CLI 与交互

### 10.1 命令族

```
spark                      # 交互 TUI（REPL，默认）
spark "任务" / -p "..."     # 一次性执行
spark --output-format json|stream-json   # 脚本化
spark serve                # 宿主模式（无 TUI）
spark resume [sessionId] / fork / export / replay
spark config / models / login
spark plugin install|list|disable|update
spark eval                 # 评测入口
spark doctor               # 环境/凭据/模型/沙箱自检
spark stats                # 成本与用量
```

### 10.2 TUI（Ink / React for terminal）

**设计定稿：`todo/spark-engine-TUI终端界面设计.md`**（布局五区、事件→组件投影表、ToolCard/PermissionCard/InputEditor 规范、IME 组合守卫、中断与排队语义、色彩降级链、确定性渲染测试）。核心原则：

- TUI 是事件日志的又一个投影——与 SparkWork 宿主 GUI、模型上下文同源消费事件流，UI 内不存在「日志之外的状态」；
- 已落定事件进 Ink `<Static>` 只渲染一次，仅活动尾（流式增量/运行中工具卡/权限卡/输入区）重绘——渲染成本与「新增事件」成正比，与历史长度无关；
- 终端原生哲学：不自绘全屏视窗、不劫持 scrollback，尊重 NO_COLOR 与 256/16 色、Unicode 降级，非 TTY 自动纯文本模式；
- TUI 随 M1 交付（FakeModel 后端即可完整交互）；markdown 流式渲染与 diff 高亮 M2，多会话切换 M3。

### 10.3 非交互开关

`--model --fallback-models --permission-mode --allowedTools --max-cost --max-steps --dangerously-skip-permissions`。

---

## 11. 上下文工程

### 11.1 投影规则（事件 → 模型消息）

- 每工具结果展开策略：头/尾/中部省略、行数上限、按工具类别差异化；
- 图像：直读 inline，抓取类进 artifact + 引用；
- 思考块按模型能力决定保留/剥离；
- 不同模型家族投影不同（system 位置、工具格式、prefill 支持）。

### 11.2 压缩（compaction）算法

1. 超阈值触发（自动）或 `/compact`（手动）；
2. 保留：系统提示 + 项目配置 + 最近 K 轮逐字（K 按预算自适应）；
3. 老工具结果降采样（保结构保引用，丢正文）；
4. 仍超 → 用廉价模型生成**结构化摘要**（目标/决策/约束/产物清单/未决线程/近期逐字尾部）；
5. 压缩本身是事件（`context.compacted`），回放可见。

### 11.3 注入体系

- 项目规则文件（AGENTS.md 类）、用户记忆、目录结构图 → `context:assemble` hook 可变；
- Skills 渐进披露：系统提示只放元数据目录，完整说明按需经工具加载（与 SparkWork 技能概念对齐，技能可跨引擎复用）。

### 11.4 Token 记账

- 每模型 tokenizer（openai-compat 近似估算 + API usage 回填校准）；
- 三段预算：系统保留 / 输出预留 / 上下文可用；逼近阈值即触发压缩检查。

---

## 12. 子代理与多智能体

- `task` 工具 spawn 子代理：独立事件日志（`parentSessionId` 链接）、独立上下文与预算份额、结果回交；
- 代理预设 = 名称 + 系统提示 + 工具子集 + 模型（配置/插件提供）；递归深度上限、成本从父预算分摊；
- 后台代理 + 完成通知（monitor 模式）；
- 团队模式（host + 成员消息传递）：协议原生支持（会话互通），首版实现按构建顺序排后，但 schema 先留位。

---

## 13. 配置系统

- 分层合并：内置默认 < `~/.spark/config.toml` < 项目 `.spark/config.toml` < env `SPARK_*` < CLI flag；
- 全量 JSON Schema 校验，`config/schema.json` 随包发布；
- 会话启动时配置快照入事件（保证不变量 5 的可复现）。

---

## 14. 可观测性、测试与评测

### 14.1 遥测

- 结构化日志（每会话文件 + 轮转）；OTEL span 层级 `session → turn → step → llm.call / tool.call`；
- 本地 SQLite 指标库；成本/时延/工具错误率多维聚合。

### 14.2 确定性测试（内核质量的地基）

- **FakeModel**：脚本化模型响应（预排工具调用序列）；
- **VirtualFS / FakeShell**：确定性工具执行环境；
- 黄金事件日志对比：同一脚本必须产出逐字节相同的日志（不变量 5 的直接验证）。

### 14.3 评测与回放

- `spark eval`：本地任务套件 + 夜间真实模型回归（预算封顶）；指标：任务成功率 / 工具错误率 / 平均步数 / 单任务成本 / p95 首响与完成时延；
- 对抗集：权限绕过套件、注入语料；
- `spark replay <session>`：时间旅行调试、两次运行 diff（回归利器）。

---

## 15. 目录结构（可移植单元）

```
spark-engine/                  # ← 整体可搬移
  package.json                 # name: @spark/agent; bin: spark
  tsconfig.json  eslint.config.js  .github|scripts/boundary-check.*
  src/
    kernel/        # turn/step 状态机、调度、取消、预算、终态
    events/        # 事件 schema、日志、投影
    context/       # 投影器、压缩、prompt 组装、token 记账
    llm/           # 适配器接口 + anthropic / openai-responses（双协议，§5.2）、路由、重试
    tools/         # 内置工具、注册表、执行器、输出管道
    permission/    # 规则引擎、沙箱、审批协议
    plugins/       # 插件宿主、清单、加载、隔离、hooks、注册事务
    protocol/      # app-server JSON-RPC 方法与 schema
    session/       # 存储适配器(jsonl/sqlite)、resume/fork/checkpoint
    cli/           # TUI(ink)、一次性执行、子命令
    sdk/           # 公共嵌入 API
    eval/          # FakeModel、虚拟环境、回放、指标
    telemetry/
  plugins/         # 第一方外置插件（示例 + 官方增值）
  docs/  test/  benchmarks/
```

- 单包多入口（`@spark/agent` / `@spark/agent-plugin`）+ 内部模块清晰边界；若膨胀再拆内部 workspace，**目录整体仍是搬移单元**。

---

## 16. 技术选型决策记录（ADR 摘要）

| 决策        | 选择                                          | 理由                                                                                                                 |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 语言/运行时 | TypeScript + Node ≥22.14                      | 团队前端背景、单一代码库覆盖 CLI/SDK/协议；Node 22 LTS 解锁 `node:sqlite` 并减少原生依赖；Rust 留给未来沙箱/单文件壳 |
| TUI         | Ink                                           | React 心智、终端渲染成熟度、主流实践                                                                                 |
| 存储        | JSONL + SQLite                                | 可移植 + 可查询，均过 seam 可替换                                                                                    |
| 协议        | 行分隔 JSON-RPC 2.0 over stdio                | 与 codex app-server 同构，宿主接入成本低                                                                             |
| schema      | zod 单源 → 类型/JSON Schema/文档              | 协议与插件 ABI 单一事实源                                                                                            |
| 构建        | tsup；分发 npm 包 + 后续 Bun --compile 二进制 | 渐进降复杂度                                                                                                         |
| 边界        | ESLint 规则 + CI 边界检查                     | “搬走即用”由工具保证                                                                                                 |

---

## 17. 差异化优势（不泯然众人的资本）

### 17.1 四家对标总表

| 维度     | Claude Code             | Codex CLI      | dsh         | **spark-engine**                                 |
| -------- | ----------------------- | -------------- | ----------- | ------------------------------------------------ |
| 内核形态 | 封闭单体内核            | Rust 单体      | 微内核哲学  | **微内核 + 8 条可测试不变量**                    |
| 模型协议 | Anthropic 系            | OpenAI 系      | 多协议      | **统一 IR 双协议 + 能力降级矩阵**                |
| 事实源   | JSONL（部分状态在内存） | rollout JSONL  | 事件事实源  | **全投影：UI/上下文/恢复/回放同源**              |
| 可复现性 | 部分                    | 部分           | 设计目标    | **黄金日志逐字节回归，CI 强制**                  |
| 扩展体系 | MCP / skills / hooks    | 配置式         | 可逆 effect | **注册事务 + 三级静止点热插拔 + 四级隔离**       |
| 安全模型 | 权限规则强              | sandbox + 审批 | seam        | **双轴显式化 + fail-closed 清单 + 决策全事件化** |
| 测试性   | 依赖真实模型            | 依赖真实模型   | —           | **FakeModel 确定性全链路，零 token 回归**        |
| 宿主耦合 | CLI 优先                | app-server     | —           | **CLI/App Server/SDK 同核同协议面**              |

### 17.2 七大招牌特性（每条 = 是什么 / 为什么别人没有或更弱 / 怎么保证不退化）

1. **确定性内核证书（Determinism Certificates）**——相同事件日志 + 相同模型响应 ⇒ 逐字节相同的行为；黄金日志对比进 CI，任何破坏确定性的 PR 直接红灯。Claude Code 与 Codex 都没有这个保证（它们的 JSONL 是记录，不是重建契约）。**保证手段**：不变量 5 的专项测试 + 时间/随机/cwd 全部经 `Clock`/`IdGen`/`EnvProbe` seam 注入。
2. **模型中立 IR + 能力协商**——单内核服务双协议，换模型家族不改内核代码；能力缺失走显式降级矩阵而非隐式丢弃。Claude Code 与 Codex 都是单厂商深绑（Codex 的模型中立也只覆盖 OpenAI 系协议）。**保证手段**：`ModelCaps` 位测试 + 降级路径黄金日志。
3. **可逆插件经济**——注册是事务，effect 有 disposer，停用逆序回滚，热更新只在静止点，插件崩溃隔离在 T1/T2 舱。dsh 有哲学，我们给出可验收的工程规范（无残留断言测试）。**保证手段**：激活→部分失败→回滚的黄金日志必须等于「从未激活」。
4. **双轴安全**——意图轴（PermissionPolicy：允不允许）与边界轴（ExecutionSandbox：即使允许最多能做什么）分离为独立 seam；每次决策是事件，行为可完整审计回放。**保证手段**：权限绕过对抗套件 0 逃逸（M5 验收）。
5. **制品库引用化上下文**——工具全文进 hash 寻址库，模型上下文只带引用+摘要+取回指引；上下文轻、token 省、产物可追溯可 diff。**保证手段**：截断输出的「取回指引」必须自证可用（模型用它能读回全文的回归用例）。
6. **多宿主同构**——CLI/TUI、App Server、SDK 是同一内核的三个面；`spark-engine/` 目录拷走即完整产品，SparkWork 只是第一个宿主而非绑定点。**保证手段**：边界 CI（§0.2）+ 协议 schema 单源生成。
7. **回放即调试（Replay as Debugger）**——任何历史会话可重放、可时间旅行、两次运行可 diff；回归排查从「重新跑一遍碰运气」变成「对比两份日志找第一个分叉点」。**保证手段**：replay 的输出必须与原日志在相同前缀下逐字节一致（FakeModel 下可验证）。

### 17.3 明确不比拼的方向（防止伪差异化）

不做自有模型、不做云端托管、不做 GUI 引擎、不追求「功能数量」竞赛——引擎的护城河是**可测试性、可复现性、可扩展性**这三件别人最难补的事。

---

## 18. 构建顺序（全量设计的施工排期，非范围裁剪）

| 阶段                   | 交付                                                                                                             | 验证标准                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| M1 内核骨架 + TUI 骨架 | 事件账本 + Turn/Step 状态机 + FakeModel + 预算/取消 + TUI REPL（事件投影/工具卡/权限卡/输入编辑器/中断/排队）    | 黄金日志确定性测试全绿；八不变量各有测试；TUI 渲染快照回归绿 |
| M2 真实能力            | 双协议适配器（anthropic / responses）+ 文件/搜索/shell 工具 + 权限双轴 + CLI 一次性模式 + TUI markdown/diff 渲染 | 真实任务端到端跑通；成本台账正确                             |
| M3 宿主接入            | resume/fork + 压缩 + App Server 协议 + SparkWork 第三引擎 + TUI 会话管理（/resume、多会话切换）                  | SparkWork 内完整会话；缓存命中率达标                         |
| M4 扩展体系            | 插件宿主/隔离/hooks/注册事务 + MCP 桥 + Skills                                                                   | 热插拔在静止点无残留；插件崩溃不影响 turn                    |
| M5 加固                | OS 沙箱 + checkpoint/rewind + 子代理 + evals/遥测面板                                                            | 权限绕过套件 0 逃逸；replay 可 diff                          |
| M6 分发                | 二进制、文档、marketplace 管道                                                                                   | 拷贝到干净机器单命令可用                                     |

每阶段都以完整设计中已定型的接口为交付物——接口在 M1 就按最终形态定义，后续阶段填实现，不产生“临时版 ABI”。

> 施工进度（2026-08-26）：M1 内核与 M2 首版真实能力已落地，包括双协议适配、工作区工具、权限模式、一次性 CLI/TUI、分层模型配置和 SparkWork Host Bridge；当前独立质量门覆盖 23 个测试文件、86 项测试及 npm 包安装烟测。App Server、MCP/插件宿主、OS 沙箱和多会话管理仍按 M3+ 里程碑推进。

---

## 19. 开放决策点

**已定案（2026-08-26）**：

1. ✅ 命名：目录 `spark-engine/`、包 `@spark/agent`、CLI `spark`。
2. ✅ 语言：TypeScript + Node ≥22.14（§16 理由成立，不引入 Rust 内核）。
3. ✅ 模型协议：内置仅 Anthropic Messages + OpenAI Responses 双 adapter + 统一 IR（§5.2）；更多协议经插件扩展。
4. ✅ 会话落点：全局事实库 `~/.spark/projects/<munged-cwd>/` + 项目内仅配置与规则文件（§4.2.1）。
5. ✅ M1 细化稿：事件 schema + 内核接口优先，已交付 `todo/spark-engine-M1-内核实现级spec.md`。
6. ✅ CLI 命令名 `spark`（全局库 `~/.spark/`、项目目录 `.spark/`、env 前缀 `SPARK_*` 同步统一）；TUI 设计已审阅通过，随 M1 开发。
7. ✅ M2 双协议并行落地：Anthropic Messages 与 OpenAI Responses 均有真实 HTTP/SSE adapter 和回归测试。
8. ✅ SQLite 投影放在 M3；M1/M2 以 JSONL 事实账本为权威存储。

**待定**：

- 当前首版范围内无阻塞开放决策；后续里程碑的实现级取舍在对应 feature spec 中定案。
