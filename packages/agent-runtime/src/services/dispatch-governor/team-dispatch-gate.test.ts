/**
 * TeamDispatchService × DispatchGovernor 集成测试（M0 咽喉点闸门）。
 *
 * 覆盖：不传 governor 行为不变（直通）、gate 拒绝路径就地收尾（无僵尸
 * pending/working 行 + completed 事件 + controllers 清理）、排队期间行保持
 * pending（串行路径）、permit 在 finally 归还、peer call 走嵌套池。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TeamDispatchService } from '../team-dispatch.service.js'
import type { TeamDispatchRunContext, TeamMemberExecutionResult } from '../team-dispatch.service.js'
import { DispatchGovernor } from './dispatch-governor.js'
import type { AgentEvent, TeamA2ATask, TeamModeConfig } from '@spark/protocol'

type Member = { id: string; name: string }

function makeRepo() {
  return {
    create: vi.fn(),
    update: vi.fn(),
  }
}

function makeTask(): TeamA2ATask {
  return {
    taskId: 't1',
    hostAgentId: 'code-agent',
    memberAgentId: 'reviewer',
    rootTurnId: 'turn-1',
    instruction: 'review this code',
  }
}

function makeCtx(overrides: Partial<TeamDispatchRunContext<Member>> = {}): {
  ctx: TeamDispatchRunContext<Member>
  events: AgentEvent[]
} {
  const events: AgentEvent[] = []
  const teamConfig: TeamModeConfig = {
    enabled: true,
    hostAgentId: 'code-agent',
    memberAgentIds: ['reviewer', 'rust-coder'],
    maxDepth: 2,
    allowNesting: true,
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
    dispatchSource: 'host',
    emitEvent: (e) => events.push(e),
    executeMember: async (): Promise<TeamMemberExecutionResult> => ({ content: 'ok' }),
    ...overrides,
  }
  return { ctx, events }
}

function makeGovernorService(
  repo: ReturnType<typeof makeRepo>,
  inflight = 0,
  config?: Record<string, unknown>,
) {
  const governor = new DispatchGovernor({
    getHostInflightCount: () => inflight,
    ...(config != null ? { config } : {}),
  })
  const service = new TeamDispatchService(
    repo as never,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      governor,
    },
  )
  return { governor, service }
}

describe('TeamDispatchService 并发闸门集成', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
  })

  it('governor 满载排队：串行派发行保持 pending，拿到 permit 后转 working', async () => {
    const repo = makeRepo()
    const { governor, service } = makeGovernorService(repo, 0, { maxMemberDispatches: 1 })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const { ctx } = makeCtx({
      executeMember: async () => {
        await firstGate
        return { content: 'done' }
      },
    })
    // 第一路占满（挂起直到放行）
    const first = service.run(makeTask(), ctx, { parallel: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(governor.diagnostics().mainInUse).toBe(1)
    // 第二路并行派发：进入闸门排队（行已建但成员不执行）
    let secondMemberStarted = false
    const ctx2 = makeCtx({
      executeMember: async () => {
        secondMemberStarted = true
        return { content: 'done2' }
      },
    }).ctx
    const second = service.run({ ...makeTask(), taskId: 't2' }, ctx2, { parallel: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(secondMemberStarted).toBe(false)
    // 完成第一路 → permit 归还 → 第二路被唤醒执行
    releaseFirst()
    const reply = await second
    expect(reply.state).toBe('completed')
    expect(secondMemberStarted).toBe(true)
    await first
    expect(governor.diagnostics().mainInUse).toBe(0)
  })

  it('gate 超时拒绝：就地收尾行（无僵尸 pending）+ completed 事件 + error 可行动', async () => {
    const repo = makeRepo()
    const { service } = makeGovernorService(repo, 0, { maxMemberDispatches: 1 })
    const blockFirst: Promise<void> = new Promise(() => {})
    const { ctx } = makeCtx({
      executeMember: async () => {
        await blockFirst
        return { content: 'never' }
      },
    })
    const events: AgentEvent[] = []
    const ctxWaiting = makeCtx({
      emitEvent: (e) => events.push(e),
    }).ctx
    void service.run(makeTask(), ctx, { parallel: true })
    await vi.advanceTimersByTimeAsync(0)
    const rejected = service.run({ ...makeTask(), taskId: 't2' }, ctxWaiting, { parallel: true })
    const expectation = expect(rejected).resolves.toSatisfy((reply) => {
      expect(reply.state).toBe('failed')
      expect(reply.error?.code).toBe('internal')
      expect(reply.error?.message).toMatch(/Reduce parallelism/)
      return true
    })
    await vi.advanceTimersByTimeAsync(120_000)
    await expectation
    // 收尾断言：dispatch 行已落终态 + endedAt（不产生僵尸行），completed 事件已 emit
    const finalizeCall = (repo.update as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, patch]) => patch && typeof patch === 'object' && 'endedAt' in patch,
    )
    expect(finalizeCall).toBeDefined()
    const finalizePatch = finalizeCall?.[1] as Record<string, unknown> | undefined
    expect(finalizePatch).toMatchObject({
      state: 'failed',
      errorMessage: expect.stringContaining('Reduce parallelism') as unknown,
    })
    expect(events.some((e) => e.type === 'team_dispatch_completed')).toBe(true)
  })

  it('等待 permit 期间会话取消：返回 canceled 并收尾行', async () => {
    const repo = makeRepo()
    const { service } = makeGovernorService(repo, 0, { maxMemberDispatches: 1 })
    const hanging = new Promise<TeamMemberExecutionResult>(() => {})
    const { ctx: holderCtx } = makeCtx({ executeMember: () => hanging })
    const controller = new AbortController()
    const { ctx: waitingCtx } = makeCtx({ signal: controller.signal })
    void service.run(makeTask(), holderCtx, { parallel: true })
    await vi.advanceTimersByTimeAsync(0)
    const waiting = service.run({ ...makeTask(), taskId: 't2' }, waitingCtx, { parallel: true })
    const expectation = expect(waiting).resolves.toSatisfy((reply) => {
      expect(reply.state).toBe('canceled')
      expect(reply.error?.code).toBe('denied')
      return true
    })
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
    const finalizeCall = (repo.update as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, patch]) =>
        patch && typeof patch === 'object' && 'endedAt' in patch && patch.state === 'canceled',
    )
    expect(finalizeCall).toBeDefined()
  })

  it('peer call（countAsPeerCall）走嵌套池：主池满时不排队等主池', async () => {
    const repo = makeRepo()
    const { governor, service } = makeGovernorService(repo, 0, { maxMemberDispatches: 1 })
    const hanging = new Promise<TeamMemberExecutionResult>(() => {})
    const { ctx: holderCtx } = makeCtx({ executeMember: () => hanging })
    void service.run(makeTask(), holderCtx, { parallel: true })
    await vi.advanceTimersByTimeAsync(0)
    // 同步 peer call：主池满，但应立即获得嵌套池 permit 并执行
    let peerExecuted = false
    const { ctx: peerCtx } = makeCtx({
      countAsPeerCall: true,
      dispatchSource: 'peer-call',
      executeMember: async () => {
        peerExecuted = true
        return { content: 'peer answer' }
      },
    })
    const peer = service.run({ ...makeTask(), taskId: 't-peer' }, peerCtx, { parallel: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(peerExecuted).toBe(true)
    const reply = await peer
    expect(reply.state).toBe('completed')
    expect(governor.diagnostics().nestedInUse).toBe(0)
  })

  it('不传 governor：行为不变（无闸门等待，全量并发直通）', async () => {
    const repo = makeRepo()
    const service = new TeamDispatchService(repo as never)
    const execution = vi.fn(async (): Promise<TeamMemberExecutionResult> => ({ content: 'ok' }))
    const { ctx } = makeCtx({ executeMember: execution })
    const runs = Array.from({ length: 10 }, (_, i) =>
      service.run({ ...makeTask(), taskId: `t${i}` }, ctx, { parallel: true }),
    )
    const replies = await Promise.all(runs)
    expect(replies.every((r) => r.state === 'completed')).toBe(true)
    expect(execution).toHaveBeenCalledTimes(10)
  })

  it('peer call 截止期不足早退：permit 必须释放（嵌套池容量不损失）', async () => {
    const repo = makeRepo()
    const { governor, service } = makeGovernorService(repo, 0, { nestedDispatchSlots: 1 })
    // 剩余时间 < PEER_CALL_DEADLINE_BUFFER_MS（30s）→ runMember 在 try/finally
    // 覆盖范围之前早退；该路径曾漏 permit.release() 导致嵌套池容量永久损失。
    const { ctx: expiredCtx } = makeCtx({
      countAsPeerCall: true,
      dispatchSource: 'peer-call',
      deadlineAt: Date.now() + 5_000,
      executeMember: async () => {
        throw new Error('must not execute')
      },
    })
    const rejected = await service.run({ ...makeTask(), taskId: 't-expired' }, expiredCtx, {
      parallel: true,
    })
    expect(rejected.state).toBe('failed')
    expect(rejected.error?.code).toBe('timeout')
    // 回归核心断言：早退后嵌套池必须归零（修复前 nestedInUse 残留 1）。
    expect(governor.diagnostics().nestedInUse).toBe(0)
    // 后续正常 peer call 仍可立即获得嵌套池 permit（容量未损失）。
    let executed = false
    const { ctx: healthyCtx } = makeCtx({
      countAsPeerCall: true,
      dispatchSource: 'peer-call',
      deadlineAt: Date.now() + 120_000,
      executeMember: async () => {
        executed = true
        return { content: 'peer ok' }
      },
    })
    const reply = await service.run({ ...makeTask(), taskId: 't-healthy' }, healthyCtx, {
      parallel: true,
    })
    expect(reply.state).toBe('completed')
    expect(executed).toBe(true)
    expect(governor.diagnostics().nestedInUse).toBe(0)
  })
})
