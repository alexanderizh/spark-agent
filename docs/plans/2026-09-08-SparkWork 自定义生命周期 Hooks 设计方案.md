# SparkWork 自定义生命周期 Hooks 设计方案

> 状态: 实施中 | 最后核对: 2026-09-12

## 1. 文档目的

本文定义 SparkWork 产品化自定义 Hook 系统的首期架构、事件语义、作用域、权限模型、持久化执行、界面挂载、兼容迁移和验收标准，为后续实现提供统一基线。

用户可以在 Agent 生命周期的明确节点上，确定性地执行已配置动作。例如：最终回答成功落库后，调用一个 Webhook 工具，把用户明确选择的回答字段发送到指定地址。

本方案的核心决策是：**产品 Hook 由 SparkWork 宿主运行时调度，不依赖模型在提示词中自行决定是否调用。** 因而不同 Agent 引擎使用相同事件语义，并具备去重、恢复、审计、权限和失败隔离能力。

## 2. 目标与非目标

### 2.1 首期目标

- 提供统一、版本化的生命周期事件协议。
- 支持应用、项目（workspace）、Agent、会话四类作用域绑定。
- 支持内置通知、提示音及统一工具目录中的受治理工具动作。
- 支持条件判断和事件载荷到工具参数的显式映射。
- 提供一次性授权、定义变更失效、风险分级和递归防护。
- 提供持久化队列、失败记录、有限重试、崩溃恢复和运行审计。
- 保持 Claude、Codex、Spark Engine 等执行路径的产品层语义一致。
- 兼容现有通知型 Hook 配置，不因迁移导致已有通知失效。

### 2.2 首期非目标

- 不允许 Hook 阻止、批准或改写当前 Agent 行为。
- 不实现 `PreToolUse`、`response.beforeCommit` 等拦截型事件。
- 不允许通过字符串反射调用任意宿主内部函数或 IPC。
- 不把完整提示词、推理、工具输入输出或全量会话记录默认暴露给 Hook。
- 不承诺外部副作用严格 exactly-once。
- 不在首期统一或替换 Spark Engine 已有的原生命令 Hook。

## 3. 已核实的现状

当前仓库存在三条彼此未统一的 Hook 路径：

1. 公共运行时在 `SessionService.emitAndPersist()` 观察 `agent_status`，将 `completed`、`error/cancelled`、`waiting_user` 映射为旧的 `session_end`、`session_fail`、`ask_user_question`。
2. Renderer 在收到权限审批请求或计划审批事件时调用 `hook:trigger`，因此 `permission_request` 依赖界面进程在线，并不是可靠的运行时事件。
3. Spark Engine 内部已有 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 命令型 Hook；它只属于 Spark Engine 原生执行能力，不是跨引擎产品配置。

现有产品 Hook 只支持 `sound` 和 `notification`，协议位于 `packages/protocol/src/hooks.ts`，Agent 记录中有 `hook_config_json`。应用设置页和实际执行端还没有共享同一个事实源：

- 设置页通过 `usePersistedSettings('spark-settings-hooks', ...)` 写入 Settings 的 `hooks/data`，并同步本地 `localStorage`。
- 主进程 `triggerHook()` 与运行时 `HookService` 读取的是 `hooks/config`。
- Agent Hook 当前采用“Agent 配置启用则整体替代应用配置”的覆盖方式，不能表达多作用域累加、单项停用或来源追踪。
- `HookService` 已导出，但仓库未形成以它为中心的统一生命周期调度链。

统一工具目录 `UnifiedToolCatalog` 已经聚合 Connector、Custom Tool 与 Tool Package，可作为 Hook 工具动作的解析入口。但当前工具调用来源联合类型尚无 `hook`，仍需显式扩展，不能借用 `nested` 或 `workflow`。

## 4. 术语与语义边界

| 术语 | 含义 |
| --- | --- |
| 产品 Hook | 由 SparkWork 宿主调度、跨 Agent 引擎一致的用户自动化 |
| 原生 Hook | 某一执行引擎自身支持的 Hook，例如 Spark Engine 命令 Hook |
| 观察型 Hook | 事件发生后执行动作，不能改变已经发生的结果 |
| 拦截型 Hook | 事件提交前返回允许、拒绝或改写结果；首期不实现 |
| Hook 定义 | 事件、条件、动作、映射和执行策略的可复用定义 |
| Hook 绑定 | 将某个定义启用或停用于具体作用域，并记录授权 |
| Hook 事件 | 生命周期事实的持久化事件信封 |
| Hook 运行 | 某个 Hook 定义针对某个事件的一次动作执行记录 |

必须区分以下概念：

