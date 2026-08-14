import { describe, expect, it } from 'vitest'
import { MessageBuilder } from './event-mapper'
import type { GoalEvent } from '@spark/protocol'

function goalEvent(patch: Partial<GoalEvent> & Pick<GoalEvent, 'id' | 'type'>): GoalEvent {
  return {
    goalId: 'goal-1',
    objective: 'Ship the goal',
    status: 'pending_contract',
    iteration: 0,
    summary: 'summary',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-08-14T00:00:00.000Z',
    seq: 1,
    ...patch,
  } as GoalEvent
}

describe('MessageBuilder goal contract gating', () => {
  it('renders an inline pending contract card on goal_contract_proposed', () => {
    const builder = new MessageBuilder()

    builder.processEvent(
      goalEvent({
        id: 'event-proposed',
        type: 'goal_contract_proposed',
        proposedContract: {
          successCriteria: ['tests pass'],
          constraints: ['no new deps'],
          validation: { commands: ['pnpm test'] },
        },
      }),
    )

    const block = builder.getAllMessages()[0]?.blocks.find((b) => b.kind === 'goal_contract')
    expect(block).toMatchObject({
      kind: 'goal_contract',
      goalId: 'goal-1',
      state: 'pending',
      contract: {
        successCriteria: ['tests pass'],
        constraints: ['no new deps'],
        validation: { commands: ['pnpm test'] },
      },
    })
    expect(builder.getActiveGoal()?.status).toBe('pending_contract')
    // 事件在起草 turn 收尾后发出（独立 turnId → 新建消息）：消息不能停在 streaming。
    const host = builder.getAllMessages().find((m) =>
      m.blocks.some((b) => b.kind === 'goal_contract'),
    )
    expect(host?.status).toBe('completed')
  })

  it('keeps drafting silent: no inline card, snapshot tracks pending_contract', () => {
    const builder = new MessageBuilder()

    builder.processEvent(goalEvent({ id: 'event-drafting', type: 'goal_contract_drafting' }))

    const blocks = builder.getAllMessages().flatMap((m) => m.blocks)
    expect(blocks.some((b) => b.kind === 'goal_contract')).toBe(false)
    expect(builder.getActiveGoal()?.status).toBe('pending_contract')
  })

  it('resolves the pending card to confirmed on goal_started and rejected on goal_cleared', () => {
    const proposed = goalEvent({
      id: 'event-proposed',
      type: 'goal_contract_proposed',
      proposedContract: {
        successCriteria: ['done'],
        constraints: [],
        validation: {},
      },
    })
    const confirmed = new MessageBuilder()
    confirmed.processEvent(proposed)
    confirmed.processEvent(
      goalEvent({ id: 'event-started', type: 'goal_started', status: 'active', seq: 2 }),
    )
    expect(
      confirmed.getAllMessages()[0]?.blocks.find((b) => b.kind === 'goal_contract'),
    ).toMatchObject({ state: 'confirmed' })

    const rejected = new MessageBuilder()
    rejected.processEvent(proposed)
    rejected.processEvent(
      goalEvent({ id: 'event-cleared', type: 'goal_cleared', status: 'cleared', seq: 2 }),
    )
    expect(
      rejected.getAllMessages()[0]?.blocks.find((b) => b.kind === 'goal_contract'),
    ).toMatchObject({ state: 'rejected' })
  })
})
