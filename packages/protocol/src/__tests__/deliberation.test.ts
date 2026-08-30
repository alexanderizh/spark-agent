import { describe, expect, it } from 'vitest'
import { DeliberationIpcSchemaRegistry, assertDeliberationJson } from '../deliberation.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('Deliberation protocol contract', () => {
  it('keeps IPC scope trusted and validates the full structured flow', () => {
    const result = DeliberationIpcSchemaRegistry['deliberation:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', id: 'deliberation-1', opId: 'deliberation:create-1', action: 'create',
      topic: 'Ship the new runtime', proposal: { claim: 'Ship now', position: 'support', rationale: 'Evidence is ready' },
    })
    expect(result.action).toBe('create')
    expect(() => DeliberationIpcSchemaRegistry['deliberation:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', id: 'deliberation-1', opId: 'deliberation:resolve-1', action: 'resolve',
      conflictingRecordId: 'other', reason: 'merge', roomId: 'forged', capability: 'user',
    })).toThrow()
  })

  it('rejects missing decision reasons and unbounded content', () => {
    expect(() => DeliberationIpcSchemaRegistry['deliberation:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', id: 'deliberation-1', opId: 'deliberation:decide-1', action: 'decide',
      expectedRecordId: 'record-1', expectedVersion: 1,
      decision: { outcome: 'approved', reason: '', ledgerWrite: null },
    })).toThrow()
    expect(() => DeliberationIpcSchemaRegistry['deliberation:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', id: 'deliberation-1', opId: 'deliberation:create-2', action: 'create',
      topic: 'x'.repeat(4_001), proposal: { claim: 'claim', position: 'support', rationale: 'reason' },
    })).toThrow()
  })

  it('bounds arbitrary ledger values and cycles', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => assertDeliberationJson(cycle)).toThrow(/cycles/i)
    expect(() => assertDeliberationJson({ value: 'x'.repeat(12_001) })).toThrow(/byte/i)
  })
})
