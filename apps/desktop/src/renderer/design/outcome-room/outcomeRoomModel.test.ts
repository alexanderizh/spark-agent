import { describe, expect, it } from 'vitest'
import { displayLedgerValue, getLedgerActions, summarizeOutcomeRoom } from './outcomeRoomModel'
import type { OutcomeRoomRecord } from '@spark/protocol'

const base: OutcomeRoomRecord = {
  id: 'record-1',
  logicalKey: 'goal.acceptance',
  value: 'All focused tests pass',
  status: 'active',
  authority: 'system-observed',
  confidence: 1,
  sourceRefs: ['test:focused'],
  version: 1,
  updatedBy: 'host',
  updatedAt: '2026-08-12T12:00:00.000Z',
  expiresAt: null,
  reason: null,
}

describe('Outcome Room view model', () => {
  it('maps proposal and terminal states to explicit governance actions', () => {
    expect(getLedgerActions({ ...base, status: 'proposed' })).toEqual([
      'confirm',
      'reject',
      'correct',
      'invalidate',
    ])
    expect(getLedgerActions({ ...base, status: 'invalid' })).toEqual(['restore'])
    expect(getLedgerActions({ ...base, status: 'active' })).toEqual([
      'correct',
      'invalidate',
    ])
  })

  it('summarizes outcome health from proposals and invalid records without relying on color', () => {
    expect(
      summarizeOutcomeRoom([
        base,
        { ...base, id: 'proposal', logicalKey: 'risk.owner', status: 'proposed' },
        { ...base, id: 'invalid', logicalKey: 'fact.old', status: 'invalid' },
      ]),
    ).toEqual({
      activeCount: 1,
      proposalCount: 1,
      attentionCount: 2,
      health: 'at-risk',
      healthLabel: '需要关注',
    })
  })

  it('bounds display output for legacy oversized and cyclic values', () => {
    const cyclic: Record<string, unknown> = { source: 'legacy' }
    cyclic.self = cyclic
    const display = displayLedgerValue({ payload: 'x'.repeat(20_000), cyclic })
    expect(display.length).toBeLessThanOrEqual(1_200)
    expect(display).toContain('truncated')
  })
})
