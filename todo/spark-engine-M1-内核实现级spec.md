# spark-engine M1 内核实现级 Spec

> 状态: 已落地 | 最后核对: 2026-08-26
>
> 上游文档：`todo/自研Agent引擎完整架构设计.md`（下称「主设计」）。本 spec 是主设计 §18 M1 行的实现级定稿：**读完即可直接开写代码，无待定项**。

---

## 0. 范围

**M1 = 主设计 §18 M1 行**：事件账本 + Turn/Step 状态机 + FakeModel + 预算/取消 + 确定性测试 + TUI REPL 骨架（TUI 实现级设计：`todo/spark-engine-TUI终端界面设计.md`）。

| 在范围内                                                         | 不在范围（接口留位，不实现）                          |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| 事件 schema 全量 zod 定义（含 M2+ 才产生的事件）                 | 真实模型 HTTP 适配器                                  |
| append-only 账本 + seq 分配 + 读时迁移链                         | CLI 完整命令族（serve/resume/eval…）/ App Server 协议 |
| TurnGate（exactly-once 终态守卫）                                | 插件加载与隔离宿主                                    |
| Step 循环 + 并行工具调度（FakeTools 上验证）                     | OS 级沙箱（L1 路径守卫做，L2/L3 留位）                |
| 四维预算 + AbortSignal 取消树                                    | 压缩（`context.compacted` 仅留位）                    |
| FakeModel 脚本引擎 + VirtualFS + FakeShell                       | 子代理、MCP 桥                                        |
| 权限最小引擎（allow/deny/ask + fail-closed）                     | 凭据 Keychain                                         |
| TUI REPL 骨架（事件投影表/ToolCard/权限卡/输入编辑器/中断/排队） | markdown 流式渲染 / diff 高亮 / @file / !shell 直通   |
| 黄金日志确定性测试 + 八不变量测试                                | SQLite 投影                                           |

**交付形态**：`spark-engine/` 目录内可独立 `npm install && npm test` 的包，全部测试绿色；`npm run build` 后 `bin/spark` 无参进入 REPL（FakeModel 后端）可完整交互。

---

## 1. 工程基线

- TypeScript `strict: true`，`module: NodeNext`，Node ≥ 22.14，ESM only。
- 依赖（M1 白名单，新增须过 ADR）：`zod`（schema 单源）、`ajv`（工具 JSON Schema 校验）、`tsup`（构建）、`vitest`（测试）、`ink` + `react`（TUI 渲染，TUI 设计 §1 ADR；仅 TUI 入口引用，serve/SDK 入口不携带）。除此之外零运行时依赖。
- 边界：遵守主设计 §0.2 四条硬规则（禁止 import 仓库其他目录 / 无 workspace 依赖 / ESLint+CI 边界检查 / 拷贝即用）。
- 单文件 ≤ 500 行（内核期从严，早于 3000 行红线）。

## 2. 目录骨架（文件级交付清单）

```
spark-engine/
  package.json              # name @spark/agent; bin spark（M1 占位）; type module
  tsconfig.json  eslint.config.js  vitest.config.ts  tsup.config.ts
  scripts/boundary-check.mjs
  src/
    seams.ts                # §4 全部 seam 接口（最终形态签名）
    env.ts                  # AgentEnv DI 装配 + createDefaultEnv / createDeterministicEnv
    kernel/
      clock.ts  ids.ts      # Clock / IdGen 默认实现（可注入替换）
      turn-gate.ts          # exactly-once 终态守卫（§5.1）
      turn-machine.ts       # Turn/Step 状态机主体（§5）
      scheduler.ts          # 每 session 单活动 turn 租约 + 排队
      budget.ts             # 四维预算（§6）
      cancellation.ts       # AbortSignal 树 + 取消语义
    events/
      schema.ts             # §3 全量 zod（含 M2+ 事件留位）
      migrations.ts         # 读时升级链（§3.4）
      ledger.ts             # append-only 账本（§3.3）
      projector.ts          # 事件 → LlmRequest 投影（M1 最小版）
    llm/
      types.ts              # 统一 IR：LlmRequest / LlmDelta / ModelCaps（主设计 §5.2）
      fake/model.ts  fake/reply-dsl.ts
    tools/
      contract.ts           # ToolDefinition（主设计 §6.1 原样）
      fake/virtual-fs.ts  fake/tools.ts  fake/shell.ts
    permission/
      policy.ts             # 规则引擎最小版 + fail-closed
      approver.ts           # FakeApprover（测试注入决策序列）
    sdk/agent.ts            # 公共入口：Agent.open / newSession / turn
    cli/main.ts             # bin 入口：子命令分发；无参 → REPL
    tui/
      app.tsx               # App：Static（已落定事件）+ Live（活动尾）分区
      projection.ts         # 事件 → 组件投影表（TUI 设计 §4）
      theme.ts              # 色彩 token + truecolor/256/16/mono 降级链
      ime-guard.ts          # 输入法组合守卫（229/isComposing，硬性测试）
      components/           # ToolCard / PermissionCard / InputEditor / StatusLine / QueuedBadge …
  test/
    golden/*.jsonl          # 黄金日志
    invariants/             # 八不变量 × 测试（§8）
    demos/demo-turn.test.ts
```