- “回答完成”指最终可见回答已成功持久化，对应 `response.committed`。
- “Turn 完成”指 Turn 的成功终态已持久化，对应 `turn.completed`；它不承诺所有非持久化后台收尾已经完成。
- “会话结束”指用户归档、删除或显式关闭会话，不等同于单轮回答完成。

旧事件名 `session_end` 实际表达的是 Turn/回答终态，后续不得继续扩散这个歧义。

## 5. 总体架构

```text
Session / Permission / Question lifecycle
                  │
                  ▼
        HookEventEmitter (thin adapters)
                  │ durable outbox
                  ▼
          hook_events (SQLite)
                  │ resolve bindings + snapshot
                  ▼
            HookDispatcher
                  │ creates hook_runs
                  ▼
              HookWorker
          ┌───────┴────────┐
          ▼                ▼
   BuiltinAction      ToolActionExecutor
 notification/sound   UnifiedToolCatalog
                           │
                           ▼
                 unified invocation audit
```

设计约束：

- 生命周期接入点只负责构造并持久化事件，不包含动作执行逻辑。
- Renderer 只展示和编辑配置，不再作为权限、提问等关键事件的唯一触发源。
- Worker 在主进程受控执行，Hook 失败不得改变原 Turn 的成功、失败或取消状态。
- 新逻辑拆入独立 Hooks 模块；超大 `session.service.ts` 和主 IPC 文件只保留薄接线。

建议模块边界：

```text
packages/protocol/src/hooks-v2.ts
packages/storage/src/repositories/hook-*.repository.ts
packages/agent-runtime/src/services/hooks/
  hook-event-emitter.ts
  hook-dispatcher.ts
  hook-binding-resolver.ts
  hook-action-policy.ts
  hook-action-executor.ts
  hook-worker.ts
  hook-redaction.ts
apps/desktop/src/main/ipc/registerHooksIpc.ts
apps/desktop/src/renderer/design/views/hooks/
```

最终文件名可按仓库实现时的模块规范调整，但不得把核心实现继续堆入现有超大文件。

## 6. 生命周期事件

### 6.1 MVP 事件

| 事件 | 准确触发时机 | 典型用途 |
| --- | --- | --- |
| `turn.started` | Turn 已建立并准备进入执行管线 | 计时、外部状态同步 |
| `permission.requested` | 一个真实权限请求已持久化并进入等待 | 通知审批人、外部告警 |
| `question.requested` | Agent 提问已持久化并进入等待用户输入 | 通知、工单联动 |
| `response.committed` | 最终用户可见回答成功持久化，正文和 messageId 已确定 | Webhook、归档、后续工作流 |
| `turn.completed` | Turn 的成功终态已持久化 | 兼容任务完成通知、终态统计 |
| `turn.failed` | Turn 进入不可恢复失败终态 | 故障通知、失败记录 |
| `turn.cancelled` | 用户或系统明确取消 Turn | 取消通知、外部状态同步 |

`response.committed` 是用户示例中“回答完毕后发送最终总结”的推荐绑定点。它必须在最终可见正文写库成功后触发，不能从流式片段、`agent_status=completed` 或 UI 渲染状态反推。

### 6.2 后续观察型事件

- `prompt.submitted`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `compact.before`
- `compact.after`
- `subagent.started`
- `subagent.stopped`
- `session.started`
- `session.ended`
- `goal.completed`
- `scheduled_task.completed`

工具事件频率高、输出可能很大，须在运行记录限额和脱敏策略成熟后再开放。

### 6.3 后续拦截型事件

- `prompt.beforeSubmit`
- `tool.before`
- `permission.deciding`
- `response.beforeCommit`

拦截型 Hook 需要独立协议，明确 `allow | deny | modify`、超时默认行为、退出码、冲突合并和权限升级规则，不与观察型 MVP 混合实现。

## 7. 版本化事件信封

首期统一使用 `HookEventEnvelopeV1`：

```ts
type HookEventNameV1 =
  | 'turn.started'
  | 'permission.requested'
  | 'question.requested'
  | 'response.committed'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'

interface HookEventEnvelopeV1<TPayload extends Record<string, unknown>> {
  schemaVersion: 1
  eventId: string
  eventName: HookEventNameV1
  occurredAt: string
  source: 'host'
  session: {
    id: string
    title?: string
  }
  turn: {
    id: string
  }
  agent?: {
    id: string
    name?: string
  }
  workspaces: Array<{
    id: string
    name?: string
  }>
  primaryWorkspaceId?: string
  payload: TPayload
}
```

`response.committed` 的载荷定义为：

```ts
interface ResponseCommittedPayloadV1 {
  response: {
    messageId: string
    finalText: string
  }
}
```

