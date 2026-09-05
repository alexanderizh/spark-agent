import { describe, expect, it } from 'vitest'

import type { ComputerUseEvent } from '@spark/protocol'

import { ComputerUsePipProjection } from './ComputerUsePipProjection.js'

const SESSIONS = [{ computerSessionId: 'cs_1', label: '我的桌面' }]

function makeProjection(): ComputerUsePipProjection {
  return new ComputerUsePipProjection({ sessions: { listLabeled: () => SESSIONS } })
}

function event(
  type: ComputerUseEvent['type'],
  extra: Record<string, unknown> = {},
): ComputerUseEvent {
  return {
    id: 'evt',
    sessionId: 'sess',
    turnId: 'turn',
    computerSessionId: 'cs_1',
    timestamp: '2026-09-05T00:00:00.000Z',
    seq: 1,
    type,
    ...extra,
  } as ComputerUseEvent
}

describe('ComputerUsePipProjection', () => {
  it('shows the labeled target once a session starts', () => {
    const projection = makeProjection()
    const state = projection.record(
      event('computer_session_started', { environment: 'my_desktop' }),
    )
    expect(state).toHaveLength(1)
    expect(state[0]?.label).toBe('我的桌面')
    expect(state[0]?.status).toBe('running')
  })

  it('carries the action summary while acting', () => {
    const projection = makeProjection()
    projection.record(event('computer_session_started', { environment: 'my_desktop' }))
    const state = projection.record(
      event('computer_action_requested', {
        actionId: 'a1',
        riskLevel: 'L1',
        summary: '点击 元素 [42]',
      }),
    )
    expect(state[0]?.status).toBe('acting')
    expect(state[0]?.lastSummary).toBe('点击 元素 [42]')
  })

  it('returns to running after an executed action keeps the summary', () => {
    const projection = makeProjection()
    projection.record(event('computer_session_started', { environment: 'my_desktop' }))
    projection.record(
      event('computer_action_requested', {
        actionId: 'a1',
        riskLevel: 'L1',
        summary: '输入 “comfyui”',
      }),
    )
    const state = projection.record(
      event('computer_action_executed', {
        actionId: 'a1',
        beforeFrameId: 'f0',
        afterFrameId: 'f1',
        summary: '输入 “comfyui”',
      }),
    )
    expect(state[0]?.status).toBe('running')
    expect(state[0]?.lastSummary).toBe('输入 “comfyui”')
  })

  it('marks awaiting approval', () => {
    const projection = makeProjection()
    projection.record(event('computer_session_started', { environment: 'my_desktop' }))
    const state = projection.record(
      event('computer_approval_requested', { approvalId: 'ap1', actionId: 'a1', riskLevel: 'L2' }),
    )
    expect(state[0]?.status).toBe('awaiting_approval')
  })

  it('retires a completed session from the panel', () => {
    const projection = makeProjection()
    projection.record(event('computer_session_started', { environment: 'my_desktop' }))
    const terminal = projection.record(event('computer_session_completed'))
    expect(terminal[0]?.status).toBe('completed')
    expect(projection.retire('cs_1')).toHaveLength(0)
  })

  it('prunes retirable sessions the label source forgot', () => {
    let sessions = [...SESSIONS]
    const projection = new ComputerUsePipProjection({
      sessions: { listLabeled: () => sessions },
    })
    projection.record(event('computer_session_started', { environment: 'my_desktop' }))
    projection.record(event('computer_session_completed'))
    sessions = []
    expect(projection.prune()).toHaveLength(0)
  })
})
