import { describe, expect, it } from 'vitest'
import { ReplayIpcSchemaRegistry, REPLAY_SCHEMA_VERSION } from '../replay-playbook.js'

describe('replay-playbook protocol', () => {
  const base = { schemaVersion: REPLAY_SCHEMA_VERSION, sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-a', opId: 'op-1' }
  it('bounds timeline, fork and playbook requests', () => {
    expect(ReplayIpcSchemaRegistry['replay:timeline'].parse({ ...base, limit: 100 })).toMatchObject({ limit: 100 })
    expect(ReplayIpcSchemaRegistry['replay:fork'].parse({ ...base, branchId: 'branch-a', sourceSeq: 2, reason: 'compare' })).toMatchObject({ sourceSeq: 2 })
    expect(() => ReplayIpcSchemaRegistry['replay:timeline'].parse({ ...base, limit: 101 })).toThrow()
  })
  it('requires CAS and bounded JSON for playbook writes', () => {
    const parsed = ReplayIpcSchemaRegistry['playbook:mutate'].parse({ ...base, action: 'propose', id: 'pb-1', name: 'Ship', graph: {}, roles: {}, handoffRules: {}, gateRules: {}, deliberationRules: {} })
    expect(parsed.action).toBe('propose')
    expect(() => ReplayIpcSchemaRegistry['playbook:mutate'].parse({ ...base, action: 'publish', id: 'pb-1' })).toThrow()
  })
  it('rejects extra scope fields so callers cannot override trusted context', () => {
    expect(() => ReplayIpcSchemaRegistry['replay:timeline'].parse({ ...base, discussionId: 'other' })).toThrow()
  })
})
