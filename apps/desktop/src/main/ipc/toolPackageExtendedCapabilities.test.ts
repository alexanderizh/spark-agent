import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaTaskRuntimeService, SessionService } from '@spark/agent-runtime'
import {
  SparkDatabase,
  SessionRepository,
  AgentRepository,
  WorkflowRepository,
} from '@spark/storage'
import type { ComputerUseAgentController } from '../services/computer-use/ComputerUseAgentController.js'
import { createDesktopToolPackageCapabilities } from './toolPackageExtendedCapabilities.js'

describe('desktop Tool Package extended capabilities', () => {
  let root = ''
  let db: SparkDatabase

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-tool-package-extended-'))
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('persists workflow ownership and rejects status reads from another package', async () => {
    const sessions = new SessionRepository(db)
    sessions.create({
      id: 'session-owned',
      kind: 'agent',
      title: 'Owned workflow',
      status: 'idle',
      projectId: 'default',
    })
    sessions.patchMetadata('session-owned', {
      toolPackageWorkflowOwner: { packageId: 'acme.owner', packageVersion: '1.0.0' },
    })
    const capabilities = createDesktopToolPackageCapabilities({
      db,
      sessionService: {} as SessionService,
      computerController: {} as ComputerUseAgentController,
      resolveMediaProviders: vi.fn(async () => []),
      mediaTaskRuntime: {} as MediaTaskRuntimeService,
      defaultMediaOutputDir: root,
      assertMediaInputPath: vi.fn(),
    })
    const status = capabilities.getWorkflowStatus
    if (status == null) throw new Error('Expected workflows.status desktop adapter')
    const context = {
      packageId: 'acme.owner',
      packageVersion: '1.0.0',
      toolName: 'run',
      invocationId: 'invocation-1',
    }

    await expect(status(context, { sessionId: 'session-owned' })).resolves.toEqual({
      sessionId: 'session-owned',
      run: null,
    })
    await expect(
      status({ ...context, packageId: 'acme.other' }, { sessionId: 'session-owned' }),
    ).rejects.toThrow(/did not start/)
    await expect(
      status({ ...context, packageVersion: '2.0.0' }, { sessionId: 'session-owned' }),
    ).rejects.toThrow(/did not start/)
    await expect(status(context, { sessionId: 'session-unowned' })).rejects.toThrow(/did not start/)
  })

  it('deletes the created session when the workflow turn fails to start', async () => {
    new WorkflowRepository(db).create({
      id: 'wf-leak',
      name: 'Leak demo',
      scope: 'user',
      status: 'active',
      enabled: true,
    })
    new AgentRepository(db).create({
      id: 'agent-leak',
      name: 'Leak agent',
      workflowId: 'wf-leak',
      providerProfileId: 'provider-1',
    })
    const createSession = vi.fn(async () => ({ sessionId: 'session-leaked' }))
    const sendTurn = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    const deleteSession = vi.fn(async () => ({ deleted: true }))
    const capabilities = createDesktopToolPackageCapabilities({
      db,
      sessionService: {
        createSession,
        sendTurn,
        deleteSession,
      } as unknown as SessionService,
      computerController: {} as ComputerUseAgentController,
      resolveMediaProviders: vi.fn(async () => []),
      mediaTaskRuntime: {} as MediaTaskRuntimeService,
      defaultMediaOutputDir: root,
      assertMediaInputPath: vi.fn(),
    })
    const run = capabilities.runWorkflow
    if (run == null) throw new Error('Expected workflows.run desktop adapter')
    const context = {
      packageId: 'acme.owner',
      packageVersion: '1.0.0',
      toolName: 'run',
      invocationId: 'invocation-1',
    }

    await expect(
      run(context, { workflowId: 'wf-leak', objective: 'run the demo' }),
    ).rejects.toThrow('provider unavailable')
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(deleteSession).toHaveBeenCalledWith('session-leaked')
  })
})
