// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutcomeRoomPanel } from './OutcomeRoomPanel'
import type { OutcomeRoomSnapshot, SessionId } from '@spark/protocol'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const snapshot: OutcomeRoomSnapshot = {
  sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
  discussion: {
    id: 'discussion-1',
    state: 'active',
    topic: 'Ship Outcome Room',
    roundIndex: 2,
    maxRounds: 6,
    startedAt: '2026-08-12T12:00:00.000Z',
    endedAt: null,
  },
  records: [
    {
      id: 'proposal-1',
      logicalKey: 'goal.acceptance',
      value: 'All tests pass',
      status: 'proposed',
      authority: 'agent-inferred',
      confidence: 0.8,
      sourceRefs: ['member:reviewer'],
      version: 2,
      updatedBy: 'reviewer',
      updatedAt: '2026-08-12T12:02:00.000Z',
      expiresAt: null,
      reason: null,
    },
  ],
  syncedAt: '2026-08-12T12:03:00.000Z',
}

describe('OutcomeRoomPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('renders a result-first overview and accessible proposal actions', () => {
    const mutate = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <OutcomeRoomPanel
          snapshot={snapshot}
          loading={false}
          error={null}
          runningMemberCount={2}
          mutatingKey={null}
          onRefresh={() => undefined}
          onMutate={mutate}
        />,
      )
    })

    expect(container.querySelector('[aria-label="团队成果作业间"]')).not.toBeNull()
    expect(container.textContent).toContain('Ship Outcome Room')
    const proposalMetric = Array.from(container.querySelectorAll('dl > div')).find(
      (element) => element.querySelector('dt')?.textContent === '待确认',
    )
    expect(proposalMetric?.querySelector('dd')?.textContent).toBe('1')
    expect(container.textContent).toContain('2 位成员运行中')
    const confirm = container.querySelector<HTMLButtonElement>('button[aria-label="确认 goal.acceptance"]')
    expect(confirm).not.toBeNull()
    act(() => confirm?.click())
    expect(mutate).toHaveBeenCalledWith({
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'proposal-1',
      action: 'confirm',
      logicalKey: 'goal.acceptance',
      expectedVersion: 2,
    })
  })

  it('renders loading, error, and empty states with a recovery action', () => {
    const refresh = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <OutcomeRoomPanel
          snapshot={null}
          loading
          error={null}
          runningMemberCount={0}
          mutatingKey={null}
          onRefresh={refresh}
          onMutate={() => undefined}
        />,
      )
    })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    act(() => {
      root?.render(
        <OutcomeRoomPanel
          snapshot={null}
          loading={false}
          error="同步失败"
          runningMemberCount={0}
          mutatingKey={null}
          onRefresh={refresh}
          onMutate={() => undefined}
        />,
      )
    })
    expect(
      container.querySelector('.outcome-room')?.getAttribute('data-outcome-room-layout'),
    ).toBe('responsive')
    expect(container.textContent).toContain('同步失败')
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="重新加载团队账本"]')
    act(() => retry?.click())
    expect(refresh).toHaveBeenCalledOnce()
  })
})