约束：

- `eventId` 在首次持久化时生成，重放与重试必须保持不变。
- `finalText` 只包含最终向用户展示的回答正文，不包含隐藏推理、系统提示、用户提示、工具参数或工具原始结果。
- 系统维护任务或兼容数据可能没有可解析的 Agent；此时省略 `agent`，只匹配 application/workspace/session 绑定，不匹配 agent 绑定。
- 多工作区会话携带全部 `workspaces`，作用域匹配只使用 `primaryWorkspaceId`；无主项目的普通会话不匹配项目级绑定。
- 新增字段优先使用可选字段；破坏性协议变更升级 `schemaVersion`。
- 运行日志默认只保存字段摘要与哈希；正文是否进入动作输入由用户映射决定。

## 8. Hook 定义

建议的领域模型：

```ts
interface HookDefinitionV1 {
  id: string
  name: string
  description?: string
  enabled: boolean
  eventName: HookEventNameV1
  condition?: HookConditionV1
  action: HookActionV1
  inputMapping: Record<string, HookValueExpressionV1>
  timeoutMs: number
  retryPolicy: HookRetryPolicyV1
  concurrencyPolicy: 'serial_per_session' | 'parallel'
  revision: number
  executionHash: string
}
```

### 8.1 动作类型

首期支持：

```ts
type HookActionV1 =
  | { type: 'builtin.notification' }
  | { type: 'builtin.sound' }
  | {
      type: 'tool.invoke'
      target: {
        sourceKind: 'connector' | 'custom-tool' | 'tool-package'
        sourceId: string
        version?: string
        toolName: string
        qualifiedName: string
      }
    }
```

工具动作必须保存稳定引用，不能只保存可能重名或变化的显示名称。执行前由统一工具目录同时核验 `sourceKind/sourceId/version/toolName`，`qualifiedName` 用于展示与交叉校验。已固定版本的 Tool Package 不得静默漂移到其他版本。

“调用内部方法”只能通过经过注册、声明输入 Schema、风险和权限的 `builtin.*` 动作实现；不提供任意 module、函数名或 IPC channel 调用能力。

### 8.2 条件与参数映射

首期采用受限表达式模型，不执行用户 JavaScript：

- 值来源：常量、事件白名单路径、模板字符串。
- 条件操作：`eq`、`notEq`、`exists`、`contains`、`startsWith`、`and`、`or`、`not`。
- 路径只允许访问当前事件 Schema 中公开的字段。
- 定义保存和启用前必须按事件 Schema 与工具 `inputSchema` 完成静态校验。
- 执行前再次校验映射结果；失败记录为 `mapping_failed`，不得调用动作。

示例：

```json
{
  "eventName": "response.committed",
  "action": {
    "type": "tool.invoke",
    "target": {
      "sourceKind": "tool-package",
      "sourceId": "webhook-package-id",
      "version": "1.0.0",
      "toolName": "send",
      "qualifiedName": "webhook.send"
    }
  },
  "inputMapping": {
    "summary": { "path": "payload.response.finalText" },
    "sessionId": { "path": "session.id" },
    "eventId": { "path": "eventId" }
  }
}
```

界面必须在授权前展示一次映射预览，并明确标出哪些字段将离开 SparkWork。

## 9. 作用域、绑定与冲突解析

支持四类作用域：

- `application`：所有匹配事件。
- `workspace`：UI 显示为“项目”，仅主 Workspace 匹配时生效。
- `agent`：按实际执行该事件的 Agent 匹配，团队成员使用成员 Agent ID。
- `session`：仅指定会话生效。

这四者是当前执行上下文的**匹配集合**，不是严格的继承树。尤其 workspace 与 agent 之间没有所有权关系。

同一 `hookId` 的解析规则：

1. 先过滤不存在或 `HookDefinition.enabled=false` 的定义；定义级停用优先于所有绑定。
2. 收集当前事件匹配的全部绑定。
3. 按 `hookId` 分组，每组只选一个最终绑定。
4. 确定性优先级为 `session > agent > workspace > application`。
5. 高优先级的 `enabled=false` 可以显式停用低优先级继承项。
6. 不同 `hookId` 默认累加执行；同一 Hook 从多个作用域命中时只运行一次。
7. 最终列表必须展示来源、覆盖关系、停用原因和授权状态。

数据库唯一约束应阻止同一 Hook 在同一作用域出现多个绑定。如果历史脏数据突破约束，Resolver 必须拒绝该 Hook 并记录 `ambiguous_binding`，不得用创建时间或数组顺序静默选择。

