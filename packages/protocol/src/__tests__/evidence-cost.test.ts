import { describe, expect, it } from 'vitest'
import { aggregateCost, EvidenceCostIpcSchemaRegistry } from '../evidence-cost.js'

describe('evidence-cost protocol', () => {
  it('keeps unknown cost totals unknown and aggregates by dimensions', () => {
    const events = [{ id: '1', sessionId: 's', roomId: 'r', discussionId: 'd', taskId: 't', agentId: 'a', dispatchId: null, tokens: 10, amount: null, currency: null, latencyMs: 20, status: 'unknown' as const, source: null, createdAt: '' }]
    expect(aggregateCost(events)).toEqual(expect.arrayContaining([expect.objectContaining({ dimension: 'task', key: 't', tokens: 10, amount: null, unknown: true })]))
  })
  it('requires stable opId and bounds lists', () => {
    const result = EvidenceCostIpcSchemaRegistry['evidence-cost:evidence:add'].safeParse({ sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'd', id: 'e', claim: 'c', links: [], source: { type: 'manual', ref: 'x' }, summary: 's' })
    expect(result.success).toBe(false)
  })
  it('requires discussion scope for reads', () => {
    expect(EvidenceCostIpcSchemaRegistry['evidence-cost:get'].safeParse({ sessionId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
    expect(EvidenceCostIpcSchemaRegistry['evidence-cost:get'].safeParse({ sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-1' }).success).toBe(true)
  })
})
