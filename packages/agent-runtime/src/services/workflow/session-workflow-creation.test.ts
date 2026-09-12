import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  AgentRepository,
  ProviderProfileRepository,
  SessionRepository,
  SettingsRepository,
  SparkDatabase,
  WorkflowRepository,
} from '@spark/storage'
import {
  assertSessionWorkflowBindingCreationReady,
  createSessionAndBindingAtomically,
} from './session-workflow-creation.js'

describe('session workflow binding creation', () => {
  let db: SparkDatabase

  beforeEach(() => {
    db = new SparkDatabase(':memory:')
    db.runMigrations(fileURLToPath(new URL('../../../../storage/migrations', import.meta.url)))
    new ProviderProfileRepository(db).create({
      id: 'provider-a',
      providerType: 'anthropic',
      name: 'Provider A',
      config: { defaultModel: 'model-a', modelIds: ['model-a'] },
      keystoreRef: 'provider-a-key',
      isDefault: true,
    })
    new AgentRepository(db).create({ id: 'agent-a', name: 'Agent A' })
    new SettingsRepository(db).set('sessionWorkflowBinding', 'writeEnabled', true)
  })

  afterEach(() => db.close())

  it('runs complete preflight before session creation', () => {
    new WorkflowRepository(db).create({
      id: 'workflow-invalid',
      name: 'Invalid',
      status: 'active',
      enabled: true,
      graph: {
        nodes: [
          {
            id: 'missing-agent-node',
            kind: 'agent',
            title: 'Missing agent',
            config: { agentId: 'missing-agent' },
          },
        ],
        edges: [],
      },
    })

    expect(() =>
      assertSessionWorkflowBindingCreationReady(db, {
        mode: 'override',
        workflowId: 'workflow-invalid',
      }),
    ).toThrow('挂载前检查')
    expect(countSessions(db)).toBe(0)
  })

  it('preflights an inherited workflow against the selected Host before creation', () => {
    new WorkflowRepository(db).create({
      id: 'workflow-host-disabled',
      name: 'Host Disabled',
      status: 'active',
      enabled: false,
      graph: { nodes: [], edges: [] },
    })
    new AgentRepository(db).update('agent-a', { workflowId: 'workflow-host-disabled' })

    expect(() =>
      assertSessionWorkflowBindingCreationReady(db, { mode: 'inherit' }, 'agent-a'),
    ).toThrow('挂载前检查')
    expect(countSessions(db)).toBe(0)
  })

  it('rolls back a created session when binding persistence fails', () => {
    const sessions = new SessionRepository(db)

    expect(() =>
      createSessionAndBindingAtomically({
        db,
        binding: { mode: 'inherit' },
        createSession: () =>
          sessions.create({
            id: 'session-a',
            kind: 'agent',
            title: 'A',
            status: 'idle',
            projectId: 'default',
            providerProfileId: 'provider-a',
            agentId: 'agent-a',
          }),
        applyMetadata: (created) => sessions.patchMetadata(created.id, { debugMode: true }),
        bindingRepository: {
          create: () => {
            throw new Error('injected binding write failure')
          },
        },
      }),
    ).toThrow('injected binding write failure')

    expect(sessions.get('session-a')).toBeNull()
  })
})

function countSessions(db: SparkDatabase): number {
  return (db.raw.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count
}
