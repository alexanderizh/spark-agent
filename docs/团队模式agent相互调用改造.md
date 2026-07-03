# 团队模式 Agent 相互调用改造

> 状态: 部分废弃（2026-07-03 核对：Phase 2/3「用户 @ 直答」已落地——`mentionAgentId` 协议字段、`MentionPopover` 组件、`isMentionTurn` 路由均已实现；Phase 1「`allowCallHost` / Member→Host 回呼 / 花名册双视角」从未实现，`allowCallHost` 全仓零命中。该残留范围已被 [团队模式A2A深度协作升级方案.md](./团队模式A2A深度协作升级方案.md) 吸收重做，本文档第三～五、七（Phase 1）节内容不再作为开发依据，仅保留六（Phase 2/3 前端细节）作历史参照） | 最后核对: 2026-07-03
>
> 改造目标：在现有"Host 调度 Member"的基础上，补齐 **Member ↔ Member**、**Member → Host** 的双向调用能力，并新增 **用户 @ 指定 Agent 直答** 的群聊式交互。
>
> 关联设计文档：[团队模式开发.md](./团队模式开发.md)
> 关联实现入口：[session.service.ts](./packages/agent-runtime/src/services/session.service.ts)、[team-dispatch.service.ts](./packages/agent-runtime/src/services/team-dispatch.service.ts)

---

## 一、现状盘点

### 1.1 已支持

| 场景 | 实现位置 | 状态 |
|---|---|---|
| Host → Member（串行） | `spark_team.agent_dispatch` 工具 | ✅ |
| Host → Member（并行） | `spark_team.agent_dispatch_batch` 工具 | ✅ |
| Member → Member（嵌套） | `executeMemberTurn` 内 `allowNesting && memberDepth < maxDepth` 时把 `spark_team` MCP 注入到 Member（[session.service.ts:1789-1803](./packages/agent-runtime/src/services/session.service.ts:1789)） | ✅ 已具备底层能力，但花名册 prompt 未提示 Member 可以调度 |

### 1.2 未支持（本次改造重点）

| 场景 | 阻塞点 |
|---|---|
| **Member → Host 回呼** | (a) `resolveTeamMembers` 把 Host 排除在 dispatch 候选外（[session.service.ts:1587](./packages/agent-runtime/src/services/session.service.ts:1587)）；(b) `TeamDispatchService.run` 校验 `teamConfig.memberAgentIds.includes(memberAgentId)`，Host 不在该数组内，直接报 `member_disabled`（[team-dispatch.service.ts:92-97](./packages/agent-runtime/src/services/team-dispatch.service.ts:92)） |
| **Member 间互相调用** 在花名册中未被告知 | `buildTeamRosterPrompt` 永远以"You are the host"口吻撰写，未区分 Member 视角；Member 即便被注入了 `spark_team` 工具，也不知道 roster 里有哪些"同事" |
| **用户 @ 指定 Agent 直答** | `sendTurn` 无 `mentionAgentId` 字段；`startTurn` 永远把消息送进 Host 主循环；Composer 无 `@` 补全 UI |

---

## 二、目标功能定义

### 2.1 Agent 互调

- **A → B**：任意 Member A 在执行中，可通过 `spark_team.agent_dispatch` 调用任意 Member B（B ≠ A）。受 `maxDepth` 和 `dispatchCountByTurn` 预算保护。
- **Member → Host**：受新增开关 `allowCallHost` 控制（默认 `false`，向后兼容）。
- **Host → Host**：禁止（无意义，等同自循环）。
- **A → A（自调用）**：禁止（防退化循环）。

### 2.2 用户 @ 直答

- Composer 输入 `@` 后弹出可选 Agent 列表（含 Host + 启用的 Members）。
- 选中后 textarea 中显示 `@张三` 文本片段，发送时携带 `mentionAgentId`。
- 后端识别 `mentionAgentId`：
  - `mentionAgentId == hostAgentId` 或 `undefined` → 走 Host 主循环（保持原行为）。
  - `mentionAgentId ∈ memberAgentIds` → **跳过 Host 主循环**，把用户消息直接作为 task 投给该 Member 执行；其它 Member 不响应。
- 同一 turn 最多 1 个 `@`（避免歧义；多 @ 留待后续迭代）。

### 2.3 防循环