如果未来需要让 workspace 与 agent 同权叠加，应新增显式组合模式，而不是改变既有优先级造成行为漂移。

## 10. 信任、权限与风险治理

产品 Hook 是无人值守自动执行，不能沿用“运行时弹出临时审批”的普通交互模型。

### 10.1 启用时授权

- 创建定义不等于授权执行。
- 每个启用绑定保存 `trustedExecutionHash`、动作风险、授权时间和授权主体。
- `executionHash` 对事件、条件、映射、动作目标、固定版本、超时、重试和并发策略做规范化哈希。
- 仅修改名称、描述等非执行字段不使授权失效。
- 任意可执行字段、工具版本、权限声明或风险等级变化时，Hash 不匹配，绑定自动进入 `needs_review`，暂停执行。
- 定义发生上述变化时，同库事务同时把尚未开始的旧 revision 运行标为 `blocked/trust_required`；不得继续依赖已保存快照执行。
- 工具版本、权限、effect 或 Schema 等治理信息可能来自其他存储：同库时原子失效；跨存储时通过单调 `governanceRevision` 和 outbox/change event 驱动未开始运行失效。治理通知是否及时都不构成安全边界，Worker 的调用前最终复核才是强制兜底。
- Worker 领取后、真正调用动作前必须再次读取当前定义、绑定和工具治理信息，校验 `enabled/state/trustedExecutionHash/executionHash/version/effect/permissions`。任一不一致都阻止调用。
- 对已经进入 `running` 的动作发出尽力取消：工具支持取消时传递 AbortSignal；确认取消后进入 `cancelled`。工具不支持取消、外部副作用已经发生或结果无法确认时不能承诺撤回；无法确认结果的运行进入终态 `outcome_unknown`，不得被租约恢复或总开关重新开启自动重投，只允许用户在看到重复副作用警告后显式重试。
- 应用级总开关是“暂停新的自动执行”入口：关闭后停止领取并暂停尚未开始的任务，同时尽力取消运行中动作；它不是已经发生的外部副作用回滚能力，UI 不得表述为强制立即撤回。

### 10.2 工具风险策略

| 工具 effect | MVP 策略 |
| --- | --- |
| `read` | 用户明确授权后允许 |
| `low-write` | 用户明确授权并查看发送字段后允许 |
| `high-write` | 需要强化确认；默认建议停用，可由产品策略决定首期是否开放 |
| `destructive` | 观察型 MVP 禁止 |

Hook 运行时不弹审批。如果授权缺失、工具停用、版本不存在、权限提高或 Schema 改变，则记录 `blocked`/`needs_review` 并跳过动作，不得阻塞会话。

工具调用上下文新增 `invocationSource: 'hook'`，并携带 `hookId`、`hookRunId`、`eventId`、session/turn/workspace/agent 归因。该字段需要贯通 Tool Package、Custom Tool、Connector 和统一调用追踪。

### 10.3 递归防护

- `invocationSource='hook'` 的工具调用默认不再发出产品层工具 Hook 事件。
- 一个事件链设置最大深度 1；未来显式开放链式 Hook 时再升级协议。
- 内置动作不得通过旁路重新进入生命周期事件发射器。

## 11. 持久化模型

为保证崩溃恢复，首期使用四张表。仅用 `hook_runs` 兼作事件队列无法可靠覆盖“生命周期事实已提交、运行记录尚未生成”的崩溃窗口，因此增加 `hook_events` 持久化 outbox。

### 11.1 `hook_definitions`

核心字段：

- `id`, `name`, `description`, `enabled`
- `schema_version`, `event_name`
- `condition_json`, `action_json`, `input_mapping_json`
- `timeout_ms`, `retry_policy_json`, `concurrency_policy`
- `revision`, `execution_hash`
- `created_at`, `updated_at`

### 11.2 `hook_bindings`

核心字段：

- `id`, `hook_id`
- `scope_kind`, `scope_id`；application 的 `scope_id` 为空
- `enabled`, `state`（`active | needs_review | disabled`）
- `trusted_execution_hash`
- `authorized_effect`, `authorized_at`
- `created_at`, `updated_at`

约束：`(hook_id, scope_kind, normalized_scope_id)` 唯一。

### 11.3 `hook_events`

核心字段：

- `event_id`, `schema_version`, `event_name`
- session/turn/agent/primary_workspace 归因列
- `envelope_json`
- `status`（`pending | resolving | resolved | failed`）
- `available_at`, `lease_owner`, `lease_expires_at`
- `created_at`, `resolved_at`, `last_error`

事件生产方必须先持久化 outbox，再对外声称该生命周期事件可供 Hook 消费。能与领域事实共用数据库事务的接入点应使用同一事务；暂时不能共用时，必须通过稳定事件 ID 和启动补偿扫描缩小丢失窗口，并列为迁移期技术债。

