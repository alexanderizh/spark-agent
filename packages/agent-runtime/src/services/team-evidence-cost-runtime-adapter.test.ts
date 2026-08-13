import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SparkDatabase } from '@spark/storage'
import { TeamEvidenceCostRuntimeAdapter } from './team-evidence-cost-runtime-adapter.js'

describe('TeamEvidenceCostRuntimeAdapter', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-evidence-cost-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(fileURLToPath(new URL('../../../storage/migrations', import.meta.url)))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('binds scope to trusted context and rejects forged scope arguments', async () => {
    const adapter = new TeamEvidenceCostRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const definitions = adapter.buildToolDefinitions()
    expect(definitions.map((definition) => definition.name)).toEqual([
      'team_evidence_cost_read', 'team_evidence_add', 'team_cost_record_usage',
    ])
    for (const definition of definitions) {
      expect(definition.schema).not.toHaveProperty('sessionId')
      expect(definition.schema).not.toHaveProperty('roomId')
      expect(definition.schema).not.toHaveProperty('discussionId')
    }
    const add = definitions.find((definition) => definition.name === 'team_evidence_add')!
    const result = await add.handler({
      id: 'evidence-1', claim: 'Claim', source: { type: 'test', ref: 'test' }, summary: 'Summary',
      discussionId: 'forged-discussion',
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('forged-discussion')
  })

  it('supports agent evidence and actual usage while preserving unknown cost', async () => {
    const adapter = new TeamEvidenceCostRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const tool = (name: string) => adapter.buildToolDefinitions().find((definition) => definition.name === name)!
    const added = await tool('team_evidence_add').handler({
      id: 'evidence-1', claim: 'Build is green', links: [{ type: 'task', id: 'test-1' }],
      source: { type: 'test', ref: 'vitest:test-1' }, summary: 'Passed', opId: 'add-1',
    })
    expect(added.isError).not.toBe(true)
    const usage = await tool('team_cost_record_usage').handler({
      id: 'usage-1', taskId: 'task-1', status: 'unknown', tokens: null, amount: null, opId: 'usage-1',
    })
    expect(usage.isError).not.toBe(true)
    const read = await tool('team_evidence_cost_read').handler({})
    expect(read.isError).not.toBe(true)
    const snapshot = read.structuredContent as { evidence: unknown[]; costs: unknown[]; aggregates: unknown[]; budget: unknown }
    expect(snapshot.evidence).toEqual([expect.objectContaining({ id: 'evidence-1', status: 'unknown' })])
    expect(snapshot.costs).toEqual([expect.objectContaining({ id: 'usage-1', tokens: null, amount: null, status: 'unknown' })])
    expect(snapshot.aggregates).toEqual(expect.arrayContaining([expect.objectContaining({ dimension: 'task', key: 'task-1', tokens: null, amount: null, unknown: true })]))
    expect(snapshot.budget).toBeNull()
  })

  it('allows governance tools only for user/system and enforces CAS/idempotency', async () => {
    const agent = new TeamEvidenceCostRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    expect(agent.buildToolDefinitions().find((definition) => definition.name === 'team_evidence_verify')).toBeUndefined()
    const user = new TeamEvidenceCostRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'user-a', capability: 'user',
    })
    const tool = (name: string) => user.buildToolDefinitions().find((definition) => definition.name === name)!
    await tool('team_evidence_add').handler({
      id: 'evidence-1', claim: 'Claim', source: { type: 'manual', ref: 'user' }, summary: 'Summary', opId: 'add-1',
    })
    const verified = await tool('team_evidence_verify').handler({ id: 'evidence-1', expectedVersion: 1, opId: 'verify-1' })
    expect(verified.isError).not.toBe(true)
    expect(verified.structuredContent).toMatchObject({ status: 'verified', versionNumber: 2 })
    const stale = await tool('team_evidence_invalidate').handler({ id: 'evidence-1', expectedVersion: 1, reason: 'stale', opId: 'invalidate-1' })
    expect(stale.isError).toBe(true)
    const budget = await tool('team_cost_set_budget').handler({ expectedVersion: 0, tokens: 100, amount: 5, currency: 'USD', opId: 'budget-1' })
    expect(budget.isError).not.toBe(true)
    expect(budget.structuredContent).toMatchObject({ version: 1, tokens: 100 })
    expect(await tool('team_cost_set_budget').handler({ expectedVersion: 0, tokens: 100, amount: 5, currency: 'USD', opId: 'budget-1' })).toEqual(budget)
    expect((await tool('team_cost_set_budget').handler({ expectedVersion: 0, tokens: 200, opId: 'budget-1' })).isError).toBe(true)
  })

  it('rejects unknown fields and unbounded values before persistence', async () => {
    const adapter = new TeamEvidenceCostRuntimeAdapter(db, {
      sessionId: 'session-a', discussionId: 'discussion-a', actorId: 'agent-a', capability: 'agent',
    })
    const add = adapter.buildToolDefinitions().find((definition) => definition.name === 'team_evidence_add')!
    expect((await add.handler({ id: 'bad', claim: 'Claim', source: { type: 'manual', ref: 'x' }, summary: 'Summary', extra: true })).isError).toBe(true)
    expect((await add.handler({ id: 'bad', claim: 'x'.repeat(4_001), source: { type: 'manual', ref: 'x' }, summary: 'Summary' })).isError).toBe(true)
    expect((await add.handler({ id: 'bad', claim: 'Claim', source: { type: 'manual', ref: 'x' }, summary: 'Summary', links: Array.from({ length: 101 }, (_, index) => ({ type: 'claim', id: String(index) })) })).isError).toBe(true)
  })
})