- 复用现有 `dispatchCountByTurn`（默认上限 10）和 `maxDepth`（默认 1，最大 3）。
- 新增 prompt 层规则："被回呼后不要再次向发起方 dispatch"。
- 后端硬约束：拒绝 `task.memberAgentId === currentAgentId`（即 A 在自身 turn 内不能再 dispatch 自己）。

---

## 三、协议层改造

### 3.1 `TeamModeConfig` 新增字段

文件：[packages/protocol/src/ipc/index.ts](./packages/protocol/src/ipc/index.ts)

```ts
export interface TeamModeConfig {
  enabled: boolean
  hostAgentId: string
  memberAgentIds: string[]
  maxDepth: number
  allowNesting: boolean
  /** 是否允许 Member 回呼 Host（默认 false） */
  allowCallHost?: boolean
  teamId?: string
}
```

文件：[packages/protocol/src/schemas/index.ts](./packages/protocol/src/schemas/index.ts)

```ts
export const TeamModeConfigSchema = z.object({
  enabled: z.boolean(),
  hostAgentId: z.string().min(1).max(160),
  memberAgentIds: z.array(z.string().min(1).max(160)).max(20),
  maxDepth: z.number().int().min(1).max(3),
  allowNesting: z.boolean(),
  allowCallHost: z.boolean().optional().default(false),
  teamId: z.string().min(1).max(160).optional(),
})
```

同步更新 `ManagedTeam` 接口及 `TeamCreateDefRequestSchema` / `TeamUpdateDefRequestSchema`（让长期团队定义也能持久化此开关）。

### 3.2 `SessionSendTurnRequest` 新增 `mentionAgentId`

文件：[packages/protocol/src/ipc/index.ts](./packages/protocol/src/ipc/index.ts) + 对应 Zod schema：

```ts
export interface SessionSendTurnRequest {
  // ...既有字段
  /** 用户在 composer 中通过 @ 指定的直接处理 Agent（团队模式下生效） */
  mentionAgentId?: string
}
```

### 3.3 `UserMessageEvent` 增加归属字段

文件：[packages/protocol/src/events/index.ts](./packages/protocol/src/events/index.ts)

```ts
export interface UserMessageEvent extends BaseEvent {
  type: 'user_message'
  content: string
  attachments?: Array<{ /* ... */ }>
  /** 该消息被路由到的目标 Agent ID（团队模式 @ 指定时填写）。未填 → 走 Host 主循环 */
  mentionAgentId?: string
}
```

UI 通过这个字段渲染"→ @张三 已直接处理"提示。

### 3.4 `TeamA2ATask.hostAgentId` 语义放宽

现 `hostAgentId` 在校验中并不真的要求等于 `teamConfig.hostAgentId`，已是"发起者"的语义。本次改造中：

- Member A 调用 Member B 时，`task.hostAgentId = A.id`（既已如此，[session.service.ts:1618](./packages/agent-runtime/src/services/session.service.ts:1618)）。
- Member 回呼 Host 时，`task.hostAgentId = caller.id`，`task.memberAgentId = teamConfig.hostAgentId`。
- 在事件 `team_dispatch_requested.hostAgentId` 字段语义中，描述更新为"发起 dispatch 的 Agent ID（可能是 Host 也可能是 Member）"。

---

## 四、调度服务改造（`TeamDispatchService`）

文件：[packages/agent-runtime/src/services/team-dispatch.service.ts](./packages/agent-runtime/src/services/team-dispatch.service.ts)

### 4.1 校验逻辑调整（`run()` 内）

**改动点：第 91-97 行**

```ts
// 旧逻辑：仅校验 memberAgentIds 白名单
if (member == null || !ctx.teamConfig.memberAgentIds.includes(task.memberAgentId)) {
  return fail('member_disabled', '...')
}

// 新逻辑：
const isHostTarget = task.memberAgentId === ctx.teamConfig.hostAgentId
const isMemberTarget = ctx.teamConfig.memberAgentIds.includes(task.memberAgentId)
const allowsCallHost = ctx.teamConfig.allowCallHost === true

if (member == null) {
  return fail('invalid_member', `Agent "${task.memberAgentId}" not found in team roster.`)
}
if (!isMemberTarget && !(isHostTarget && allowsCallHost)) {
  return fail(
    'member_disabled',
    isHostTarget
      ? `Calling host agent is disabled (allowCallHost=false).`
      : `Member "${task.memberAgentId}" is not enabled in this team session.`,
  )
}
// 自调用守卫
if (task.memberAgentId === task.hostAgentId) {
  return fail('invalid_member', 'Self-dispatch is not allowed.')
}
```