### 11.4 `hook_runs`

核心字段：

- `id`, `event_id`, `hook_id`, `hook_revision`, `binding_id`
- 动作、映射结果、策略的执行快照
- `status`（`queued | running | succeeded | failed | skipped | blocked | cancelled | outcome_unknown`）
- `attempt_count`, `available_at`, `lease_owner`, `lease_expires_at`
- `started_at`, `finished_at`, `duration_ms`
- `error_code`, `error_message`
- 脱敏输入摘要、输出摘要、correlation/invocation ID

唯一约束：`(event_id, hook_id)`；`hook_revision` 只保存首次解析时的执行快照版本。事件重新解析时即使定义 revision 已变化，也不得为同一事件自动创建第二次运行。若用户需要按新版本重放，必须通过显式手工重试创建带来源关联的新事件或 retry attempt，而不是绕过唯一约束。Dispatcher 在一个事务中创建运行快照并将事件标为 `resolved`。

运行记录保存定义快照，因此后续编辑 Hook 不会改变历史审计含义。默认不保存完整敏感输入输出；正文采用有界脱敏预览或哈希，详细结果复用统一工具调用记录与大结果归档。

## 12. 执行与可靠性

### 12.1 投递语义

- 内部事件和运行记录通过唯一约束实现确定性去重。
- 对外动作整体语义为 **at-least-once delivery**。
- 如果外部系统不支持幂等键，应用可能在“外部调用成功、数据库尚未记成功”的崩溃窗口重复发送。
- 界面和文档不得宣称严格只执行一次。

### 12.2 重试策略

- `safe`：仅对明确的瞬态错误按退避策略重试。
- `keyed`：工具元数据必须声明受宿主验证的幂等键字段；宿主强制注入由 `eventId + hookId + action identity` 派生的稳定键并在调用前校验，同一 run 的全部自动重试复用同一个键，不依赖用户自由映射。目标工具无法声明或验证幂等支持时降级为 `unsafe`。
- `unsafe`：失败后不自动重试，只允许用户在运行记录中显式重试。
- 默认超时 15 秒，默认最大 3 次尝试；工具更严格的超时和重试限制优先。
- 认证失败、Schema 失败、权限变化、工具不存在和确定性 4xx 不自动重试。

### 12.3 并发与顺序

- 默认 `serial_per_session`：同一 Hook、同一会话按 `occurredAt + eventId` 串行。只要更早运行仍为 queued/running 或等待重试，后续运行不得越过；前序进入最终 succeeded/failed/skipped/blocked/cancelled/outcome_unknown 后才可领取下一条。
- 不同 Hook 可并行，但受全局和每工具并发上限约束。
- `parallel` 仅允许用户显式选择，并在 UI 提示可能乱序。
- Worker 使用短租约领取；应用重启后回收过期的 `resolving/running` 任务。

### 12.4 失败隔离

- Hook 失败不修改已完成 Turn 的终态，不撤回回答，也不向 Agent 自动追加错误消息。
- Hook 基础设施不可用时，Agent 主流程继续；事件保留为 pending 或记录明确的持久化故障。
- 单个 Hook 或工具失效不得阻断其他 Hook。
- 连续失败达到阈值后可自动暂停绑定并通知用户，但不得静默删除配置或运行历史。

## 13. 生命周期接入点

### 13.1 公共运行时

- 在 Turn 注册并开始执行的唯一公共入口发射 `turn.started`。
- 权限请求应在运行时审批桥创建请求后发射 `permission.requested`，移除 Renderer 作为事实事件触发者的职责。
- 用户提问应在 pending question 成功持久化后发射 `question.requested`。
- 最终回答应在最终 assistant message 成功持久化后发射 `response.committed`。
- Turn 成功终态首次成功持久化后发射 `turn.completed`；它不能替代 `response.committed`，因为成功 Turn 可能没有最终 assistant message，也不表示所有非持久化后台收尾已结束。
- 失败和取消应在终态首次成功持久化后分别发射 `turn.failed`、`turn.cancelled`。

### 13.2 去重原则

- 不能仅监听 `agent_status` 推断所有事件；状态可能重复、恢复或来自不同执行器适配。
- 每个领域事实必须有稳定源 ID，例如 permission request ID、question ID、message ID、turn ID。
- `eventId` 应由事件名与稳定源 ID确定性生成，或在领域事务中一次生成并保存。
- Renderer 可继续展示通知，但不得再次创建同一产品 Hook 事件。

对暂时无法与领域事实共事务的 MVP 事件，实施时必须逐项登记补偿来源：

