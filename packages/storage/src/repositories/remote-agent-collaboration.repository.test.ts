import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import {
  RemoteAgentCollaborationConflictError,
  RemoteAgentCollaborationRepository,
} from './remote-agent-collaboration.repository.js'

const ACCOUNT = 'account-a'
const LINK = '11111111-1111-4111-8111-111111111111'
const OPERATION = '22222222-2222-4222-8222-222222222222'
const ARTIFACT = '33333333-3333-4333-8333-333333333333'
const FINGERPRINT = 'a'.repeat(64)

describe('RemoteAgentCollaborationRepository', () => {
  let db: SparkDatabase | null = null
  let repository: RemoteAgentCollaborationRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-remote-collaboration-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'collaboration.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repository = new RemoteAgentCollaborationRepository(db)
  })

  afterEach(() => {
    db?.close()
    db = null
    rmSync(testDir, { recursive: true, force: true })
  })

  it('scopes links by account and rejects an id rebound to another target', () => {
    const input = {
      accountUserId: ACCOUNT,
      linkId: LINK,
      sourceDeviceId: 'device-a',
      sourceSessionId: 'session-a',
      targetDeviceId: 'device-b',
      targetProjectId: 'project-b',
      targetAgentId: 'agent-b',
    }

    expect(repository.getOrCreateLink(input).created).toBe(true)
    expect(repository.getOrCreateLink(input).created).toBe(false)
    expect(repository.getLink('account-b', LINK)).toBeNull()
    expect(() => repository.getOrCreateLink({ ...input, targetDeviceId: 'device-c' })).toThrow(
      RemoteAgentCollaborationConflictError,
    )

    expect(repository.listLinks(ACCOUNT, 'session-a')).toHaveLength(1)
    expect(repository.listLinks(ACCOUNT, 'session-a', 'device-c')).toHaveLength(0)
  })

  it('reserves an operation idempotently and never resurrects a terminal operation', () => {
    repository.getOrCreateLink({
      accountUserId: ACCOUNT,
      linkId: LINK,
      sourceDeviceId: 'device-a',
      sourceSessionId: 'session-a',
      targetDeviceId: 'device-b',
      targetProjectId: 'project-b',
      targetAgentId: 'agent-b',
    })
    const first = repository.reserveOperation(ACCOUNT, OPERATION, LINK, FINGERPRINT)
    expect(first.created).toBe(true)
    expect(repository.reserveOperation(ACCOUNT, OPERATION, LINK, FINGERPRINT).created).toBe(false)
    expect(() => repository.reserveOperation(ACCOUNT, OPERATION, LINK, 'b'.repeat(64))).toThrow(
      RemoteAgentCollaborationConflictError,
    )

    repository.setOperationState(ACCOUNT, OPERATION, { status: 'cancelled', turnId: OPERATION })
    expect(repository.setOperationState(ACCOUNT, OPERATION, { status: 'running' }).status).toBe(
      'cancelled',
    )
  })

  it('persists a deduplicated source-session continuation receipt', () => {
    repository.getOrCreateLink({
      accountUserId: ACCOUNT,
      linkId: LINK,
      sourceDeviceId: 'device-a',
      sourceSessionId: 'session-a',
      targetDeviceId: 'device-b',
      targetProjectId: 'project-b',
      targetAgentId: 'agent-b',
    })
    repository.setRemoteSessionId(ACCOUNT, LINK, 'remote-session-b')
    repository.reserveOperation(ACCOUNT, OPERATION, LINK, FINGERPRINT)
    repository.setOperationState(ACCOUNT, OPERATION, { status: 'completed', turnId: OPERATION })

    expect(repository.listPendingDeliveries(ACCOUNT)).toHaveLength(1)
    expect(repository.ensureDeliveryTurnId(ACCOUNT, OPERATION, OPERATION).delivery_turn_id).toBe(
      OPERATION,
    )
    repository.markDeliveryState(ACCOUNT, OPERATION, 'suppressed')
    repository.markDeliveryState(ACCOUNT, OPERATION, 'submitted')
    expect(repository.getOperation(ACCOUNT, OPERATION)?.delivery_state).toBe('suppressed')
    expect(repository.listPendingDeliveries(ACCOUNT)).toHaveLength(0)
  })

  it('keeps artifact references link-scoped and validates immutable content metadata', () => {
    repository.getOrCreateLink({
      accountUserId: ACCOUNT,
      linkId: LINK,
      sourceDeviceId: 'device-a',
      sourceSessionId: 'session-a',
      targetDeviceId: 'device-b',
      targetProjectId: 'project-b',
      targetAgentId: 'agent-b',
    })
    const artifact = {
      accountUserId: ACCOUNT,
      artifactRef: ARTIFACT,
      linkId: LINK,
      direction: 'input' as const,
      remotePath: null,
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      sha256: FINGERPRINT,
    }
    expect(repository.insertArtifact(artifact)).toMatchObject({
      artifact_ref: ARTIFACT,
      link_id: LINK,
      remote_path: null,
    })
    expect(repository.insertArtifact(artifact)).toMatchObject({ sha256: FINGERPRINT })
    expect(() => repository.insertArtifact({ ...artifact, sizeBytes: 6 })).toThrow(
      RemoteAgentCollaborationConflictError,
    )
  })
})
