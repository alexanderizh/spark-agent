/**
 * TeamDispatchService 单元测试
 *
 * 用 mock repo + mock executeMember 验证调度编排逻辑（校验/预算/深度/持久化/事件/取消），
 * 不依赖 SDK 或 better-sqlite3。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TeamDispatchService } from './team-dispatch.service.js'
import type { TeamDispatchRunContext, TeamMemberExecutionResult } from './team-dispatch.service.js'
import type { AgentEvent, TeamA2ATask, TeamModeConfig } from '@spark/protocol'

type Member = { id: string; name: string }

function makeRepo() {
  return {
    create: vi.fn(),
    update: vi.fn(),
  }
}

function makeTask(memberAgentId = 'reviewer', overrides: Partial<TeamA2ATask> = {}): TeamA2ATask {
  return {
    taskId: 't1',
    hostAgentId: 'code-agent',
    memberAgentId,
    rootTurnId: 'turn-1',
    instruction: 'review this code',
    ...overrides,
  }
}

function makeCtx(
  overrides: Partial<TeamDispatchRunContext<Member>> = {},
): { ctx: TeamDispatchRunContext<Member>; events: AgentEvent[] } {
  const events: AgentEvent[] = []
  const teamConfig: TeamModeConfig = {
    enabled: true,
    hostAgentId: 'code-agent',
    memberAgentIds: ['reviewer', 'rust-coder'],
    maxDepth: 1,
    allowNesting: false,
  }
  const ctx: TeamDispatchRunContext<Member> = {
    sessionId: 'sess-1',
    turnId: 'turn-1',
    hostAgentId: 'code-agent',
    members: [
      { id: 'reviewer', name: 'Reviewer' },
      { id: 'rust-coder', name: 'Rust Coder' },
    ],
    teamConfig,
    currentDepth: 0,
    emitEvent: (e) => events.push(e),
    executeMember: async (): Promise<TeamMemberExecutionResult> => ({
      content: 'looks good',
      inputTokens: 100,
      outputTokens: 200,
    }),
    ...overrides,
  }
  return { ctx, events }
}

describe('TeamDispatchService', () => {
  let repo: ReturnType<typeof makeRepo>
  let service: TeamDispatchService

  beforeEach(() => {
    repo = makeRepo()
    service = new TeamDispatchService(repo as never)
  })

  it('runs a successful dispatch: emits requested+status+completed, persists, returns completed reply', async () => {
    const { ctx, events } = makeCtx()
    const reply = await service.run(makeTask(), ctx)

    expect(reply.state).toBe('completed')
    expect(reply.memberAgentId).toBe('reviewer')
    expect(reply.memberName).toBe('Reviewer')
    expect(reply.content).toBe('looks good')
    expect(reply.usage?.inputTokens).toBe(100)
    expect(reply.usage?.outputTokens).toBe(200)

    const types = events.map((e) => e.type)
    expect(types).toContain('team_dispatch_requested')
    expect(types).toContain('team_member_status')
    expect(types).toContain('team_dispatch_completed')

    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'completed' }),
    )
  })

  it('rejects a member not in memberAgentIds without calling executeMember', async () => {
    const executeMember = vi.fn()
    const { ctx } = makeCtx({ executeMember })
    const reply = await service.run(makeTask('writer'), ctx)

    expect(reply.state).toBe('failed')
    expect(reply.error?.code).toBe('member_disabled')
    expect(executeMember).not.toHaveBeenCalled()
  })

  it('rejects nested dispatch when allowNesting is false (depth > 0)', async () => {
    const { ctx } = makeCtx({ currentDepth: 1 })
    const reply = await service.run(makeTask(), ctx)
    expect(reply.state).toBe('failed')
    expect(reply.error?.code).toBe('depth_exceeded')
  })

  it('enforces the per-turn dispatch budget', async () => {
    const svc = new TeamDispatchService(repo as never, 2)
    const { ctx } = makeCtx()
    expect((await svc.run(makeTask(), ctx)).state).toBe('completed')
    expect((await svc.run(makeTask(), ctx)).state).toBe('completed')
    const third = await svc.run(makeTask(), ctx)
    expect(third.state).toBe('failed')
    expect(third.error?.code).toBe('internal')
  })

  it('returns a failed reply when executeMember throws', async () => {
    const { ctx } = makeCtx({
      executeMember: async () => {
        throw new Error('provider down')
      },
    })
    const reply = await service.run(makeTask(), ctx)
    expect(reply.state).toBe('failed')
    expect(reply.error?.message).toContain('provider down')
    expect(repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'failed' }),
    )
  })

  it('allows nested dispatch when allowNesting is true and within maxDepth', async () => {
    const { ctx } = makeCtx({
      currentDepth: 1,
      teamConfig: {
        enabled: true,
        hostAgentId: 'code-agent',
        memberAgentIds: ['reviewer', 'rust-coder'],
        maxDepth: 2,
        allowNesting: true,
      },
    })
    const reply = await service.run(makeTask(), ctx)
    expect(reply.state).toBe('completed')
  })

  it('serializes member executions within the same turn', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const executeMember = vi.fn(async ({ member }: Parameters<TeamDispatchRunContext<Member>['executeMember']>[0]) => {
      order.push(`start:${member.id}`)
      if (member.id === 'reviewer') {
        markFirstStarted?.()
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      order.push(`end:${member.id}`)
      return { content: `${member.name} done` }
    })
    const { ctx } = makeCtx({ executeMember })

    const first = service.run(makeTask('reviewer'), ctx)
    await firstStarted
    const second = service.run(makeTask('rust-coder', { taskId: 't2' }), ctx)
    await Promise.resolve()

    expect(order).toEqual(['start:reviewer'])
    releaseFirst?.()
    await Promise.all([first, second])

    expect(order).toEqual([
      'start:reviewer',
      'end:reviewer',
      'start:rust-coder',
      'end:rust-coder',
    ])
    expect(executeMember).toHaveBeenCalledTimes(2)
  })

  it('allows dispatch to a worker in allowedWorkerIds even if not in team roster', async () => {
    // worker 'planner' 不在 teamConfig.memberAgentIds，但在 allowedWorkerIds 内（workflow 场景）
    const { ctx, events } = makeCtx({
      members: [{ id: 'planner', name: 'Planner' }],
      allowedWorkerIds: new Set(['planner']),
    })
    const reply = await service.run(makeTask('planner'), ctx)

    expect(reply.state).toBe('completed')
    expect(reply.memberAgentId).toBe('planner')
    expect(events.map((e) => e.type)).toContain('team_dispatch_completed')
  })

  it('rejects dispatch to a worker outside allowedWorkerIds', async () => {
    const { ctx } = makeCtx({
      members: [{ id: 'planner', name: 'Planner' }],
      allowedWorkerIds: new Set(['planner']),
    })
    const reply = await service.run(makeTask('intruder'), ctx)

    expect(reply.state).toBe('failed')
    expect(reply.error?.code).toBe('member_disabled')
  })

  it('falls back to teamConfig.memberAgentIds when allowedWorkerIds is absent (team unchanged)', async () => {
    const { ctx } = makeCtx() // 无 allowedWorkerIds
    const reply = await service.run(makeTask('reviewer'), ctx)
    expect(reply.state).toBe('completed')
  })

  it('with options.parallel=true bypasses the turn serialization queue', async () => {
    const order: string[] = []
    const executeMember = vi.fn(async ({ member }: Parameters<TeamDispatchRunContext<Member>['executeMember']>[0]) => {
      order.push(`start:${member.id}`)
      // 两个 member 同时进入；如果是串行，第二个会等第一个 await 才进入
      await new Promise((r) => setTimeout(r, 10))
      order.push(`end:${member.id}`)
      return { content: `${member.name} done` }
    })
    const { ctx } = makeCtx({ executeMember })

    const both = await Promise.all([
      service.run(makeTask('reviewer'), ctx, { parallel: true }),
      service.run(makeTask('rust-coder', { taskId: 't2' }), ctx, { parallel: true }),
    ])

    expect(both.every((r) => r.state === 'completed')).toBe(true)
    // 并行：两个 start 都先于任何 end 发生
    expect(order.slice(0, 2).every((entry) => entry.startsWith('start:'))).toBe(true)
    expect(order.slice(2).every((entry) => entry.startsWith('end:'))).toBe(true)
  })
})

describe('recordPeerMessage (FR-B agent_message 两形态)', () => {
	  let threadMessages: Array<{
	    discussion_id: string
	    sender_agent_id: string
	    target_agent_id: string | null
	    round_index: number
	    kind: string
	    content: string
	    delivery?: 'call' | 'note' | null
	  }>
  let discussionRepo: {
    appendMessage: ReturnType<typeof vi.fn>
    listMessages: ReturnType<typeof vi.fn>
  }
  let service: TeamDispatchService

  beforeEach(() => {
    threadMessages = []
    discussionRepo = {
      appendMessage: vi.fn((message: {
        discussionId: string
        senderAgentId: string
        targetAgentId?: string
        roundIndex: number
        kind: string
	        content: string
	        delivery?: 'call' | 'note' | null
	      }) => {
	        threadMessages.push({
          discussion_id: message.discussionId,
          sender_agent_id: message.senderAgentId,
          target_agent_id: message.targetAgentId ?? null,
          round_index: message.roundIndex,
	          kind: message.kind,
	          content: message.content,
	          delivery: message.delivery ?? null,
	        })
	      }),
      listMessages: vi.fn((discussionId: string) => threadMessages.filter((message) => message.discussion_id === discussionId)),
    }
    // maxDispatchesPerTurn=10, maxMessagesPerDiscussion=3（便于测超限）
    service = new TeamDispatchService(makeRepo() as never, 10, discussionRepo as never, 3)
  })

  it('广播：只写线程 + emit team_peer_message，不触发任何成员执行', async () => {
    const executeMember = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'never' }))
    const { ctx, events } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember })
    const res = await service.recordPeerMessage(
      { content: 'hi team', senderAgentId: 'reviewer', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
    expect(res.ok).toBe(true)
    expect(executeMember).not.toHaveBeenCalled()
    expect(discussionRepo.appendMessage).toHaveBeenCalledTimes(1)
    expect(discussionRepo.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'peer_message', senderAgentId: 'reviewer', content: 'hi team' }),
    )
	    expect(events.some((e) => e.type === 'team_peer_message')).toBe(true)
	  })

	  it('定向 note：只写线程 + emit delivery=note，不触发目标执行', async () => {
	    const executeMember = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'never' }))
	    const { ctx, events } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember })
	    const res = await service.recordPeerMessage(
	      {
	        content: '接口更新好了，有空看一下',
	        senderAgentId: 'reviewer',
	        targetAgentId: 'rust-coder',
	        delivery: 'note',
	        discussionId: 'd1',
	        roundIndex: 0,
	      },
	      ctx,
	    )
	    expect(res.ok).toBe(true)
	    expect(executeMember).not.toHaveBeenCalled()
	    expect(threadMessages[0]).toMatchObject({
	      target_agent_id: 'rust-coder',
	      delivery: 'note',
	    })
	    const event = events.find((e) => e.type === 'team_peer_message')
	    expect(event).toMatchObject({ type: 'team_peer_message', delivery: 'note' })
	  })

  it('定向 @：触发目标一次完整 turn（run），写 peer_message + member_reply 两条线程', async () => {
    const executeMember = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'reply-body' }))
    const { ctx, events } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember })
    const res = await service.recordPeerMessage(
      {
        content: '@rust-coder 帮我看下',
        senderAgentId: 'reviewer',
        targetAgentId: 'rust-coder',
        discussionId: 'd1',
        roundIndex: 0,
      },
      ctx,
    )
    expect(res.ok).toBe(true)
    expect(executeMember).toHaveBeenCalledTimes(1)
    // peer_message（发起者）+ member_reply（目标回复）
    expect(discussionRepo.appendMessage).toHaveBeenCalledTimes(2)
    const kinds = (discussionRepo.appendMessage.mock.calls as unknown as Array<Array<{ kind: string }>>).map(
      (c) => c[0]!.kind,
    )
    expect(kinds).toContain('peer_message')
    expect(kinds).toContain('member_reply')
    expect(events.some((e) => e.type === 'team_peer_message')).toBe(true)
    expect(events.some((e) => e.type === 'team_dispatch_completed')).toBe(true)
    // 显式 agent_message 不是自动转发，不带 autoForwarded 标记
    const peerEvent = events.find((e) => e.type === 'team_peer_message')
    expect((peerEvent as { autoForwarded?: boolean }).autoForwarded).toBeUndefined()
  })

  it('自动 @ 转发：回复互相 @ 时对话自动延续（链式），并被讨论消息预算硬终止', async () => {
    // reviewer 和 Rust Coder 的回复互相 @ 对方——链式语义下自动往返，直到某层预算拦截。
    // 本测试的 service maxMessagesPerDiscussion=3：3 条 auto peer_message 后第 4 条被
    // message_budget_exceeded 拦下 → executeMember 恰好 1（原始）+ 3（auto）= 4 次。
    const executeMember = vi.fn(async ({ member }: { member: { id: string } }): Promise<TeamMemberExecutionResult> => ({
      content: member.id === 'reviewer'
        ? '@Rust Coder 你那边的接口定义确认了吗？'
        : '@Reviewer 确认了，见 v2 schema。',
    }))
    const peerConfig: TeamModeConfig = {
      enabled: true,
      hostAgentId: 'code-agent',
      memberAgentIds: ['reviewer', 'rust-coder'],
      maxDepth: 1,
      allowNesting: false,
      enablePeerMessaging: true,
    }
    const { ctx, events } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember, teamConfig: peerConfig })
    const reply = await service.run(makeTask('reviewer'), ctx)
    expect(reply.state).toBe('completed')
    expect(executeMember).toHaveBeenCalledTimes(4)
    const kinds = threadMessages.map((m) => m.kind)
    expect(kinds.filter((k) => k === 'peer_message')).toHaveLength(3)
    expect(events.some((e) => e.type === 'team_peer_message')).toBe(true)
    // 自动转发的 peer_message 事件全部带 autoForwarded=true（UI 据此降级为轻量转发提示）
    const peerEvents = events.filter((e) => e.type === 'team_peer_message')
    expect(peerEvents.length).toBeGreaterThan(0)
    for (const e of peerEvents) {
      expect((e as { autoForwarded?: boolean }).autoForwarded).toBe(true)
    }
  })

  it('自动 @ 转发：无 @ 的回复完全不干预；enablePeerMessaging=false 时含 @ 也不触发', async () => {
    const plainExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: '完成，无需协作。' }))
    const peerOnConfig: TeamModeConfig = {
      enabled: true,
      hostAgentId: 'code-agent',
      memberAgentIds: ['reviewer', 'rust-coder'],
      maxDepth: 1,
      allowNesting: false,
      enablePeerMessaging: true,
    }
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember: plainExecute, teamConfig: peerOnConfig })
    await service.run(makeTask('reviewer'), ctx)
    expect(plainExecute).toHaveBeenCalledTimes(1)

    // 灰度关：含 @ 也不触发
    const mentionExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: '@Rust Coder 看一下' }))
    const { ctx: offCtx } = makeCtx({ discussionId: 'd2', roundIndex: 0, executeMember: mentionExecute })
    await service.run(makeTask('reviewer'), offCtx)
    expect(mentionExecute).toHaveBeenCalledTimes(1)
  })

  it('成员发起的定向 @ 不受嵌套深度限制（currentDepth>0 + allowNesting=false 仍成功）', async () => {
    const executeMember = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'peer reply' }))
    // 模拟发起者是深度 1 的成员（被 Host dispatch 中）；默认 allowNesting=false, maxDepth=1，
    // 旧实现会被 run 的 depth_exceeded 拦截——peer messaging 是平层对话，不该走嵌套校验。
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember, currentDepth: 1 })
    const res = await service.recordPeerMessage(
      {
        content: '@rust-coder 你的结论是什么？',
        senderAgentId: 'reviewer',
        targetAgentId: 'rust-coder',
        discussionId: 'd1',
        roundIndex: 0,
      },
      ctx,
    )
    expect(res.ok).toBe(true)
    expect(executeMember).toHaveBeenCalledTimes(1)
    if (res.ok) expect(res.reply?.state).toBe('completed')
  })

  it('定向 @ 绕过 turn 串行队列：发起者占用队列槽位执行中也不会死锁', async () => {
    // 场景：Host 串行 dispatch 了成员 A（占着 turn 队列）；A 执行中调 agent_message @ B。
    // 旧实现 recordPeerMessage → run → enqueueTurnExecution(同 turnId) 会排在 A 自己后面 → 自等待死锁。
    const innerExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'B answer' }))
    const outerExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => {
      // A 执行中发起对 B 的定向 @（同一 turnId），必须能在 A 结束前完成
      const { ctx: peerCtx } = makeCtx({
        discussionId: 'd1',
        roundIndex: 0,
        executeMember: innerExecute,
        currentDepth: 1,
      })
      const peer = await service.recordPeerMessage(
        {
          content: '@rust-coder quick question',
          senderAgentId: 'reviewer',
          targetAgentId: 'rust-coder',
          discussionId: 'd1',
          roundIndex: 0,
        },
        peerCtx,
      )
      expect(peer.ok).toBe(true)
      return { content: `A done (peer ok=${String(peer.ok)})` }
    })
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember: outerExecute })
    // Host 串行 dispatch A（parallel 缺省 false → 走 turn 队列）
    const reply = await service.run(
      { taskId: 't-outer', hostAgentId: 'code-agent', memberAgentId: 'reviewer', rootTurnId: 'turn-1', instruction: 'ask B then answer' },
      ctx,
    )
    expect(reply.state).toBe('completed')
    expect(outerExecute).toHaveBeenCalledTimes(1)
    expect(innerExecute).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('越权 target 拒绝：target 不在启用成员', async () => {
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0 })
    const res = await service.recordPeerMessage(
      { content: 'hi', senderAgentId: 'reviewer', targetAgentId: 'unknown', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('target_disabled')
    expect(discussionRepo.appendMessage).not.toHaveBeenCalled()
  })

  it('拒绝 self-@，避免成员给自己触发新一轮执行', async () => {
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0 })
    const res = await service.recordPeerMessage(
      { content: 'self loop', senderAgentId: 'reviewer', targetAgentId: 'reviewer', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('self_target_not_allowed')
    expect(discussionRepo.appendMessage).not.toHaveBeenCalled()
  })

  it('允许 A↔B 多轮往返对话，同对同轮达到往返上限（8 条）后才拦截', async () => {
    // 多轮互聊是合法形态（"你俩互相对话三轮"），旧的「立即回 ping 即拦」会掐死第一次回话。
    // 用大预算 service 隔离测 pair 上限：交替发满 8 条双向定向消息全部成功，第 9 条被拦。
    const bigBudget = new TeamDispatchService(makeRepo() as never, 30, discussionRepo as never, 30)
    const quietExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'ok（无 @，防 auto 干扰）' }))
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember: quietExecute })
    for (let i = 0; i < 8; i++) {
      const sender = i % 2 === 0 ? 'reviewer' : 'rust-coder'
      const target = i % 2 === 0 ? 'rust-coder' : 'reviewer'
      const res = await bigBudget.recordPeerMessage(
        { content: `round trip ${i}`, senderAgentId: sender, targetAgentId: target, discussionId: 'd1', roundIndex: 0 },
        ctx,
      )
      expect(res.ok).toBe(true)
    }
    const ninth = await bigBudget.recordPeerMessage(
      { content: 'one too many', senderAgentId: 'reviewer', targetAgentId: 'rust-coder', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
	    expect(ninth.ok).toBe(false)
	    if (!ninth.ok) expect(ninth.code).toBe('ping_pong_blocked')
	  })

	  it('note 不计入同对往返上限，但仍计入讨论消息总量', async () => {
	    const bigBudget = new TeamDispatchService(makeRepo() as never, 30, discussionRepo as never, 9)
	    const quietExecute = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'ok（无 @，防 auto 干扰）' }))
	    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember: quietExecute })
	    for (let i = 0; i < 8; i++) {
	      const sender = i % 2 === 0 ? 'reviewer' : 'rust-coder'
	      const target = i % 2 === 0 ? 'rust-coder' : 'reviewer'
	      const res = await bigBudget.recordPeerMessage(
	        { content: `round trip ${i}`, senderAgentId: sender, targetAgentId: target, discussionId: 'd1', roundIndex: 0 },
	        ctx,
	      )
	      expect(res.ok).toBe(true)
	    }
	    const note = await bigBudget.recordPeerMessage(
	      {
	        content: 'async FYI',
	        senderAgentId: 'reviewer',
	        targetAgentId: 'rust-coder',
	        delivery: 'note',
	        discussionId: 'd1',
	        roundIndex: 0,
	      },
	      ctx,
	    )
	    expect(note.ok).toBe(true)
	    const overTotal = await bigBudget.recordPeerMessage(
	      {
	        content: 'one message beyond total budget',
	        senderAgentId: 'reviewer',
	        targetAgentId: 'rust-coder',
	        delivery: 'note',
	        discussionId: 'd1',
	        roundIndex: 0,
	      },
	      ctx,
	    )
	    expect(overTotal.ok).toBe(false)
	    if (!overTotal.ok) expect(overTotal.code).toBe('message_budget_exceeded')
	  })

	  it('同步咨询深度达到 3 时拒绝第 4 层 call，并引导改用 note', async () => {
	    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, consultDepth: 3 })
	    const res = await service.recordPeerMessage(
	      {
	        content: 'ask one more teammate',
	        senderAgentId: 'reviewer',
	        targetAgentId: 'rust-coder',
	        discussionId: 'd1',
	        roundIndex: 0,
	      },
	      ctx,
	    )
	    expect(res.ok).toBe(false)
	    if (!res.ok) {
	      expect(res.code).toBe('consult_depth_exceeded')
	      expect(res.message).toContain('note')
	    }
	    expect(discussionRepo.appendMessage).not.toHaveBeenCalled()
	  })

	  it('deadline 剩余不足 30 秒时拒绝同步咨询，并引导改用 note', async () => {
	    const { ctx } = makeCtx({
	      discussionId: 'd1',
	      roundIndex: 0,
	      deadlineAt: Date.now() + 10_000,
	    })
	    const res = await service.recordPeerMessage(
	      {
	        content: 'quick sync?',
	        senderAgentId: 'reviewer',
	        targetAgentId: 'rust-coder',
	        discussionId: 'd1',
	        roundIndex: 0,
	      },
	      ctx,
	    )
	    expect(res.ok).toBe(false)
	    if (!res.ok) {
	      expect(res.code).toBe('deadline_insufficient')
	      expect(res.message).toContain('note')
	    }
	  })

	  it('peer call 独立预算不挤占 host dispatch 预算', async () => {
	    const budgeted = new TeamDispatchService(makeRepo() as never, 0, discussionRepo as never, 20, 2)
	    const executeMember = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'peer ok' }))
	    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0, executeMember })

	    const hostDispatch = await budgeted.run(makeTask('reviewer'), ctx)
	    expect(hostDispatch.state).toBe('failed')
	    expect(hostDispatch.error?.message).toContain('Dispatch budget exceeded')

	    const firstPeer = await budgeted.recordPeerMessage(
	      { content: 'peer 1', senderAgentId: 'reviewer', targetAgentId: 'rust-coder', discussionId: 'd1', roundIndex: 0 },
	      ctx,
	    )
	    const secondPeer = await budgeted.recordPeerMessage(
	      { content: 'peer 2', senderAgentId: 'reviewer', targetAgentId: 'rust-coder', discussionId: 'd1', roundIndex: 0 },
	      ctx,
	    )
	    const thirdPeer = await budgeted.recordPeerMessage(
	      { content: 'peer 3', senderAgentId: 'reviewer', targetAgentId: 'rust-coder', discussionId: 'd1', roundIndex: 0 },
	      ctx,
	    )
	    expect(firstPeer.ok).toBe(true)
	    expect(secondPeer.ok).toBe(true)
	    expect(thirdPeer.ok).toBe(true)
	    if (thirdPeer.ok) expect(thirdPeer.reply?.error?.message).toContain('Peer call budget exceeded')
	  })

  it('消息总量超限会跨 service 实例持续生效（持久化线程计数）', async () => {
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0 })
    for (let i = 0; i < 3; i++) {
      const r = await service.recordPeerMessage(
        { content: `msg ${i}`, senderAgentId: 'reviewer', discussionId: 'd1', roundIndex: 0 },
        ctx,
      )
      expect(r.ok).toBe(true)
    }
    const restarted = new TeamDispatchService(makeRepo() as never, 10, discussionRepo as never, 3)
    const over = await restarted.recordPeerMessage(
      { content: 'msg 3', senderAgentId: 'reviewer', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.code).toBe('message_budget_exceeded')
  })

  it('无 discussionRepo 时返回 no_discussion_repo（workflow 编排路径）', async () => {
    const svcNoRepo = new TeamDispatchService(makeRepo() as never)
    const { ctx } = makeCtx({ discussionId: 'd1', roundIndex: 0 })
    const res = await svcNoRepo.recordPeerMessage(
      { content: 'hi', senderAgentId: 'reviewer', discussionId: 'd1', roundIndex: 0 },
      ctx,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('no_discussion_repo')
  })

  it('与既有 dispatch 路径互不干扰：run 无 discussionId 时不写线程', async () => {
    const { ctx, events } = makeCtx() // 无 discussionId
    const reply = await service.run(makeTask('reviewer'), ctx)
    expect(reply.state).toBe('completed')
    expect(discussionRepo.appendMessage).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'team_dispatch_completed')).toBe(true)
  })
})