### 4.2 `members` 参数语义扩展

`TeamDispatchRunContext.members` 仍保留 `M[]` 泛型；调用方负责把 Host AgentItem 也塞进去（当 `allowCallHost`），service 不强制区分。

### 4.3 单元测试新增

文件：[packages/agent-runtime/src/services/team-dispatch.service.test.ts](./packages/agent-runtime/src/services/team-dispatch.service.test.ts)

- `allowCallHost=true` 时 dispatch Host 通过，emit `team_dispatch_requested`。
- `allowCallHost=false` 时 dispatch Host 返回 `member_disabled`。
- 自调用拒绝（`hostAgentId === memberAgentId`）。
- 嵌套深度 + 预算保护原有用例保持绿。

---

## 五、SessionService 改造

文件：[packages/agent-runtime/src/services/session.service.ts](./packages/agent-runtime/src/services/session.service.ts)

### 5.1 `resolveTeamMembers` 不再永远剔除 Host

**改动点：第 1583-1592 行**

```ts
private resolveTeamMembers(memberAgentIds: string[], hostAgentId: string): AgentItem[] {
  // 维持现状：只解析 memberAgentIds，不含 Host。
  // Host 由调用方按需通过 resolveHostAgentForDispatch 单独取，避免改变 prompt 中"成员列表"的含义。
  const repo = new AgentRepository(this.db)
  const members: AgentItem[] = []
  for (const id of memberAgentIds) {
    if (id === hostAgentId) continue
    const agent = repo.get(id)
    if (agent != null && agent.enabled) members.push(agent)
  }
  return members
}

// 新增辅助
private resolveDispatchableAgents(
  teamConfig: TeamModeConfig,
  callerId: string,
  members: AgentItem[],
  host: AgentItem,
): AgentItem[] {
  const list: AgentItem[] = []
  for (const m of members) {
    if (m.id !== callerId) list.push(m)
  }
  if (teamConfig.allowCallHost === true && host.id !== callerId) {
    list.push(host)
  }
  return list
}
```

> 说明：保留 `resolveTeamMembers` 现有语义（"会话成员花名册"），新增 `resolveDispatchableAgents` 用于构造"对当前调用者可见的目标列表"。两者解耦后，roster prompt（始终展示成员）与 dispatch 候选（视角依赖）互不污染。

### 5.2 `createTeamMcpServer` 改造

**改动点：第 1595-1738 行**

新增参数 `callerAgent: AgentItem`（Host 或 Member），并在内部用 `resolveDispatchableAgents` 算出该 caller 视角的合法目标集；继续把该集合传给 `TeamDispatchService.run` 的 `members` 字段。

```ts
private async createTeamMcpServer(ctx: {
  sessionId: string
  turnId: string
  callerAgent: AgentItem         // 新增：当前持有此 MCP 的 agent（Host 或 Member）
  hostAgent: AgentItem           // 新增：始终是会话 Host（用于 allowCallHost 判定）
  members: AgentItem[]
  teamConfig: TeamModeConfig
  workspaceRootPath: string
  eventRepo: EventRepository
  currentDepth?: number
}): Promise<SDKMcpServerConfig | null> {
  // ...
  const dispatchable = this.resolveDispatchableAgents(
    ctx.teamConfig,
    ctx.callerAgent.id,
    ctx.members,
    ctx.hostAgent,
  )

  const runSingleDispatch = async (args, parallel = false) => {
    const task: TeamA2ATask = {
      taskId: crypto.randomUUID(),
      hostAgentId: ctx.callerAgent.id,   // ← 发起者：始终是 caller，而非会话 Host
      memberAgentId: String(args.targetAgentId ?? ''),
      // ...
    }
    return this.getTeamDispatchService().run(task, {
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      hostAgentId: ctx.callerAgent.id,
      members: dispatchable,             // ← caller 视角的目标集
      teamConfig: ctx.teamConfig,
      currentDepth: ctx.currentDepth ?? 0,
      emitEvent: /* ... */,
      executeMember: ({ member, task, dispatchId, signal, memberDepth }) =>
        this.executeMemberTurn({
          member,
          task,
          dispatchId,
          // ...
          members: ctx.members,          // 仍传完整成员表（嵌套时再次按视角过滤）
        }),
    }, { parallel })
  }
  // ...
}
```

### 5.3 `executeMemberTurn` 改造

**改动点：第 1741-1906 行**

