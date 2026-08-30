/**
 * MessageBuilder 目标模式迭代分割线测试
 *
 * 验证 iteration_start / iteration_result 型 goal_progress 如何归约为
 * goal_iteration_divider UIBlock，以及目标终态事件（completed/failed/budget_stopped/cleared）
 * 对分割线的回填与收敛；老事件（无 progressKind）按 summary 前缀回退识别。
 */
import { describe, expect, it } from 'vitest'
import type { AgentEvent, GoalEvent } from '@spark/protocol'
import { MessageBuilder } from '../design/services/event-mapper'
import type { UIBlock } from '../design/services/event-mapper'

let seq = 0
function goalEvent(patch: Partial<GoalEvent> & Pick<GoalEvent, 'type'>): GoalEvent {
  return {
    id: `evt-${seq++}`,
    sessionId: 'session-1',
    turnId: `turn-${seq}`,
    timestamp: '2026-08-17T00:00:00.000Z',
    seq: 0,
    goalId: 'goal-1',
    objective: 'fix the flaky test',
    status: 'active',
    iteration: 1,
    summary: '',
    ...patch,
  } as GoalEvent
}

function findDividers(
  builder: MessageBuilder,
): Array<Extract<UIBlock, { kind: 'goal_iteration_divider' }>> {
  const blocks: Array<Extract<UIBlock, { kind: 'goal_iteration_divider' }>> = []
  for (const msg of builder.getAllMessages()) {
    for (const block of msg.blocks) {
      if (block.kind === 'goal_iteration_divider') {
        blocks.push(block as Extract<UIBlock, { kind: 'goal_iteration_divider' }>)
      }
    }
  }
  return blocks
}

describe('MessageBuilder · Goal iteration divider', () => {
  it('iteration_start goal_progress 落 running 态分割线（含 iteration/maxIterations/phase）', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: 'Started iteration 2',
        phase: 'review',
        progressKind: 'iteration_start',
        budget: { maxIterations: 20 },
      }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]).toMatchObject({
      goalId: 'goal-1',
      iteration: 2,
      maxIterations: 20,
      phase: 'review',
      state: 'running',
    })
    // 独立小消息只含分割线块：直接置 completed，不能永久停在 streaming
    const msg = b
      .getAllMessages()
      .find((m) => m.blocks.some((x) => x.kind === 'goal_iteration_divider'))
    expect(msg?.status).toBe('completed')
  })

  it('iteration_result 按 goalId + iteration 回填小结并置 result 态', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 1,
        summary: 'Started iteration 1',
        progressKind: 'iteration_start',
        budget: { maxIterations: 12 },
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 1,
        summary: '实现已通过单测/tsc，剩余手工验证',
        nextStep: 'run eslint',
        phase: 'validate',
        progressKind: 'iteration_result',
      }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]).toMatchObject({
      state: 'result',
      phase: 'validate',
      resultSummary: '实现已通过单测/tsc，剩余手工验证',
      resultNextStep: 'run eslint',
    })
  })

  it('goal_completed 把最后一条分割线置 completed 终态', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 3,
        summary: 'Started iteration 3',
        progressKind: 'iteration_start',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({ type: 'goal_completed', status: 'completed', summary: 'done' }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.state).toBe('completed')
  })

  it('goal_budget_stopped 置终态并把停止原因回填到 running 分割线', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 5,
        summary: 'Started iteration 5',
        progressKind: 'iteration_start',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({
        type: 'goal_budget_stopped',
        status: 'stopped_by_budget',
        summary: '达到最大迭代次数 5',
      }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.state).toBe('stopped_by_budget')
    expect(dividers[0]?.resultSummary).toBe('达到最大迭代次数 5')
  })

  it('goal_cleared 把悬挂的 running 分割线收敛为 result，不再旋转', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: 'Started iteration 2',
        progressKind: 'iteration_start',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({ type: 'goal_cleared', status: 'cleared', summary: 'Goal cleared' }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.state).toBe('result')
    expect(dividers[0]?.resultSummary).toBeUndefined()
  })

  it('老事件（无 progressKind）按 Started iteration 前缀回退：start 落块、轮末回填', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 1,
        summary: 'Started iteration 1',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 1,
        summary: '第一轮完成：定位到根因',
        nextStep: '修复并补测试',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: 'Started iteration 2',
      }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(2)
    expect(dividers[0]).toMatchObject({
      iteration: 1,
      state: 'result',
      resultSummary: '第一轮完成：定位到根因',
    })
    expect(dividers[1]).toMatchObject({ iteration: 2, state: 'running' })
  })

  it('resume 重跑同轮复用分割线：重置 running 并清掉上一轮残留小结', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: 'Started iteration 2',
        progressKind: 'iteration_start',
      }) as AgentEvent,
    )
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: '中途被暂停的一轮',
        progressKind: 'iteration_result',
      }) as AgentEvent,
    )
    // resume 后重跑第 2 轮
    b.processEvent(
      goalEvent({
        type: 'goal_progress',
        iteration: 2,
        summary: 'Started iteration 2',
        progressKind: 'iteration_start',
      }) as AgentEvent,
    )

    const dividers = findDividers(b)
    expect(dividers).toHaveLength(1)
    expect(dividers[0]?.state).toBe('running')
    expect(dividers[0]?.resultSummary).toBeUndefined()
  })

  it('goal_started / goal_resumed 不落分割线（首轮由紧随的 iteration_start 落块）', () => {
    const b = new MessageBuilder()
    b.processEvent(
      goalEvent({
        type: 'goal_started',
        summary: 'Goal started',
        budget: { maxIterations: 12 },
      }) as AgentEvent,
    )
    b.processEvent(goalEvent({ type: 'goal_resumed', summary: 'Goal resumed' }) as AgentEvent)

    expect(findDividers(b)).toHaveLength(0)
  })
})
