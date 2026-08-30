import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '@spark/storage'
import {
  buildTeamRuntimeToolDefinitions,
  cleanupTeamRuntimeState,
  createTeamRuntimeAdapters,
} from './team-runtime-tooling.js'

describe('team runtime tooling', () => {
  it('composes all five adapter definition groups in stable order', () => {
    const adapters = {
      taskGraph: {
        buildToolDefinitions: vi.fn(() => [
          { name: 'task', description: '', schema: {}, handler: vi.fn() },
        ]),
      },
      deliberation: {
        buildToolDefinitions: vi.fn(() => [
          { name: 'deliberation', description: '', schema: {}, handler: vi.fn() },
        ]),
      },
      evidenceCost: {
        buildToolDefinitions: vi.fn(() => [
          { name: 'evidence', description: '', schema: {}, handler: vi.fn() },
        ]),
      },
      replayPlaybook: {
        buildToolDefinitions: vi.fn(() => [
          { name: 'replay', description: '', schema: {}, handler: vi.fn() },
        ]),
      },
      p1: {
        buildToolDefinitions: vi.fn(() => [
          { name: 'p1', description: '', schema: {}, handler: vi.fn() },
        ]),
      },
    }

    expect(
      buildTeamRuntimeToolDefinitions(adapters as never).map((definition) => definition.name),
    ).toEqual(['task', 'deliberation', 'evidence', 'replay', 'p1'])
    expect(adapters.taskGraph.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.deliberation.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.evidenceCost.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.replayPlaybook.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.p1.buildToolDefinitions).toHaveBeenCalledOnce()
  })

  it('runs all six session cleanup operations exactly once', () => {
    const operations = {
      taskGraph: vi.fn(() => 1),
      deliberation: vi.fn(() => 2),
      evidenceCost: vi.fn(() => 3),
      replayPlaybook: vi.fn(() => 4),
      handoffs: vi.fn(() => 5),
      steeringGates: vi.fn(() => 6),
    }
    expect(cleanupTeamRuntimeState(operations)).toBe(21)
    for (const operation of Object.values(operations)) expect(operation).toHaveBeenCalledOnce()
  })
})

describe('team runtime tooling P1 registration', () => {
  let db: SparkDatabase
  let dir: string
  beforeEach(() => {
    dir = join(
      tmpdir(),
      `spark-team-runtime-p1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exposes handoff and steering gate tools for system-capability host turns', () => {
    const adapters = createTeamRuntimeAdapters(db, {
      sessionId: 'session-host',
      discussionId: 'discussion-host',
      actorId: 'host-agent-1',
      capability: 'system',
    })
    const names = buildTeamRuntimeToolDefinitions(adapters).map((definition) => definition.name)
    expect(names).toContain('team_p1_read')
    expect(names.filter((name) => name.startsWith('team_handoff_'))).toEqual([
      'team_handoff_create',
      'team_handoff_submit',
      'team_handoff_accept',
      'team_handoff_request_clarification',
      'team_handoff_reject',
      'team_handoff_complete',
      'team_handoff_cancel',
    ])
    expect(names.filter((name) => name.startsWith('team_steering_gate_'))).toEqual([
      'team_steering_gate_create',
      'team_steering_gate_approve',
      'team_steering_gate_revise',
      'team_steering_gate_stop',
      'team_steering_gate_expire',
    ])
  })

  it('bounds agent-capability member turns to handoff/gate read and create only', () => {
    const adapters = createTeamRuntimeAdapters(db, {
      sessionId: 'session-member',
      discussionId: 'discussion-member',
      actorId: 'member-agent-2',
      capability: 'agent',
    })
    const names = buildTeamRuntimeToolDefinitions(adapters).map((definition) => definition.name)
    expect(names).toContain('team_p1_read')
    expect(names.filter((name) => name.startsWith('team_handoff_'))).toEqual([
      'team_handoff_create',
    ])
    expect(names.filter((name) => name.startsWith('team_steering_gate_'))).toEqual([
      'team_steering_gate_create',
    ])
  })

  it('threads the caller session/discussion/actor scope into P1 tools', async () => {
    const adapters = createTeamRuntimeAdapters(db, {
      sessionId: 'session-x',
      discussionId: 'discussion-x',
      actorId: 'member-9',
      capability: 'agent',
    })
    const defs = buildTeamRuntimeToolDefinitions(adapters)
    const create = defs.find((definition) => definition.name === 'team_handoff_create')!
    const created = await create.handler({
      id: 'handoff-1',
      recipientId: 'member-10',
      purpose: 'Review draft',
      inputs: { file: 'a.ts' },
      expectedOutput: 'Review notes',
      acceptanceCriteria: ['no blocking issues'],
      sensitivity: 'internal',
    })
    expect(created.isError).not.toBe(true)
    // senderId/sessionId/discussionId 全部来自 createTeamRuntimeAdapters 的 context，
    // 证明 actor 与 scope 被透传而非硬编码。
    expect(created.structuredContent).toMatchObject({
      id: 'handoff-1',
      sessionId: 'session-x',
      discussionId: 'discussion-x',
      senderId: 'member-9',
      recipientId: 'member-10',
      status: 'draft',
    })
    const read = defs.find((definition) => definition.name === 'team_p1_read')!
    const readResult = await read.handler({})
    expect(readResult.isError).not.toBe(true)
    expect(readResult.structuredContent).toMatchObject({
      handoffs: [{ id: 'handoff-1', senderId: 'member-9' }],
    })
    expect(readResult.structuredContent?.gates).toEqual([])
  })
})