- 注入嵌套 `spark_team` MCP 时（既有逻辑），`createTeamMcpServer` 的 `callerAgent` 改为 `member`；`hostAgent` 始终传入会话 Host AgentItem（需新增一次 `AgentRepository.get(teamConfig.hostAgentId)`）。
- 当目标 Member 实际上是 Host（即 `member.id === teamConfig.hostAgentId`）时，`executeMemberTurn` 内不需特殊处理——Host 仍以"一次 one-shot turn"执行，prompt 由 `buildManagedAgentSystemPrompt(host, null)` 产出（不附带 roster，避免 Host 在 one-shot 里又试图 dispatch）。

```ts
// executeMemberTurn 内：
const hostAgent = new AgentRepository(this.db).get(teamConfig.hostAgentId)
if (teamConfig.allowNesting && memberDepth < teamConfig.maxDepth) {
  nestedTeamServer = (await this.createTeamMcpServer({
    sessionId, turnId,
    callerAgent: member,
    hostAgent: hostAgent!,
    members,
    teamConfig,
    workspaceRootPath,
    eventRepo,
    currentDepth: memberDepth,
  })) ?? undefined
}
```

### 5.4 Host 主循环入口同步

**改动点：第 786-799 行**

```ts
teamMcpServer = (await this.createTeamMcpServer({
  sessionId, turnId,
  callerAgent: agent,    // Host
  hostAgent: agent,
  members,
  teamConfig,
  workspaceRootPath,
  eventRepo,
})) ?? undefined
```

### 5.5 `buildTeamRosterPrompt` 拆成两套视角

**改动点：第 2832-2861 行**

将函数重构为：

```ts
export function buildTeamRosterPrompt(
  caller: AgentItem,
  hostAgent: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  perspective: 'host' | 'member',
): string {
  // perspective='host'  → 原文案（你是主持，可调度成员）
  // perspective='member' →
  //   - 列出其它 Members（排除 caller 自身）
  //   - 若 allowCallHost: 列出 Host，标注"主持"
  //   - 提示"被调用进入此 turn 是因为 Host/同事委托，只做被托付的事，做完返回"
  //   - 提示"如需 Host 决策可回呼 mcp__spark_team__agent_dispatch(targetAgentId='<hostId>')"
  //   - 强约束：不要回呼刚刚委托你的发起方（防 ping-pong）
}
```

Host 主循环调用：`buildTeamRosterPrompt(agent, agent, members, teamConfig, 'host')`
`executeMemberTurn` 中（嵌套场景）需要把 Member 视角 prompt 注入：

```ts
const memberSystemPrompt = joinPromptSections(
  buildManagedAgentSystemPrompt(member, null),
  // 仅当 member 被注入了 spark_team（即可调度）时才追加 roster
  nestedTeamServer != null
    ? buildTeamRosterPrompt(member, hostAgent!, members, teamConfig, 'member')
    : '',
)
```

### 5.6 `sendTurn` / `startTurn` 支持 `mentionAgentId`

**改动点：`sendTurn`（第 522-559 行）和 `startTurn`（第 561-1072 行）**

```ts
async sendTurn(params: {
  // ...既有字段
  mentionAgentId?: string
}): Promise<{ turnId: string; started: boolean }> {
  // 既有排队逻辑保持；mentionAgentId 一并放入 PendingTurn
}

type PendingTurn = {
  // ...
  mentionAgentId?: string
}
```

`startTurn` 入口分支：

```ts
private async startTurn(/* ... */, mentionAgentId?: string): Promise<void> {
  // ...
  const teamConfig = readSessionTeamConfig(session)

  const mentionTargetIsMember =
    teamConfig?.enabled === true
    && mentionAgentId != null
    && mentionAgentId !== teamConfig.hostAgentId
    && teamConfig.memberAgentIds.includes(mentionAgentId)

  if (mentionTargetIsMember) {
    return this.startMentionedMemberTurn({
      sessionId, turnId, message, attachments,
      mentionAgentId: mentionAgentId!,
      teamConfig: teamConfig!,
    })
  }
  // 否则走原有 Host 主循环（包括 @host 与无 @）
}
```

### 5.7 新增 `startMentionedMemberTurn`