---

## 3. 事件 Schema（zod 全量，定稿）

### 3.1 公共标量与信封

```ts
import { z } from 'zod'

export const SchemaVersion = z.literal(1)

export const ErrInfo = z.object({
  code: z.string(), // 稳定错误码：'llm.network' | 'tool.timeout' | 'kernel.aborted' | ...
  message: z.string(),
  retryable: z.boolean(),
  detail: z.unknown().optional(),
})

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
})

export const ArtifactRef = z.object({
  sha256: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string(),
  summary: z.string(), // 截断后进入上下文的摘要/省略标记
  readHint: z.string(), // 教模型如何取回全文（主设计 §6.3）
})

// 每个事件对象的公共信封字段（用 spread 组合，不是独立 envelope 包一层）
const env = {
  schemaVersion: SchemaVersion,
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(), // 账本内全局递增、无空洞
  ts: z.number().int().nonnegative(), // 注入 Clock 的单调毫秒（确定性）
}
```

### 3.2 事件全集（discriminatedUnion on `type`）

```ts
export const AgentEvent = z.discriminatedUnion('type', [
  // ── 会话 ──
  z.object({
    ...env,
    type: z.literal('session.started'),
    engineVersion: z.string(),
    cwd: z.string(),
    configSnapshot: z.string(),
  }), // 稳定序列化(JSON+规范键序)后的配置

  // ── Turn ──
  z.object({
    ...env,
    type: z.literal('turn.started'),
    turnId: z.string(),
    input: z.object({
      kind: z.literal('text'),
      text: z.string(),
    }), // M2 扩 kind: image/file/ref
    parentId: z.string().optional(),
  }),
  z.object({ ...env, type: z.literal('turn.queued'), turnId: z.string() }),
  z.object({
    ...env,
    type: z.literal('turn.completed'),
    turnId: z.string(),
    reason: z.enum(['final', 'budget']),
    stats: TurnStats,
  }), // 见 3.2.1
  z.object({
    ...env,
    type: z.literal('turn.cancelled'),
    turnId: z.string(),
    partial: z.array(z.number().int()).default([]),
  }), // 已完成 step 的 seq
  z.object({
    ...env,
    type: z.literal('turn.failed'),
    turnId: z.string(),
    error: ErrInfo,
    recoveryHint: z.string().optional(),
  }),

  // ── Step（assistant.delta 不入账本，见主设计 §4.1 注）──
  z.object({ ...env, type: z.literal('step.started'), stepId: z.string(), turnId: z.string() }),
  z.object({
    ...env,
    type: z.literal('assistant.completed'),
    stepId: z.string(),
    turnId: z.string(),
    message: AssistantMessage,
    usage: Usage,
  }),

  // ── 工具 ──
  z.object({
    ...env,
    type: z.literal('tool.call'),
    callId: z.string(),
    stepId: z.string(),
    tool: z.string(),
    args: z.unknown(),
  }), // 已过 JSON Schema 校验
  z.object({ ...env, type: z.literal('tool.intent'), callId: z.string() }),
  z.object({
    ...env,
    type: z.literal('tool.result'),
    callId: z.string(),
    durationMs: z.number().int(),
    ok: z.boolean(),
    content: z.string(), // 进入上下文的（截断后）内容
    artifact: ArtifactRef.optional(),
  }),

  // ── 权限 ──
  z.object({
    ...env,
    type: z.literal('permission.requested'),
    requestId: z.string(),
    callId: z.string(),
    risk: z.object({ tool: z.string(), argsPreview: z.string() }),
  }),
  z.object({
    ...env,
    type: z.literal('permission.decided'),
    requestId: z.string(),
    decision: z.enum(['allow', 'deny']),
    grantScope: z.enum(['once', 'session']).optional(),
    reason: z.string().optional(),
  }),

  // ── 上下文（M1 留位，不产生）──
  z.object({
    ...env,
    type: z.literal('context.compacted'),
    summaryRef: ArtifactRef.optional(),
    droppedRanges: z.array(z.tuple([z.number(), z.number()])),
  }),

  // ── 日志操作 ──
  z.object({ ...env, type: z.literal('log.rewind'), toSeq: z.number().int() }),

  // ── 插件（M4 产生；M1 定义）──
  z.object({
    ...env,
    type: z.literal('plugin.activated'),
    pluginId: z.string(),
    effects: z.array(z.string()),
  }),
  z.object({ ...env, type: z.literal('plugin.deactivated'), pluginId: z.string() }),

  // ── 用户输入 ──
  z.object({
    ...env,
    type: z.literal('user.answered'),
    requestId: z.string(),
    answer: z.unknown(),
  }),
])

export const AssistantMessage = z.object({
  text: z.string().optional(),
  thinking: z.string().optional(),
  toolCalls: z
    .array(
      z.object({
        callId: z.string(),
        name: z.string(),
        args: z.unknown(),
      }),
    )
    .default([]),
})

const TurnStats = z.object({
  steps: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  usage: Usage,
  wallMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().default(0),
})
```

