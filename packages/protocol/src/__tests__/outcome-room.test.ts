import { describe, expect, it } from 'vitest'
import { boundedLedgerJson, inspectLedgerJson, OutcomeRoomIpcSchemaRegistry } from '../outcome-room.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('Outcome Room IPC contract', () => {
  it('accepts only a session-scoped snapshot request', () => {
    expect(OutcomeRoomIpcSchemaRegistry['outcome-room:get'].parse({ sessionId })).toEqual({
      sessionId,
    })
    expect(() =>
      OutcomeRoomIpcSchemaRegistry['outcome-room:get'].parse({
        sessionId,
        roomId: 'team-room:someone-else',
      }),
    ).toThrow()
  })

  it('requires a current version and rejects caller-controlled authority or discussion scope', () => {
    const schema = OutcomeRoomIpcSchemaRegistry['outcome-room:mutate']
    expect(
      schema.parse({
        sessionId,
        expectedDiscussionId: 'discussion-1',
        expectedRecordId: 'record-1',
        action: 'confirm',
        logicalKey: 'goal.acceptance',
        expectedVersion: 2,
      }),
    ).toEqual({
      sessionId,
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'record-1',
      action: 'confirm',
      logicalKey: 'goal.acceptance',
      expectedVersion: 2,
    })
    expect(() =>
      schema.parse({
        sessionId,
        discussionId: 'discussion-from-renderer',
        authority: 'system-observed',
        action: 'confirm',
        logicalKey: 'goal.acceptance',
        expectedVersion: 2,
      }),
    ).toThrow()
  })

  it('requires a replacement value for corrections', () => {
    const schema = OutcomeRoomIpcSchemaRegistry['outcome-room:mutate']
    expect(() =>
      schema.parse({
        sessionId,
        expectedDiscussionId: 'discussion-1',
        expectedRecordId: 'record-1',
        action: 'correct',
        logicalKey: 'goal.acceptance',
        expectedVersion: 2,
      }),
    ).toThrow()
  })

  it('rejects cyclic, deeply nested, and oversized correction values', () => {
    const schema = OutcomeRoomIpcSchemaRegistry['outcome-room:mutate']
    const base = { sessionId, expectedDiscussionId: 'd1', expectedRecordId: 'r1', action: 'correct' as const, logicalKey: 'goal', expectedVersion: 1 }
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = 'leaf'
    for (let index = 0; index < 12; index += 1) deep = { child: deep }
    expect(() => schema.parse({ ...base, value: cyclic })).toThrow()
    expect(() => schema.parse({ ...base, value: deep })).toThrow()
    expect(() => schema.parse({ ...base, value: 'x'.repeat(9_000) })).toThrow()
  })

  it('serializes legacy oversized or cyclic values within a fixed display budget', () => {
    const cyclic: Record<string, unknown> = { title: 'legacy' }
    cyclic.self = cyclic
    expect(inspectLedgerJson(cyclic)).toContain('cycles')
    const rendered = boundedLedgerJson({ payload: 'x'.repeat(20_000), cyclic }, 800)
    expect(rendered.length).toBeLessThanOrEqual(800)
    expect(rendered).toContain('truncated')
  })
})
