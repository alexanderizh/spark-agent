import { describe, expect, it } from 'vitest'
import { TeamP1IpcSchemaRegistry, inspectTeamP1Json } from '../team-p1.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('Team P1 IPC contract', () => {
  it('requires a bounded retry-safe operation id', () => {
    const parsed = TeamP1IpcSchemaRegistry['team-p1:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'team-p1:retry-1', kind: 'gate', action: 'approve', id: 'gate-1', expectedVersion: 1,
    })
    expect(parsed.opId).toBe('team-p1:retry-1')
    expect(() => TeamP1IpcSchemaRegistry['team-p1:mutate'].parse({
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'x'.repeat(161), kind: 'gate', action: 'approve', id: 'gate-1', expectedVersion: 1,
    })).toThrow()
  })

  it('rejects cyclic, deeply nested, and oversized P1 JSON before parsing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(inspectTeamP1Json(cyclic)).toContain('cycles')
    let deep: unknown = 'leaf'
    for (let index = 0; index < 12; index += 1) deep = { child: deep }
    expect(inspectTeamP1Json(deep)).toContain('nesting')
    expect(inspectTeamP1Json('x'.repeat(20_000))).toContain('size')
  })
})