**兼容性铁律**（进 CI 测试，主设计 §4.2.2）：新增字段必须 optional；枚举值只增不删；`type` 判别名永不改；`seq/ts` 类型永不改。

### 3.3 账本（Ledger）

```ts
export interface Ledger {
  /** 唯一写入入口。实现必须保证：写序 = seq 递增序、无空洞、先持久化再返回。 */
  append<T extends AgentEvent>(event: Omit<T, 'seq' | 'ts'>): Promise<AgentEvent>
  read(fromSeq?: number): AsyncIterable<AgentEvent>
  latestSeq(): Promise<number>
}
```

- 文件实现：`events.jsonl` 逐行 append + `fsync`（策略可配：`always | step-boundary`，M1 默认 `step-boundary`——step 间崩溃最多丢当前 step，且丢失段无 `tool.intent` 对应残留，孤儿检测仍成立）。
- seq 由账本单调分配（进程内互斥队列串行化 append）。
- **写入顺序即事实顺序**：任何 await ledger.append 完成之前不得开始下一步副作用。

### 3.4 读时迁移链

```ts
type Migration = { from: 1 /*未来 2*/; upgrade(e: UnknownEvent): UnknownEvent }
export function registerMigration(m: Migration): void
export function decodeLine(line: string): AgentEvent // 逐条升级 + zod parse，失败即抛，不静默
```

M1 只有 v1；链与拒绝策略（无迁移可用 → 明确报错）先落地并被测试。

---

## 4. Seam 接口（`src/seams.ts`，最终形态签名）