```ts
private async startMentionedMemberTurn(args: {
  sessionId: string
  turnId: string
  message: string
  attachments?: SessionAttachment[]
  mentionAgentId: string
  teamConfig: TeamModeConfig
}): Promise<void> {
  const eventRepo = new EventRepository(this.db)
  const sessionRepo = new SessionRepository(this.db)

  // 1. 发送 user_message（带 mentionAgentId）
  this.emitAndPersist(args.sessionId, args.turnId, {
    id: crypto.randomUUID(),
    type: 'user_message',
    sessionId: args.sessionId, turnId: args.turnId,
    timestamp: new Date().toISOString(), seq: 0,
    content: args.message,
    mentionAgentId: args.mentionAgentId,
  }, eventRepo)

  // 2. 解析目标 member + Host AgentItem
  const agentRepo = new AgentRepository(this.db)
  const member = agentRepo.get(args.mentionAgentId)
  const hostAgent = agentRepo.get(args.teamConfig.hostAgentId)
  if (member == null || !member.enabled) {
    // emit agent_error，sessionRepo.updateStatus('error') 后返回
  }

  // 3. 切换 session 状态为 running，记入 activeLoops（以便 cancel 生效）
  const fakeExecutor: ActiveExecution = { cancel: () => this.teamDispatchService?.cancelAll() }
  this.activeLoops.set(args.sessionId, fakeExecutor)
  sessionRepo.updateStatus(args.sessionId, 'running')
  this.emitQueueChanged(args.sessionId)

  // 4. 构造 TeamA2ATask 投递（hostAgentId 填会话 Host，仅作审计；instruction = 用户原文）
  const task: TeamA2ATask = {
    taskId: crypto.randomUUID(),
    hostAgentId: args.teamConfig.hostAgentId,
    memberAgentId: args.mentionAgentId,
    rootTurnId: args.turnId,
    instruction: args.message,
    // attachments 转 task.attachments
  }

  try {
    const members = this.resolveTeamMembers(args.teamConfig.memberAgentIds, args.teamConfig.hostAgentId)
    const workspaceRootPath = /* 同 startTurn 的解析逻辑 */
    await this.getTeamDispatchService().run(task, {
      sessionId: args.sessionId,
      turnId: args.turnId,
      hostAgentId: args.teamConfig.hostAgentId,
      members,
      teamConfig: args.teamConfig,
      currentDepth: 0,
      emitEvent: (e) => this.emitAndPersist(args.sessionId, args.turnId, e, eventRepo),
      executeMember: (eArgs) => this.executeMemberTurn({
        ...eArgs,
        sessionId: args.sessionId,
        turnId: args.turnId,
        workspaceRootPath,
        eventRepo,
        members,
        teamConfig: args.teamConfig,
      }),
    })
    sessionRepo.updateStatus(args.sessionId, 'idle')
  } catch {
    sessionRepo.updateStatus(args.sessionId, 'error')
  } finally {
    this.teamDispatchService?.clearTurn(args.turnId)
    if (this.activeLoops.get(args.sessionId) === fakeExecutor) {
      this.activeLoops.delete(args.sessionId)
      this.startNextQueuedTurn(args.sessionId)
    }
  }
}
```

> 关键点：@ 直答的执行复用 `executeMemberTurn`，因此 Member 嵌套调用、`team_member_message` 渲染、token 统计等都"免费"得到。

### 5.8 IPC handler 透传 `mentionAgentId`

文件：[apps/desktop/src/main/ipc/index.ts](./apps/desktop/src/main/ipc/index.ts)（`session:send-turn` handler）

把 request 上的 `mentionAgentId` 一路传给 `sessionService.sendTurn`。

---

## 六、前端改造

### 6.1 Composer `@` 补全弹窗

新增组件：`apps/desktop/src/renderer/design/components/MentionPopover.tsx`

**Props**

```ts
export interface MentionCandidate {
  agentId: string
  name: string
  description: string
  isHost: boolean
  avatarSrc: string
  builtIn: boolean
}

export interface MentionPopoverProps {
  open: boolean
  /** 浮层锚点坐标（相对 viewport，由 caret 计算） */
  anchor: { left: number; top: number } | null
  query: string
  candidates: MentionCandidate[]
  onSelect: (c: MentionCandidate) => void
  onDismiss: () => void
}
```

**行为**

- 数据源：通过 `team:list-members` IPC（`TeamListMembersResponse`）拿到 `hostAgentId + members`；映射成 `MentionCandidate[]`，把 Host 放第一项并打 `isHost=true`。
- 过滤：`query` 同时匹配 `name`（中英文）/ `description` / `agentId`，case-insensitive、includes 即可（暂不引拼音库）。
- 键盘：
  - `↑` / `↓` 移动 hover 项；`Home` / `End` 跳首尾。
  - `Enter` / `Tab` 选中。
  - `Esc` 或失焦或 query 含空格 → 关闭。
