import { describe, expect, it } from 'vitest'

import { ComputerUseTimelineStore } from './ComputerUseTimelineStore.js'

function createStore(options?: { maxEventsPerSession?: number }) {
  let counter = 0
  return new ComputerUseTimelineStore({
    createId: () => `id-${counter++}`,
    now: () => new Date('2026-07-31T00:00:00Z'),
    ...(options?.maxEventsPerSession == null ? {} : { maxEventsPerSession: options.maxEventsPerSession }),
  })
}

function actionRequested(overrides: Partial<Parameters<ComputerUseTimelineStore['record']>[0]> = {}) {
  return {
    type: 'computer_action_requested' as const,
    sessionId: 'session-1',
    turnId: 'turn-1',
    computerSessionId: 'cs-1',
    actionId: 'action-1',
    riskLevel: 'L1' as const,
    ...overrides,
  }
}

describe('ComputerUseTimelineStore', () => {
  it('assigns monotonic seq per session and stable timestamp/id', () => {
    const store = createStore()
    const first = store.record(actionRequested())
    const second = store.record(actionRequested({ actionId: 'action-2' }))

    expect(first.seq).toBe(0)
    expect(second.seq).toBe(1)
    expect(first.id).toBe('id-0')
    expect(second.id).toBe('id-1')
    expect(first.timestamp).toBe('2026-07-31T00:00:00.000Z')
  })

  it('keeps seq counters independent per session', () => {
    const store = createStore()
    store.record(actionRequested({ computerSessionId: 'cs-1' }))
    store.record(actionRequested({ computerSessionId: 'cs-1' }))

    const other = store.record(actionRequested({ computerSessionId: 'cs-2' }))
    expect(other.seq).toBe(0)
  })

  it('paginates with afterSeq cursor and returns null nextSeq when exhausted', () => {
    const store = createStore()
    store.record(actionRequested({ actionId: 'a-1' }))
    store.record(actionRequested({ actionId: 'a-2' }))
    store.record(actionRequested({ actionId: 'a-3' }))

    const page1 = store.read('cs-1', undefined, 2)
    expect(page1.events.map((e) => e.actionId)).toEqual(['a-1', 'a-2'])
    expect(page1.nextSeq).toBe(1)

    const page2 = store.read('cs-1', page1.nextSeq!)
    expect(page2.events.map((e) => e.actionId)).toEqual(['a-3'])
    expect(page2.nextSeq).toBe(2)

    const page3 = store.read('cs-1', page2.nextSeq!)
    expect(page3.events).toEqual([])
    expect(page3.nextSeq).toBeNull()
  })

  it('returns empty timeline for an unknown session', () => {
    const store = createStore()
    expect(store.read('never')).toEqual({ events: [], nextSeq: null })
  })

  it('evicts the oldest events when the per-session cap is exceeded', () => {
    const store = createStore({ maxEventsPerSession: 2 })
    store.record(actionRequested({ actionId: 'a-1' }))
    store.record(actionRequested({ actionId: 'a-2' }))
    store.record(actionRequested({ actionId: 'a-3' }))

    const all = store.read('cs-1')
    expect(all.events.map((e) => e.actionId)).toEqual(['a-2', 'a-3'])
  })

  it('clears a single session without touching others', () => {
    const store = createStore()
    store.record(actionRequested({ computerSessionId: 'cs-1' }))
    store.record(actionRequested({ computerSessionId: 'cs-2' }))

    store.clearSession('cs-1')
    expect(store.read('cs-1')).toEqual({ events: [], nextSeq: null })
    expect(store.read('cs-2').events).toHaveLength(1)
  })
})