```ts
/** 时序与标识——确定性的根基：一切时间与随机性必须经这两个口注入 */
export interface Clock {
  now(): number
  monotonicMs(): number
}
export interface IdGen {
  next(prefix?: string): string
}

export interface SessionStore {
  append(sessionId: string, event: AgentEvent): Promise<void>
  read(sessionId: string, fromSeq?: number): AsyncIterable<AgentEvent>
  latestSeq(sessionId: string): Promise<number>
  fork(sessionId: string, uptoSeq: number): Promise<string> // 返回新 sessionId
  list(projectDir: string | null): Promise<SessionMeta[]> // M3 接 SQLite 投影，M1 扫目录
}

export interface ArtifactStore {
  put(content: string | Uint8Array, mediaType: string): Promise<ArtifactRef>
  get(ref: ArtifactRef): Promise<string | Uint8Array>
}

/** 模型 seam——M1 由 FakeModel 实现，M2 换真实现，内核零改动 */
export interface LlmService {
  stream(req: LlmRequest, ctx: LlmCallCtx): AsyncIterable<LlmDelta>
}
export interface LlmCallCtx {
  signal: AbortSignal
  turnId: string
  stepId: string
}

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
}
export interface ToolExecutor {
  execute(call: ResolvedToolCall, ctx: ToolCallCtx): Promise<ToolOutcome>
}
export interface ToolCallCtx {
  signal: AbortSignal
  timeoutMs: number
}

export interface PermissionPolicy {
  check(call: ResolvedToolCall): Promise<PermissionDecision>
}
export interface Approver {
  // ask 时的双向 request 通道；M1=FakeApprover，M3 接协议层
  ask(req: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision>
}
export type PermissionDecision = { decision: 'allow' } | { decision: 'deny'; reason?: string }

export interface ContextProjector {
  /** 事件 → IR 消息数组。必须纯函数：同 events+config ⇒ 同输出（不变量 5） */
  project(events: AgentEvent[], config: ProjectorConfig): ProjectedContext
}
export interface PromptComposer {
  compose(facts: SessionFacts, config: ProjectorConfig): SystemSection[]
}

export interface BudgetKeeper {
  onStep(step: StepLedgerEntry): BudgetAction // 'continue' | { warn: string } | { stop: string }
  snapshot(): BudgetSnapshot
}

export interface Telemetry {
  counter(name: string, attrs?: Record<string, string | number>): void
  hist(name: string, value: number, attrs?: Record<string, string | number>): void
}
```

```ts
export interface AgentEnv {
  // 唯一 DI 口；生产/测试仅在此处分岔
  clock: Clock
  ids: IdGen
  store: SessionStore
  artifacts: ArtifactStore
  llm: LlmService
  tools: { registry: ToolRegistry; executor: ToolExecutor }
  permission: { policy: PermissionPolicy; approver: Approver }
  projector: ContextProjector
  prompt: PromptComposer
  budget: BudgetKeeper
  telemetry: Telemetry
}
```

---

## 5. Turn/Step 状态机（代码级规范）

### 5.1 TurnGate——exactly-once 终态守卫

```ts
class TurnGate {
  #state: 'open' | 'closed' = 'open'
  isClosed() {
    return this.#state === 'closed'
  }
  /** 竞态下第二个及以后的终态调用：直接吞掉并记 telemetry，不抛错、不落盘 */
  async finalize(make: () => Promise<AgentEvent>): Promise<AgentEvent | null> {
    if (this.#state !== 'open') return null
    this.#state = 'closed'
    return make()
  }
}
```

### 5.2 主循环（`turn-machine.ts` 伪代码定稿）

```ts
async runTurn(input, opts): Promise<TurnResult> {
  await ledger.append({ type: 'turn.started', turnId, input });
  const gate = new TurnGate();
  const cancel = cancellation.tree(opts.signal);        // turn → step → llm/tool 子 signal

  try {
    while (true) {
      throwIfAborted(cancel.signal);
      // 1. 投影（纯函数；压缩检查 M3 接入）
      const projected = projector.project(await collect(ledger.read()), config);
      // 2. 调模型
      await ledger.append({ type: 'step.started', stepId, turnId });
      const msg = await consumeStream(llm.stream(toLlmRequest(projected), { signal: cancel.signal, ... }));
      await ledger.append({ type: 'assistant.completed', stepId, turnId, message: msg.message, usage: msg.usage });
      // 3. 出口判定
      if (msg.message.toolCalls.length === 0) {
        return gate.finalize(() => ledger.append({ type: 'turn.completed', reason: 'final', stats }));
      }
      // 4. 工具阶段（按 concurrency 分组：parallel 进并发池；serial/exclusive 串行）
      const groups = groupByConcurrency(msg.message.toolCalls);
      for (const group of groups) {
        const outcomes = await pool(group, call => runToolCall(call, { signal: cancel.signal }));
        if (deniedAll(outcomes) && config.abortOnAllDenied) { /* 回喂后继续循环，不终止 */ }
      }
      // 5. 预算
      const action = budget.onStep(stepEntry);
      if (action.stop) {
        return gate.finalize(() => ledger.append({ type: 'turn.completed', reason: 'budget', stats }));
      }
    }
  } catch (e) {
    if (isAbort(e))  return gate.finalize(() => ledger.append({ type: 'turn.cancelled', partial }));
    return gate.finalize(() => ledger.append({ type: 'turn.failed', error: toErrInfo(e) }));
  }
}

async function runToolCall(call, ctx) {
  // a. registry.get(call.name) 不存在 → fail-closed：构造 deny 结果回喂（不抛异常终止 turn）
  // b. ajv 校验 args：失败 → 结果带 schema 错误回喂（有界重试由模型侧自然发生，内核不重发）
  // c. ledger.append({ type: 'tool.call', ... })                    ← 参数已定稿
  // d. policy.check → ask 则 approver.ask（全程可 abort）→ permission.requested/decided 落账
  // e. deny → tool.result{ok:false, content: '权限拒绝：…(reason)'} 回喂
  // f. ledger.append({ type: 'tool.intent' })                       ← WAL 标记
  // g. executor.execute（超时/取消传播）；输出过管道（截断+artifact+readHint）
  // h. ledger.append({ type: 'tool.result', ... })
}
```