- 鼠标：点击选中；hover 与键盘 hover 同步。

**视觉**（CSS 加在 [views.css](./apps/desktop/src/renderer/design/styles/views.css)）

```css
.mention-popover {
  position: fixed;            /* 跟随 caret，独立于 composer 滚动 */
  min-width: 280px;
  max-width: 360px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--surface-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  padding: 6px;
  z-index: 1000;
}
.mention-popover-item {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.mention-popover-item:hover,
.mention-popover-item.is-active {
  background: var(--surface-hover);
}
.mention-popover-item .avatar {
  width: 32px; height: 32px;
  border-radius: 8px;   /* 与 TeamMemberBubble 一致 */
}
.mention-popover-item .name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}
.mention-popover-item .desc {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mention-popover-item .host-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.mention-popover-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
```

每一项布局：`[Avatar] [Name + Description] [Host Badge?]`，避免高度跳动。

### 6.2 Composer 集成（[ChatView.tsx](./apps/desktop/src/renderer/design/views/ChatView.tsx)）

在 textarea ref 所在组件中：

1. **触发检测**：textarea `onInput` 时取 `selectionStart`，从 `value` 中向前扫描，匹配 `(^|\s)@([^\s@]*)$`：
   - 匹配 → 进入 mention 模式：记录 `mentionStart`（`@` 的索引）、`query`（@ 后的子串）。
   - 不匹配 → 退出 mention 模式，关闭弹窗。
2. **Caret 坐标**：在 textarea 镜像 `<div>`（同字体、同尺寸、`white-space: pre-wrap`）中插入到 `selectionStart`，取 `<span>` 的 `getBoundingClientRect()` → 得到 caret 视觉位置；浮层 `top = caretBottom + 4`、`left = caretLeft`。
3. **选中处理**：
   - 把 `@${query}` 整段替换为 `@${candidate.name} `（末尾跟一个空格便于继续输入）。
   - state 中保存 `pendingMention: { agentId, name }`；UI 上不做特别高亮（plain text）。
4. **失效兜底**：
   - 用户继续编辑后 `@xxx ` 段被改动（如删掉名字一部分）→ 视为失效，清空 `pendingMention`。**实现方式：发送前再次用正则确认文本中仍含 `@${pendingMention.name}` 子串。** 不匹配则不传 `mentionAgentId`。
5. **发送时**：

```ts
await sendTurn({
  sessionId,
  message: composerValue,
  ...(pendingMention != null ? { mentionAgentId: pendingMention.agentId } : {}),
  // ...
})
setPendingMention(null)
```

### 6.3 用户消息渲染

在 [event-mapper.ts](./apps/desktop/src/renderer/design/services/event-mapper.ts) 的 `UserMessage → UIMessage` 映射中带出 `mentionAgentId`。ChatView 渲染用户气泡时若有该字段：

```tsx
{message.mentionAgentId && mentionedAgentName && (
  <div className="msg-user-mention-hint">
    → 已直接由 <strong>@{mentionedAgentName}</strong> 处理
  </div>
)}
```

`mentionedAgentName` 通过会话当前 `team:list-members` 结果反查。

### 6.4 Inspector 增加 `allowCallHost` 开关

文件：[TeamInspectorSection.tsx](./apps/desktop/src/renderer/design/components/TeamInspectorSection.tsx)

在"高级"区块新增 toggle：

```tsx
<label className="team-advanced-row">
  <input
    type="checkbox"
    checked={config.allowCallHost === true}
    onChange={(e) => onChangeConfig({ allowCallHost: e.target.checked })}
  />
  <span>允许成员回呼主持 Agent</span>
  <small>启用后，被调度的成员可以反向调用 Host 寻求决策或汇总；仍受最大深度约束</small>
</label>
```

---

## 七、改动文件清单

