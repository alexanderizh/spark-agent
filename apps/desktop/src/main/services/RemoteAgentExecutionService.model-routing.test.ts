import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileBridgeCatalog } from '@spark/protocol'
import {
  AgentRepository,
  RemoteAgentCollaborationRepository,
  SessionRepository,
  SparkDatabase,
  WorkspaceRepository,
} from '@spark/storage'
import type { SessionService } from '@spark/agent-runtime'
import { RemoteAgentExecutionService } from './RemoteAgentExecutionService.js'

const ACCOUNT_ID = 'account-1'
const PROJECT_ID = 'project-1'
const AGENT_ID = 'agent-1'
const SESSION_ID = 'remote-session-1'
const LINK_ID = 'c974e97d-2ad1-47c9-9c5e-07e886e68609'

const catalog: MobileBridgeCatalog = {
  agents: [
    {
      id: AGENT_ID,
      name: 'Remote Agent',
      description: '',
      agentAdapter: 'claude-sdk',
      providerProfileId: 'provider-old',
      modelId: 'model-old',
      isDefault: true,
    },
    {
      id: 'agent-other',
      name: 'Other Project Agent',
      description: '',
      agentAdapter: 'codex',
      isDefault: false,
    },
  ],
  workflows: [],
  providers: [
    {
      id: 'provider-new',
      name: 'Provider New',
      providerType: 'anthropic',
      isAutoRouter: false,
      models: [{ id: 'model-new', name: 'Model New' }],
    },
  ],
  permissionModes: {},
  reasoningEfforts: [],
}

describe('RemoteAgentExecutionService model routing', () => {
  let database: SparkDatabase | null = null
  let testDirectory: string | null = null
  let updateSession: ReturnType<typeof vi.fn>
  let queueState: { running: boolean; queuedTurns: unknown[] }
  let service: RemoteAgentExecutionService

  beforeEach(() => {
    testDirectory = mkdtempSync(path.join(tmpdir(), 'remote-agent-model-routing-'))
    const db = new SparkDatabase(path.join(testDirectory, 'test.db'))
    database = db
    db.runMigrations(path.join(process.cwd(), '..', '..', 'packages', 'storage', 'migrations'))

    new WorkspaceRepository(db).create({
      id: PROJECT_ID,
      name: 'Remote Project',
      rootPath: path.join(testDirectory, 'workspace'),
    })
    db.raw
      .prepare('UPDATE workspaces SET allowed_agent_ids_json = ? WHERE id = ?')
      .run(JSON.stringify([AGENT_ID]), PROJECT_ID)
    new AgentRepository(db).create({ id: AGENT_ID, name: 'Remote Agent' })
    new SessionRepository(db).create({
      id: SESSION_ID,
      kind: 'agent',
      title: 'Remote collaboration',
      status: 'idle',
      projectId: PROJECT_ID,
      providerProfileId: 'provider-old',
      modelId: 'model-old',
      agentId: AGENT_ID,
      agentAdapter: 'claude-sdk',
    })
    new SessionRepository(db).patchMetadata(SESSION_ID, { remoteAgentLinkId: LINK_ID })
    const links = new RemoteAgentCollaborationRepository(db)
    links.getOrCreateLink({
      accountUserId: ACCOUNT_ID,
      linkId: LINK_ID,
      sourceDeviceId: 'source-device',
      sourceSessionId: 'source-session',
      targetDeviceId: 'target-device',
      targetProjectId: PROJECT_ID,
      targetAgentId: AGENT_ID,
    })
    links.setRemoteSessionId(ACCOUNT_ID, LINK_ID, SESSION_ID)

    queueState = { running: false, queuedTurns: [] }
    updateSession = vi.fn(async () => ({}))
    const sessionService = {
      getQueueState: () => queueState,
    } as unknown as SessionService
    service = new RemoteAgentExecutionService({
      getDatabase: () => db,
      getSessionService: () => sessionService,
      getCatalog: async () => catalog,
      updateSession,
      deleteSession: async () => ({ deleted: true }),
      getAccountUserId: () => ACCOUNT_ID,
      getDeviceId: () => 'target-device',
      saveAttachments: async () => [],
      getEventsAfterSeq: async () => ({ events: [], nextSeq: 0 }),
      getPendingInteractions: async () => ({ approvals: [], questions: [] }),
      answerQuestion: async () => false,
      getQuestionSourceTurnId: () => null,
    })
  })

  afterEach(() => {
    database?.close()
    if (testDirectory != null) rmSync(testDirectory, { recursive: true, force: true })
    database = null
    testDirectory = null
  })

  it('returns the project-scoped safe model catalog', async () => {
    const response = await service.handleRelayRequest(
      'GET',
      `/v1/remote-agent/models?projectId=${PROJECT_ID}`,
      undefined,
    )

    expect(response).toMatchObject({
      status: 200,
      body: {
        agents: [{ id: AGENT_ID, agentAdapter: 'claude-sdk' }],
        providers: [{ id: 'provider-new', models: [{ id: 'model-new' }] }],
      },
    })
    expect(JSON.stringify(response.body)).not.toContain('keystoreRef')
  })

  it('changes the linked session model and rejects unlisted routes or busy sessions', async () => {
    const changed = await service.handleRelayRequest(
      'PATCH',
      `/v1/remote-agent/links/${LINK_ID}/model`,
      { providerProfileId: 'provider-new', modelId: 'model-new' },
    )
    expect(changed).toEqual({
      status: 200,
      body: { linkId: LINK_ID, providerProfileId: 'provider-new', modelId: 'model-new' },
    })
    expect(updateSession).toHaveBeenCalledWith(SESSION_ID, {
      providerProfileId: 'provider-new',
      modelId: 'model-new',
    })

    updateSession.mockClear()
    const invalid = await service.handleRelayRequest(
      'PATCH',
      `/v1/remote-agent/links/${LINK_ID}/model`,
      { providerProfileId: 'provider-new', modelId: 'not-listed' },
    )
    expect(invalid.status).toBe(400)
    expect(updateSession).not.toHaveBeenCalled()

    queueState = { running: true, queuedTurns: [] }
    const busy = await service.handleRelayRequest(
      'PATCH',
      `/v1/remote-agent/links/${LINK_ID}/model`,
      { providerProfileId: 'provider-new', modelId: 'model-new' },
    )
    expect(busy.status).toBe(409)
    expect(updateSession).not.toHaveBeenCalled()
  })
})
