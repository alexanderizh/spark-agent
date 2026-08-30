import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SparkDatabase } from '@spark/storage'
import { TeamDeliberationRuntimeAdapter } from './team-deliberation-runtime-adapter.js'

describe('TeamDeliberationRuntimeAdapter', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-deliberation-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(fileURLToPath(new URL('../../../storage/migrations', import.meta.url)))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('derives scope from trusted context and rejects forged scope arguments', async () => {
    const adapter = new TeamDeliberationRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const defs = adapter.buildToolDefinitions()
    for (const definition of defs) {
      expect(definition.schema).not.toHaveProperty('sessionId')
      expect(definition.schema).not.toHaveProperty('discussionId')
      expect(definition.schema).not.toHaveProperty('roomId')
    }
    const create = defs.find((definition) => definition.name === 'team_deliberation_propose')!
    const result = await create.handler({
      id: 'proposal-a', topic: 'Release',
      proposal: { claim: 'Ship', position: 'support', rationale: 'Ready' },
      discussionId: 'forged-discussion',
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('forged-discussion')
  })

  it('exposes the full deliberation tool slice and restricts governance from agents', async () => {
    const agent = new TeamDeliberationRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    expect(agent.buildToolDefinitions().map((definition) => definition.name)).toEqual([
      'team_deliberation_read', 'team_deliberation_propose', 'team_deliberation_add_evidence',
      'team_deliberation_add_alternative', 'team_deliberation_add_risk', 'team_deliberation_vote',
    ])

    const user = new TeamDeliberationRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'user-a', capability: 'user',
    })
    expect(user.buildToolDefinitions().map((definition) => definition.name)).toEqual([
      'team_deliberation_read', 'team_deliberation_propose', 'team_deliberation_add_evidence',
      'team_deliberation_add_alternative', 'team_deliberation_add_risk', 'team_deliberation_vote',
      'team_deliberation_decide', 'team_deliberation_resolve',
    ])
  })

  it('supports proposal chain, vote evidence, CAS, idempotency, and ledger callback', async () => {
    const writes: unknown[] = []
    const adapter = new TeamDeliberationRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'user-a', capability: 'user',
      ledgerWriter: { write: (input) => { writes.push(input) } },
    })
    const tool = (name: string) => adapter.buildToolDefinitions().find((definition) => definition.name === name)!
    const create = await tool('team_deliberation_propose').handler({
      id: 'proposal-a', topic: 'Release',
      proposal: { claim: 'Ship', position: 'support', rationale: 'Ready' }, opId: 'create-a',
    })
    expect(create.isError).not.toBe(true)
    const created = create.structuredContent as { version: number }
    const vote = await tool('team_deliberation_vote').handler({
      id: 'proposal-a', expectedVersion: created.version, vote: 'support', reason: 'CI is green', opId: 'vote-a',
    })
    expect(vote.isError).not.toBe(true)
    const voted = vote.structuredContent as { version: number }
    const sameVote = await tool('team_deliberation_vote').handler({
      id: 'proposal-a', expectedVersion: created.version, vote: 'support', reason: 'CI is green', opId: 'vote-a',
    })
    expect(sameVote).toEqual(vote)
    const decided = await tool('team_deliberation_decide').handler({
      id: 'proposal-a', expectedVersion: voted.version, decision: {
        outcome: 'approved', reason: 'Ship it', ledgerWrite: { logicalKey: 'release', value: { approved: true }, reason: 'decision' },
      }, opId: 'decide-a',
    })
    expect(decided.isError).not.toBe(true)
    expect(writes).toHaveLength(1)
    expect(JSON.stringify(writes[0])).toContain('proposal-a')

    const stale = await tool('team_deliberation_add_risk').handler({
      id: 'proposal-a', expectedVersion: voted.version, risk: { title: 'stale', severity: 'low', mitigation: 'retry' }, opId: 'stale-a',
    })
    expect(stale.isError).toBe(true)
    expect(JSON.stringify(stale)).toContain('Expected version')
  })

  it('rejects unsafe payloads before persistence and maps missing records to errors', async () => {
    const adapter = new TeamDeliberationRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const create = adapter.buildToolDefinitions().find((definition) => definition.name === 'team_deliberation_propose')!
    expect((await create.handler({ id: 'bad', topic: 'x', proposal: { claim: 'x', position: 'support', rationale: 'x' }, opId: 'x', extra: true })).isError).toBe(true)
    const evidence = adapter.buildToolDefinitions().find((definition) => definition.name === 'team_deliberation_add_evidence')!
    const missing = await evidence.handler({ id: 'missing', expectedVersion: 1, evidence: { summary: 'x', sourceRef: 's', polarity: 'supports' }, opId: 'missing' })
    expect(missing.isError).toBe(true)
  })
})