| 路径 | 改动类型 | 关键内容 |
|---|---|---|
| [packages/protocol/src/ipc/index.ts](./packages/protocol/src/ipc/index.ts) | 修改 | `TeamModeConfig.allowCallHost`、`ManagedTeam.allowCallHost`、`SessionSendTurnRequest.mentionAgentId` |
| [packages/protocol/src/events/index.ts](./packages/protocol/src/events/index.ts) | 修改 | `UserMessageEvent.mentionAgentId` |
| [packages/protocol/src/schemas/index.ts](./packages/protocol/src/schemas/index.ts) | 修改 | `TeamModeConfigSchema`、`SessionSendTurnRequestSchema` 同步 |
| [packages/agent-runtime/src/services/team-dispatch.service.ts](./packages/agent-runtime/src/services/team-dispatch.service.ts) | 修改 | `run()` 校验放行 Host、拒绝自调用 |
| [packages/agent-runtime/src/services/team-dispatch.service.test.ts](./packages/agent-runtime/src/services/team-dispatch.service.test.ts) | 修改 | 新增 allowCallHost / 自调用用例 |
| [packages/agent-runtime/src/services/session.service.ts](./packages/agent-runtime/src/services/session.service.ts) | 修改 | `resolveDispatchableAgents`、`createTeamMcpServer` 增 `callerAgent`、`buildTeamRosterPrompt` 双视角、`sendTurn` / `startTurn` 接 `mentionAgentId`、新增 `startMentionedMemberTurn` |
| [packages/agent-runtime/src/services/team-roster-prompt.test.ts](./packages/agent-runtime/src/services/team-roster-prompt.test.ts) | 修改 | 新增 member 视角与 allowCallHost 用例 |
| [packages/agent-runtime/src/services/session-team-reply-format.test.ts](./packages/agent-runtime/src/services/session-team-reply-format.test.ts) | 修改 | 补 mention 路径 |
| [apps/desktop/src/main/ipc/index.ts](./apps/desktop/src/main/ipc/index.ts) | 修改 | `session:send-turn` 透传 `mentionAgentId` |
| [apps/desktop/src/renderer/design/views/ChatView.tsx](./apps/desktop/src/renderer/design/views/ChatView.tsx) | 修改 | composer `@` 检测、Caret 定位、发送时携带 `mentionAgentId`、用户气泡渲染 mention 提示 |
| [apps/desktop/src/renderer/design/components/MentionPopover.tsx](./apps/desktop/src/renderer/design/components/MentionPopover.tsx) | **新增** | @ 弹窗组件 |
| [apps/desktop/src/renderer/design/styles/views.css](./apps/desktop/src/renderer/design/styles/views.css) | 修改 | `.mention-popover` 系列样式 |
| [apps/desktop/src/renderer/design/components/TeamInspectorSection.tsx](./apps/desktop/src/renderer/design/components/TeamInspectorSection.tsx) | 修改 | `allowCallHost` toggle |
| [apps/desktop/src/renderer/design/services/event-mapper.ts](./apps/desktop/src/renderer/design/services/event-mapper.ts) | 修改 | `UserMessage` 映射带 `mentionAgentId` |
| [apps/desktop/src/renderer/tests/team-events.test.ts](./apps/desktop/src/renderer/tests/team-events.test.ts) | 修改 | 新增 mention 渲染 / event 用例 |

---

## 八、分阶段实施计划

### Phase 1 · 后端 Agent 互调（0.5 d）

- [ ] 协议 `allowCallHost` + schema
- [ ] `TeamDispatchService.run` 校验改造 + 单元测试
- [ ] `SessionService.resolveDispatchableAgents` + `createTeamMcpServer` 新增 `callerAgent`
- [ ] `buildTeamRosterPrompt` 双视角重构 + 单元测试
- [ ] `executeMemberTurn` 嵌套场景注入 caller 视角 prompt
- [ ] Inspector `allowCallHost` toggle

**完成标志**：在长期团队中开启 `allowCallHost`，Host 可以让 Member A 在执行中通过工具调用 Host，事件流出现完整 `team_dispatch_requested(host→A) → team_dispatch_requested(A→host) → team_dispatch_completed` 链。

### Phase 2 · @ 路由后端（0.5 d）

- [ ] 协议 `mentionAgentId` + IPC 透传
- [ ] `startMentionedMemberTurn` 实现
- [ ] `UserMessageEvent.mentionAgentId` 字段
- [ ] event-mapper / 用户气泡渲染 mention 提示
- [ ] team-events 测试补充

**完成标志**：手动构造 `sendTurn({ mentionAgentId: '<memberId>', ... })` 请求，Member 直接响应，无 Host 输出。

### Phase 3 · Composer @ 补全 UI（1.0 d）

