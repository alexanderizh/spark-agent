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