| 事件 | 稳定事实与补偿游标 |
| --- | --- |
| `turn.started` | turn request/registry 的持久化开始记录，以 turnId 扫描 |
| `permission.requested` | pending permission request，以 requestId 扫描 |
| `question.requested` | pending question，以 questionId 扫描 |
| `response.committed` | 最终 assistant message，以 messageId 扫描 |
| `turn.completed/failed/cancelled` | 持久化 Turn 终态，以 turnId + terminal status 扫描 |

补偿器保存单调游标和重叠扫描窗口，事件 ID 由事件名与稳定事实 ID 确定性生成。源事实的保留期不得短于补偿窗口；若当前表无法提供稳定事实或游标，该事件不得宣称具备崩溃不丢的交付保证，必须先补齐领域持久化。

### 13.3 Spark Engine 原生 Hook

首期保留 Spark Engine 原生 Hook，标记来源为 `native:spark-engine`；产品 Hook 标记为 `host`。两者配置、日志和事件命名不互相伪装。

当一个用户同时配置原生 `Stop` Hook 和产品 `response.committed` Hook 时，两者均可执行，这是两个显式配置，不做基于名称的隐式去重。后续统一前必须先定义迁移映射、执行先后、阻断语义和退出码兼容。

## 14. IPC 与服务接口

建议按领域拆分 IPC，避免扩充主 IPC 大文件。首期至少提供：

- Hook 定义：list/get/create/update/delete/validate。
- Hook 绑定：list-effective/upsert/disable/review-and-authorize。
- Hook 运行：list/get/retry/cancel-pending。
- 工具候选：按 Hook 策略列出可选择工具及不可选原因。
- 预览：使用样例或历史事件验证条件和映射，不执行真实动作。
- 测试运行：展示完整动作与发送字段，经用户确认后产生标记为 test 的独立运行记录。
- 总开关：读取和设置应用 Hook 执行状态。

所有请求和响应进入 `@spark/protocol` 类型与运行时校验，不在 Renderer 复制一套松散类型。

删除定义属于破坏性操作：必须展示受影响绑定和历史运行数量并二次确认。历史运行默认保留定义快照，不随定义删除。

## 15. UI 挂载

### 15.1 设置 → Hooks

- 应用总开关。
- Hook 定义列表和应用级绑定。
- 事件、条件、动作、字段映射、风险和重试配置。
- 工具可用性、信任状态、失败状态和运行记录。
- 旧通知/提示音配置迁移后的内置 Hook。

### 15.2 Agent 编辑页 → Hooks

- 展示应用级继承项与来源。
- 允许启用、停用或覆盖某个 Hook。
- Agent 专属 Hook 使用同一编辑器，不继续扩张旧 `hookConfig` 表单。

### 15.3 会话右侧配置面板 → Hooks

- 分别展示项目级和会话级绑定。
- 展示当前会话“最终生效列表”：来源、覆盖、被停用、待复核、工具不可用等原因。
- 允许会话临时停用继承 Hook。
- 项目绑定以当前主 Workspace 为目标；多 Workspace 信息清楚展示。

### 15.4 工具管理页

- 展示工具是否允许被 Hook 自动调用。
- 展示 risk/effect/idempotency、版本、权限变化和阻止原因。
- 可跳转查看引用该工具的 Hook。

界面沿用项目扁平、简洁的视觉基线：用分割线、文字层级、图标和状态色表达关系，不做卡片墙；同时覆盖 loading、empty、error、disabled、needs_review、blocked 和窄屏状态。

## 16. 旧配置迁移与兼容

迁移分两步进行：

1. **先修复事实源兼容**：读取 `hooks/config`；若不存在则读取 `hooks/data`，必要时再读取旧 localStorage 并写回统一 Settings。迁移期双读，写入只写新键，并记录一次性迁移标记。
2. **再迁移领域模型**：把旧 sound/notification 节点转换为内置 Hook 定义和绑定。

迁移必须有持久化的执行所有权标记 `legacy | v2`。创建全部新定义、绑定和授权快照后，在同一数据库事务中把所有权从 `legacy` 切到 `v2`；事件触发路径只允许当前所有者执行。迁移失败或回滚时保持 `legacy`，不得让旧路径与迁移后的内置 Hook 同时发送通知。

旧事件映射：

| 旧节点 | 新事件/动作 |
| --- | --- |
| `permission_request` | `permission.requested` + sound/notification |
| `ask_user_question` | `question.requested` + sound/notification |
| `session_end` | `turn.completed` + sound/notification；回答正文自动化需由用户另建 `response.committed` Hook |
| `session_fail` | 分拆为 `turn.failed` 与 `turn.cancelled` |