- [ ] `MentionPopover` 组件 + 样式
- [ ] Caret 坐标计算（mirror-div 工具函数，约 50 LOC）
- [ ] ChatView composer 集成（`@` 检测、键盘、选中、失效检测）
- [ ] 用 [verify](./.claude/skills/verify/SKILL.md) 在实际窗口验证：键盘流、中文姓名匹配、@ Host 等价主循环、@ Member 直答

**完成标志**：用户在群聊 composer 中输入 `@`，弹窗显示 Host + 所有启用 Member（含头像/描述/角色 badge），↑↓Enter 流畅，回车后发送消息直达该 Agent。

### Phase 4 · 文档与回归（0.5 d）

- [ ] [团队模式开发.md](./团队模式开发.md) 补 §3.5 "互调与 @ 路由" 小节
- [ ] [CHANGELOG.md](./CHANGELOG.md) 添加用户可见变更项
- [ ] 全量测试 `pnpm test`、`pnpm typecheck`、`pnpm lint`
- [ ] 手测矩阵（见 §九）

---

## 九、手测矩阵

| 编号 | 场景 | 期望 |
|---|---|---|
| T-01 | 无团队模式，普通会话 | 行为完全不变 |
| T-02 | 团队模式，Host 调度 Member | 既有 dispatch 卡 + member bubble |
| T-03 | `allowNesting=true, allowCallHost=false`，Host→A，A 尝试调度 B | 成功，B 输出气泡 |
| T-04 | 同上，A 尝试调度 Host | dispatch `member_disabled` 错误反馈给 A |
| T-05 | `allowCallHost=true`，A 调度 Host | Host 以 one-shot 形式响应，返回内容回灌给 A |
| T-06 | `maxDepth=1`，Host→A 直接调度 Host | 深度超限 `depth_exceeded`（depth=0→1，1>=maxDepth=1） |
| T-07 | 自调用（A→A） | `invalid_member` 立即拒绝 |
| T-08 | Composer 输入 `@`，弹窗显示 | Host 排首位、Members 按启用顺序、含头像与描述 |
| T-09 | 输入 `@张` 过滤 | 仅显示名字含「张」的 Agent |
| T-10 | ↑↓Enter 选中 | textarea 显示 `@张三 `，光标在空格后 |
| T-11 | `@张三 帮我看看 X` 发送 | 用户气泡下方显示 "→ @张三 已直接处理"，无 Host 输出，张三气泡流式响应 |
| T-12 | `@host 你好` | 走 Host 主循环（与不带 @ 等价） |
| T-13 | 发送前手动把 `@张三` 改成 `@张三s` | `mentionAgentId` 失效，恢复为 Host 主循环 |
| T-14 | turn 进行中点击 cancel | dispatch 被 abort、session 回 idle、UI 不卡 |
| T-15 | `dispatchCountByTurn` 超限场景（构造一个会让 A 反复回呼 Host 的 prompt） | 第 11 次开始返回 `Dispatch budget exceeded` |

---

## 十、风险与缓解

| 风险 | 缓解 |
|---|---|
| Member→Host→Member 形成 ping-pong 循环 | (1) `maxDepth ≤ 3` 硬上限；(2) `dispatchCountByTurn = 10` 预算；(3) prompt 显式劝阻；(4) 自调用守卫。组合下不会失控。 |
| Host one-shot 执行时无 roster，但因模型记忆/工具记忆尝试再 dispatch | `executeMemberTurn` 不给 Host 注入 `spark_team` 工具（仅当 caller≠hostAgent 才注入嵌套）→ 即便 Host 想 dispatch 也无工具可用。 |
| Composer caret 定位在中文 IME 输入态偏移 | mirror-div 复制 IME 文本（`compositionend` 后重算）；首版可接受 1-2 px 偏差。 |
| 长期团队 `allowCallHost` 字段对老数据兼容 | 缺省视为 `false`；DB 不需 migration（metadata JSON 解析 fallback）。 |
| `mentionAgentId` 指向已禁用 Member | 后端 emit `agent_error` 并回退到 Host 主循环？→ **不回退**：直接报错告知用户该成员已禁用，避免行为悄悄改变。 |

---

## 十一、不在本次范围

- 多 @ mention（一次 turn @ 多人并行）。
- `@all` 让所有 Member 同时响应（属于"群广播"模式，需要 batch + 聚合 UI，独立设计）。
- Member 间私聊（不经过事件总线）—— 当前架构所有 Member 输出都走 session event stream，可见即可审计，不引入私聊通道。
- 跨 session 的 Agent 调用。