**硬性顺序约束**（测试断言）：`tool.call → [permission.requested → permission.decided] → tool.intent → tool.result`；`tool.intent` 之后若进程崩溃，恢复扫描发现无配对 `tool.result` → 孤儿执行告警（M1 提供扫描函数 + 测试）。

### 5.3 取消语义

- `AbortSignal` 树：turn 信号派生 step 信号派生 llm/tool 信号；取消触发点全部 `throwIfAborted` + 子任务级 `signal.throwIfAborted()`。
- 取消落 `turn.cancelled`，`partial` = 已完成 step 的 seq 列表；进行中的工具收到 abort 后**必须**仍补一条 `tool.result{ok:false, content:'aborted'}`（保证账本无悬空 intent）。
- SIGTERM→SIGKILL 阶梯属 M2 真进程工具；M1 在 FakeShell 上模拟两段取消。

---

## 6. 预算（`budget.ts`）

- 四维：`maxInputTokens / maxCostUsd / maxWallMs / maxSteps`（+ `maxToolCalls`）。
- 分层来源：默认 < 全局配置 < 会话配置 < turn 覆盖（M1：代码默认 + turn 覆盖两层，配置系统 M3 接）。
- `onStep` 返回：`'continue'` | `{ warn }`（注入下一轮系统提醒）| `{ stop }`（→ `turn.completed(budget)`）。
- 软阈值 80% 触发 warn，硬阈值 100% stop；预算快照进 `TurnStats`。

## 7. FakeModel 与确定性环境

### 7.1 脚本 DSL

```ts
import { fakeModel, text, toolCall, fail, empty } from '../src/llm/fake/reply-dsl'

const model = fakeModel([
  text('我先读文件'),
  toolCall('c1', 'read', { path: 'a.ts' }),
  text('再改一行'),
  toolCall('c2', 'edit', { path: 'a.ts', old: 'x', new: 'y' }),
  fail('llm.network', { retryable: true }), // 用于重试路径测试
  empty(), // 空响应策略测试
  text('done'),
])
```

- 脚本按 step 消费；支持 `usage` 固定值（确定性）；`signal.aborted` 时抛 abort 错误（测试取消）。
- **确定性环境**：`createDeterministicEnv(script)` = FakeModel + 内存 SessionStore + VirtualFS + FakeApprover(预置决策序列) + 固定 Clock（步进 1ms）+ 顺序 IdGen（`s1 t1 p1 c1`…）。

### 7.2 FakeTools（VirtualFS / FakeShell 内存实现）

`read / write / edit / bash` 四个工具的完整 ToolDefinition（真实元数据，M2 直接换执行器保契约）：readonly/parallel、timeout、approval 类别齐全；bash 为 FakeShell 脚本响应表 + 两段取消模拟。

## 8. 八不变量 → 测试清单（验收映射）