兼容要求：

- 迁移必须幂等，不重复创建内置 Hook。
- 将旧 `session_end` 映射为 `turn.completed`，以保留“无最终 assistant message 但 Turn 成功”时的既有完成通知；不得为兼容性把正文 Webhook 错绑到该事件。
- 旧 Agent `hook_config_json` 保留读取至少一个兼容版本周期。
- 旧 Agent “整体覆盖应用设置”的实际行为在迁移结果中保持，不能未经提示变成累加导致重复通知。
- 回滚旧版本时原配置仍可读取；新表采用 additive migration，不立即删除旧字段。
- 任一迁移失败不得导致会话不可用，保留旧通知执行路径并给出诊断。

## 17. 安全与隐私

- 密钥继续存放在 Tool Package/Connector 配置和 Keychain 中，Hook 不保存密钥值。
- 参数映射采用字段白名单；不提供任意文件、环境变量、数据库或宿主对象读取表达式。
- 默认不发送回答正文。只有用户显式把 `payload.response.finalText` 映射到动作参数并完成授权后才发送。
- 授权界面按字段展示潜在外发内容，并标识目标工具、来源、版本和网络/文件/进程副作用。
- 日志和运行记录对 Authorization、Cookie、token、secret、password 等字段强制脱敏。
- Webhook URL 若属于工具配置，沿用该工具的安全存储和权限模型；Hook 定义只持有工具稳定引用。
- 禁止 Hook 绕过工具统一 Schema 校验、Capability 权限、审计和结果大小治理。
- 自动测试动作可能产生真实外部副作用，必须与纯映射预览分开，并在执行前确认。

## 18. 可观测性与运维

每次运行应能从 `hookRunId` 关联：

- Hook 定义与 revision；
- 命中的绑定与作用域；
- 原始 `eventId`、sessionId、turnId；
- 工具 correlationId/invocationId；
- 排队、开始、结束、耗时和尝试次数；
- 跳过、阻止或失败的稳定错误码；
- 脱敏输入输出摘要。

建议稳定错误码至少包含：

- `binding_disabled`
- `ambiguous_binding`
- `trust_required`
- `condition_not_matched`
- `mapping_failed`
- `tool_not_found`
- `tool_disabled`
- `tool_version_changed`
- `permission_changed`
- `policy_blocked`
- `timeout`
- `transient_failure`
- `action_failed`
- `outcome_unknown`

运行记录支持按时间、状态、事件、作用域、Hook、会话和工具筛选。保留期应与统一工具调用审计策略一致，并提供容量上限；清理历史前不删除仍在 pending/running 的记录。

## 19. 分阶段实施计划

### Phase A：协议与旧能力收口

- 新建本文档对应的 protocol 类型与 Schema。
- 统一 `hooks/data`、`hooks/config` 和 localStorage 的兼容迁移。
- 定义错误码、动作引用、条件和映射模型。
- 扩展 `invocationSource: 'hook'` 的全链路类型。

### Phase B：持久化核心与 Worker

- 增加四张表、Repository 和幂等迁移。
- 实现 EventEmitter、BindingResolver、Dispatcher、Worker、租约恢复。
- 实现内置通知/提示音动作、策略检查和脱敏。

### Phase C：MVP 生命周期接入

- 接入七类 MVP 事件。
- 优先完成 `response.committed` 的最终正文契约。
- 移除 Renderer 作为权限 Hook 事实触发者的职责。
- 增加重复状态、恢复、重放和终态竞争测试。

### Phase D：统一工具动作

- 接入 `UnifiedToolCatalog` 稳定引用解析。
- 完成 Hook 调用归因、权限、信任 Hash、幂等键和递归防护。
- 覆盖 Connector、Custom Tool、Tool Package 的一致性。

### Phase E：四作用域与前端

- 完成定义、绑定、运行记录 IPC。
- 实现设置、Agent、项目/会话配置面板和工具详情入口。
- 实现最终生效列表、参数预览、授权与 needs_review 流程。

### Phase F：迁移、验证与文档

- 迁移旧通知配置并验证回滚兼容。
- 完成三引擎契约测试、崩溃恢复、去重、超时和重试测试。
- 更新用户文档与开发文档。
- MVP 落地并完成验收后，将本文状态改为“已落地”并刷新核对日期。

### 后续阶段

- 增加工具、压缩、子 Agent、Goal、定时任务和会话级观察事件。
- 独立设计拦截型 Hook 协议。
- 评估 Spark Engine 原生 Hook 与产品 Hook 的统一配置、导入和迁移。

## 20. 测试矩阵

### 20.1 协议与存储

