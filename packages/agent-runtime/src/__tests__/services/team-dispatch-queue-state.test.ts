import { describe, expect, it, vi } from 'vitest'
import { TeamDispatchService } from '../../services/team-dispatch.service.js'
import type { TeamDispatchRepository } from '@spark/storage'
import type { AgentEvent, TeamA2ATask, TeamModeConfig } from '@spark/protocol'

/**
 * 串行派发的 queued/working 状态语义（2026-09-12 修复）：
 *  - 入队时持久化 pending + emit pending，出队真正执行后才转 working——
 *    与超时计时器起点对齐，避免排队等待被误读为执行超时；
 *  - 同 turn 串行队列：后入队的任务在前一个结束前不执行；
 *  - peer call 剩余时间不足的提前返回路径就地收尾，不留僵尸行 / controller 泄漏。
 */

interface Member {
  id: string
  name: string
}

const members: Member[] = [
  { id: 'm1', name: '成员一' },
  { id: 'm2', name: '成员二' },
]

const teamConfig: TeamModeConfig = {
  enabled: true,
  hostAgentId: 'host',
  memberAgentIds: ['m1', 'm2'],
  maxDepth: 1,
  allowNesting: false,
}

function makeRepo() {
  return {
    create: vi.fn().mockReturnValue({ id: 'row' }),
    update: vi.fn().mockReturnValue(null),
    listBySession: vi.fn().mockReturnValue([]),
    listByTurn: vi.fn().mockReturnValue([]),
  }
}

function makeGate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const makeTask = (memberAgentId: string, taskId: string): TeamA2ATask => ({
  taskId,
  hostAgentId: 'host',
  memberAgentId,
  rootTurnId: 'turn-1',
  instruction: `task ${taskId}`,
})

const statusOf = (events: AgentEvent[]) =>
  events
    .filter(
      (e): e is Extract<AgentEvent, { type: 'team_member_status' }> =>
        e.type === 'team_member_status',
    )
    .map((e) => e.status)

describe('TeamDispatchService serial queue state', () => {
  it('marks serial dispatch as pending on enqueue and working only when dequeued', async () => {
    const repo = makeRepo()
    const service = new TeamDispatchService(repo as unknown as TeamDispatchRepository)
    const events: AgentEvent[] = []
    const gate = makeGate()
    const started = vi.fn()

    const replyPromise = service.run(makeTask('m1', 't1'), {
      sessionId: 's1',
      turnId: 'turn-1',
      hostAgentId: 'host',
      members,
      teamConfig,
      currentDepth: 0,
      emitEvent: (event) => events.push(event),
      executeMember: async () => {
        started()
        await gate.promise
        return { content: 'ok' }
      },
    })
    await tick()

    // 出队即执行：pending → working 的迁移发生在 executeMember 开始时
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ state: 'pending' }))
    expect(statusOf(events)).toEqual(['pending', 'working'])
    expect(repo.update).toHaveBeenCalledWith(expect.any(String), { state: 'working' })
    expect(started).toHaveBeenCalledTimes(1)

    gate.release()
    const reply = await replyPromise
    expect(reply.state).toBe('completed')
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'completed' }),
    )
  })

  it('serializes dispatches within one turn: the second waits for the first', async () => {
    const repo = makeRepo()
    const service = new TeamDispatchService(repo as unknown as TeamDispatchRepository)
    const startedOrder: string[] = []
    const gate1 = makeGate()

    const ctxBase = {
      sessionId: 's1',
      turnId: 'turn-1',
      hostAgentId: 'host',
      members,
      teamConfig,
      currentDepth: 0,
      emitEvent: () => {},
    }
    const first = service.run(makeTask('m1', 't1'), {
      ...ctxBase,
      executeMember: async () => {
        startedOrder.push('m1')
        await gate1.promise
        return { content: 'a' }
      },
    })
    await tick()

    const second = service.run(makeTask('m2', 't2'), {
      ...ctxBase,
      executeMember: async () => {
        startedOrder.push('m2')
        return { content: 'b' }
      },
    })
    await tick()

    // 第二个任务已持久化为 pending，但尚未执行（第一个还占着队列）
    expect(repo.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ state: 'pending' }))
    expect(startedOrder).toEqual(['m1'])

    gate1.release()
    expect((await first).state).toBe('completed')
    expect((await second).state).toBe('completed')
    expect(startedOrder).toEqual(['m1', 'm2'])
  })

  it('finalizes the dispatch row when a peer call has insufficient deadline remaining', async () => {
    const repo = makeRepo()
    const service = new TeamDispatchService(repo as unknown as TeamDispatchRepository)

    const reply = await service.run(
      makeTask('m2', 't1'),
      {
        sessionId: 's1',
        turnId: 'turn-1',
        hostAgentId: 'host',
        members,
        teamConfig,
        currentDepth: 0,
        emitEvent: () => {},
        countAsPeerCall: true,
        deadlineAt: Date.now() - 1_000,
        executeMember: async () => {
          throw new Error('should not execute')
        },
      },
      { parallel: true },
    )

    expect(reply.state).toBe('failed')
    expect(reply.error?.code).toBe('timeout')
    expect(repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        state: 'failed',
        endedAt: expect.any(String),
        errorMessage: expect.stringContaining('Not enough time remains'),
      }),
    )
    // 提前返回路径不能泄漏 controller 注册（否则会话级取消/活动判断被脏数据干扰）
    expect(service.hasActiveDispatches('s1')).toBe(false)
  })
})