| #   | 不变量             | 测试（用例名即规格）                                                                                                                              |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 事件日志唯一事实源 | `rebuild: projector(read(log)) equals runtime context`；`no ghost state: UI-visible ⊆ log`                                                        |
| 2   | 终态 exactly-once  | `finalize: second terminal event is swallowed`；`race: cancel-vs-complete yields exactly one`；`crash then resume: no second terminal`            |
| 3   | 模型可见 ⟹ 已记录  | `llm input provenance: every message traceable to an event`（FakeModel 捕获请求并逐条溯源）                                                       |
| 4   | fail-closed        | `unknown tool → deny fed back, turn continues`；`policy throws → deny`；`approver missing → deny`；`schema-invalid args → fed back, not executed` |
| 5   | 组装确定性         | `golden: two runs byte-identical`；`golden: snapshot matches file`；`config snapshot is canonically serialized`                                   |
| 6   | 一切可取消         | `abort in llm stream → turn.cancelled`；`abort in tool → tool.result(aborted) present`；`no dangling tool.intent`（扫描器断言）                   |
| 7   | 可重放             | `resume: replay prefix byte-equal then continues`；`fork: prefix copy exact`                                                                      |
| 8   | 插件可逆           | M4 才有插件宿主；M1 以 `effect-journal` 单元测试代理：注册 3 效果第 2 个失败 → 日志等于从未注册                                                   |

补充必测：预算（`budget soft warn injected` / `budget hard stop`）、并行工具（`parallel group runs concurrently` / `write conflict serialized`）、孤儿扫描（`orphan intent detected after simulated crash`）、迁移链（`future schema rejected loudly`）。

## 9. 黄金日志机制

- `test/golden/<case>.jsonl`：一次运行的完整事件流快照，随仓库提交。
- 断言：`expect(actualLines).toEqual(goldenLines)` 逐字节（含 seq/ts——ts 来自注入 Clock，故确定）。
- 更新流程：`npm run golden -- --update <case>`；review diff 必须能解释**每一行变化**。
- 任何 PR 改变黄金文件 → CI 要求人工标注原因（先以 PR 模板 checklist 约定）。

## 10. 验收标准（DoD）

1. `npm install && npm test` 在干净目录全绿（含全部黄金对比与八不变量测试）。
2. `npm run typecheck` strict 零错误；`npm run lint` 零错误（含边界规则）。
3. `test/demos/demo-turn.test.ts`：FakeModel 驱动「读→改→答」三步循环，日志符合 §5.2 顺序约束。
4. 孤儿扫描器 demo：人为截断日志（去掉 `tool.result`）能检出并报告。
5. 无任何 `any`、无非注入的时间/随机调用（grep 审计：`Date.now|Math.random|performance.now` 仅允许出现在 `clock.ts`）。
6. `spark` 无参进入 REPL：FakeModel 后端完整交互（输入 → 流式渲染 → 工具卡 → 权限卡 → 终态分隔线），全程无 unhandled 事件类型（未知事件走 FallbackRow 兜底渲染）。
7. TUI 渲染快照回归：FakeModel 脚本驱动的最终帧 strip-ANSI 后进黄金文件（`test/golden-ui/`），逐字节对比通过。
8. IME 守卫：注入 keypress（name=return 且 code=229 / isComposing=true）不触发发送（用例进 invariants 目录）。
9. `--plain`、非 TTY、`NO_COLOR` 三条降级路径可运行，输出无 ANSI 转义泄漏。

## 11. 落地核对（2026-08-26）

- 独立工程已落在仓库根 `spark-engine/`，没有 `workspace:*`、仓库外 import 或宿主类型依赖；`npm run boundary` 强制检查。
- v1 事件 schema、读时迁移拒绝链、内存/JSONL SessionStore、连续 seq 分配、分步 fsync、内容寻址 ArtifactStore 与完整性校验已实现。
- TurnGate、Turn/Step 循环、FIFO session 调度、取消树、四维预算、AJV 工具校验、权限 fail-closed、并行/串行工具组与孤儿 intent 扫描已实现。
- FakeModel DSL、VirtualFS/FakeShell、确定性 Clock/IdGen、事件与 TUI 黄金文件已实现。
- `Agent.open → newSession/openSession → turn/fork/events` SDK 与 `spark` CLI 已实现；JSON 模式输出完整事实流（含 `session.started`）。
- M1 里程碑验收时已通过 `npm run verify`：boundary、strict typecheck、lint、30 项测试、tsup build 与 npm pack 独立安装 smoke 全绿；当前首版质量门已扩展到 23 个测试文件、86 项测试，见 `docs/design/spark-engine-first-release.md`。
- 已在干净临时目录执行 `npm ci && npm run verify`；构建后的 TUI 在真实 PTY 中启动并通过 `/exit` 正常退出。
- 发布 tarball 实测约 95 KB、解包约 400 KB；干净生产安装约 32 MB；`npm audit --omit=dev` 为 0 个已知漏洞。