- 所有事件载荷的成功、缺字段、未知版本和向后兼容解析。
- 四表从空库、旧库升级和重复迁移。
- event/run 唯一约束、同事件跨 revision 不重跑、租约领取、过期回收和快照不变性。
- 旧 `hooks/data`、`hooks/config`、localStorage 和 Agent 配置的迁移优先级。

### 20.2 生命周期

- 各执行器对每个 MVP 事件只产生一个稳定事件。
- 最终消息写库失败时不得发出 `response.committed`。
- 流式完成但最终正文未提交时不得触发回答 Hook。
- cancelled 与 failed 竞争只保留真实终态。
- 权限和提问事件在 Renderer 未启动或重载时仍可生成并恢复。

### 20.3 作用域

- application、workspace、agent、session 单独命中。
- session > agent > workspace > application 的启用和停用覆盖。
- 同一 Hook 多作用域只运行一次，不同 Hook 累加。
- 无项目、多项目、团队成员 Agent 和 Agent 缺失的边界。

### 20.4 动作与安全

- 条件匹配/不匹配和全部映射操作。
- 映射越权路径、Schema 不匹配、超长输入和敏感字段脱敏。
- 工具不存在、停用、版本变化、风险提高和权限变化。
- read/low-write/high-write/destructive 策略。
- Hook 来源调用不产生递归工具 Hook。
- 定义、绑定或工具治理状态变化会事务性阻止 queued 旧快照，Worker 调用前最终复核；running 动作按可取消能力记录结果。

### 20.5 可靠性

- 应用在事件提交后、运行创建前、外部成功后、运行记成功前分别崩溃。
- safe/keyed/unsafe 的重试差异和稳定的 eventId + hookId + action identity 派生键注入。
- keyed 工具必须声明可验证的幂等字段，未声明时不得自动重试。
- 总开关或授权撤销后的 running 动作分别覆盖确认取消与 outcome_unknown，后者不得自动恢复执行。
- 同会话严格串行（含退避等待）、跨 Hook 并行、全局限流和乱序防护。
- Hook 基础设施或单个工具失败不影响 Turn 正文和终态。

### 20.6 Renderer

- 定义 CRUD、有效绑定来源、停用继承项和授权失效。
- 映射预览不执行动作；测试运行明确提示真实副作用。
- loading/empty/error/disabled/needs_review/blocked。
- 窄屏、滚动边界、键盘操作、焦点、深浅主题和错误回退。

## 21. MVP 验收标准

首期只有同时满足以下条件才可标记完成：

1. 用户可创建一个 `response.committed` Hook，选择已启用工具并把 `finalText`、sessionId、eventId 映射为参数。
2. Hook 可绑定到应用、项目、Agent 或会话，并能在会话中解释最终生效来源。
3. 最终回答成功落库后异步执行；Hook 失败不影响回答展示和 Turn 成功状态。
4. Claude、Codex、Spark Engine 的宿主执行路径通过同一事件契约测试。
5. 应用重启后 pending/running 任务可恢复，重复事件不会生成重复内部运行。
6. 外部重复投递风险、幂等键和重试策略在 UI 中表达准确。
7. 定义或工具执行属性变化后授权失效，未重新确认前不会自动调用。
8. `invocationSource='hook'`、eventId、hookRunId 和会话归因可从运行记录追踪到统一工具审计。
9. 旧通知和提示音配置迁移后行为保持，旧设置键和 Agent 配置可兼容读取；执行所有权切换不会产生双通知。
10. 自动化测试覆盖本文矩阵中的关键路径，前端由用户在真实应用中完成最终手工验收。

## 22. 实施约束与待决项

实施约束：

- 不新增不必要依赖；表达式解析优先使用受限自有模型和现有 Schema 能力。
- 所有数据库变更采用 additive migration，并提供幂等升级测试。
- 公共 API、IPC、持久化 JSON 和外部输入按 TypeScript strict 思路显式收窄。
- 不修改与本功能无关的 UI 视觉属性。
- 实现阶段每个 Phase 独立评审、独立验证、可回退。

实现前仍需在代码方案中最终确认但不阻塞本文定稿的事项：

- `high-write` 是否在 MVP 完全禁用，还是允许强化确认后启用。
- Hook 运行历史的默认保留天数和容量上限。
- 应用进入退出流程时 Worker 的优雅停止时限。
- 原生 Spark Engine Hook 在设置页只展示来源，还是同时提供跳转编辑入口。

这些待决项不得改变已经确定的核心边界：宿主确定性调度、观察型 MVP、四类匹配作用域、启用时授权、持久化 outbox、at-least-once 语义和 Hook 失败隔离。
