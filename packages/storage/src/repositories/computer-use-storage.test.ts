import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../index.js'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'

interface ApplicationSnapshotRepositoryContract {
  createWithBlobs(input: {
    snapshot: Record<string, unknown>
    blobs: Array<Record<string, unknown>>
  }): Record<string, unknown>
  get(id: string): Record<string, unknown> | null
  getBlob(id: string): Record<string, unknown> | null
  delete(id: string): Array<Record<string, unknown>>
  listBlobStorageKeys(): string[]
  deleteBlobRecordIfUnreferenced(id: string): Record<string, unknown> | null
}

type RepositoryConstructor<T> = new (database: SparkDatabase) => T

function exportedRepository<T>(name: string, db: SparkDatabase): T {
  const Repository = (storage as Record<string, unknown>)[name]
  expect(Repository, `${name} must be exported by @spark/storage`).toBeTypeOf('function')
  return new (Repository as RepositoryConstructor<T>)(db)
}

function createSnapshotRepository(db: SparkDatabase): ApplicationSnapshotRepositoryContract {
  const Repository = (storage as Record<string, unknown>).ApplicationSnapshotRepository
  expect(Repository, 'ApplicationSnapshotRepository must be exported by @spark/storage').toBeTypeOf(
    'function',
  )
  return new (Repository as new (database: SparkDatabase) => ApplicationSnapshotRepositoryContract)(
    db,
  )
}

const createdAt = '2026-07-28T03:00:00.000Z'

function imageBlob(id = 'blob-image-1'): Record<string, unknown> {
  return {
    id,
    kind: 'image',
    storageKey: `${id}.svb`,
    byteLength: 128,
    plaintextSha256: 'a'.repeat(64),
    cipherSha256: 'b'.repeat(64),
    createdAt,
  }
}

function snapshot(imageBlobId = 'blob-image-1'): Record<string, unknown> {
  return {
    id: 'snapshot-1',
    sessionId: 'session-1',
    turnId: null,
    computerSessionId: null,
    kind: 'user_context',
    appId: 'com.apple.TextEdit',
    appName: 'TextEdit',
    windowId: 'window-1',
    windowTitle: 'Untitled',
    bounds: { x: 100, y: 80, width: 900, height: 700 },
    display: { id: 'display-main', width: 2560, height: 1600, scaleFactor: 2 },
    imageBlobId,
    textBlobId: null,
    previewBlobId: null,
    imageSha256: 'a'.repeat(64),
    perceptualHash: null,
    treeVersion: null,
    accessibleTextMode: 'visible_only',
    redaction: { applied: false, reasonCodes: [], regionCount: 0 },
    retention: { mode: 'session', expiresAt: null },
    createdAt,
  }
}

describe('Computer Use storage migration', () => {
  let database: SparkDatabase
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-computer-storage-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
    database = new SparkDatabase(join(testDir, 'test.db'))
    database.runMigrations(join(process.cwd(), 'migrations'))
  })

  afterEach(() => {
    database.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates all Computer Use and snapshot-vault tables', () => {
    const rows = database.raw
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'computer_%' OR name = 'application_snapshots'`,
      )
      .all() as Array<{ name: string }>

    expect(rows.map((row) => row.name).sort()).toEqual(
      [
        'application_snapshots',
        'computer_actions',
        'computer_use_activity_events',
        'computer_actuator_leases',
        'computer_approvals',
        'computer_sessions',
        'computer_snapshot_blobs',
        'computer_verifications',
      ].sort(),
    )
  })

  it('atomically creates snapshot metadata and increments encrypted blob references', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Snapshot session',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)

    const row = repository.createWithBlobs({
      snapshot: snapshot(),
      blobs: [imageBlob()],
    })

    expect(row.id).toBe('snapshot-1')
    expect(row.image_blob_id).toBe('blob-image-1')
    expect(repository.getBlob('blob-image-1')?.ref_count).toBe(1)
  })

  it('rolls back newly registered blobs when snapshot insertion fails', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Snapshot session',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)

    expect(() =>
      repository.createWithBlobs({
        snapshot: { ...snapshot(), previewBlobId: 'missing-preview-blob' },
        blobs: [imageBlob()],
      }),
    ).toThrow()
    expect(repository.getBlob('blob-image-1')).toBeNull()
    expect(repository.get('snapshot-1')).toBeNull()
  })

  it('decrements blob references when a parent session is deleted', () => {
    const sessions = new SessionRepository(database)
    sessions.create({
      id: 'session-1',
      kind: 'chat',
      title: 'Snapshot session',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)
    repository.createWithBlobs({ snapshot: snapshot(), blobs: [imageBlob()] })

    sessions.delete('session-1')

    expect(repository.get('snapshot-1')).toBeNull()
    expect(repository.getBlob('blob-image-1')?.ref_count).toBe(0)
  })

  it('returns zero-reference blob metadata after explicit snapshot deletion', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Snapshot session',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)
    repository.createWithBlobs({ snapshot: snapshot(), blobs: [imageBlob()] })

    const unreferenced = repository.delete('snapshot-1')

    expect(unreferenced).toEqual([
      expect.objectContaining({
        id: 'blob-image-1',
        storage_key: 'blob-image-1.svb',
        ref_count: 0,
      }),
    ])
  })

  it('enumerates vault keys and prevents path escape or referenced blob deletion', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Protected snapshot blobs',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)
    repository.createWithBlobs({ snapshot: snapshot(), blobs: [imageBlob()] })

    expect(repository.listBlobStorageKeys()).toEqual(['blob-image-1.svb'])
    expect(repository.deleteBlobRecordIfUnreferenced('blob-image-1')).toBeNull()
    expect(repository.getBlob('blob-image-1')?.ref_count).toBe(1)
    expect(() =>
      repository.createWithBlobs({
        snapshot: { ...snapshot('blob-escape'), id: 'snapshot-escape' },
        blobs: [{ ...imageBlob('blob-escape'), storageKey: '../escape.svb' }],
      }),
    ).toThrow()
    expect(repository.getBlob('blob-escape')).toBeNull()
  })

  it('rejects blob role, digest, and unused-registration inconsistencies', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Validated snapshot blobs',
      status: 'idle',
      projectId: 'default',
    })
    const repository = createSnapshotRepository(database)

    expect(() =>
      repository.createWithBlobs({
        snapshot: snapshot('blob-wrong-kind'),
        blobs: [{ ...imageBlob('blob-wrong-kind'), kind: 'text' }],
      }),
    ).toThrow()
    expect(() =>
      repository.createWithBlobs({
        snapshot: { ...snapshot('blob-wrong-digest'), id: 'snapshot-wrong-digest' },
        blobs: [
          {
            ...imageBlob('blob-wrong-digest'),
            plaintextSha256: 'c'.repeat(64),
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      repository.createWithBlobs({
        snapshot: { ...snapshot('blob-image-used'), id: 'snapshot-unused-blob' },
        blobs: [imageBlob('blob-image-used'), imageBlob('blob-unused')],
      }),
    ).toThrow()

    expect(repository.getBlob('blob-wrong-kind')).toBeNull()
    expect(repository.getBlob('blob-wrong-digest')).toBeNull()
    expect(repository.getBlob('blob-unused')).toBeNull()
  })

  it('requires computer-run snapshots to match their parent session and turn', () => {
    const sessionRepository = new SessionRepository(database)
    for (const id of ['session-1', 'session-2']) {
      sessionRepository.create({
        id,
        kind: 'chat',
        title: id,
        status: 'idle',
        projectId: 'default',
      })
    }
    const computerSessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    computerSessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Capture execution evidence' },
      createdAt,
    })
    const repository = createSnapshotRepository(database)
    const executionSnapshot = {
      ...snapshot('blob-execution'),
      id: 'snapshot-execution',
      sessionId: 'session-2',
      turnId: 'turn-2',
      computerSessionId: 'computer-session-1',
      kind: 'execution_before',
      retention: { mode: 'computer_run', expiresAt: null },
    }

    expect(() =>
      repository.createWithBlobs({
        snapshot: executionSnapshot,
        blobs: [imageBlob('blob-execution')],
      }),
    ).toThrow()
    expect(() =>
      repository.createWithBlobs({
        snapshot: {
          ...executionSnapshot,
          id: 'snapshot-without-computer-run',
          sessionId: 'session-1',
          turnId: null,
          computerSessionId: null,
          imageBlobId: 'blob-without-computer-run',
        },
        blobs: [imageBlob('blob-without-computer-run')],
      }),
    ).toThrow()
  })

  it('persists governed sessions and enforces one action per step index', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Computer session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      get(id: string): Record<string, unknown> | null
      listActive(limit?: number): Array<Record<string, unknown>>
    }>('ComputerSessionRepository', database)
    const actions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      nextStepIndex(computerSessionId: string): number
      startExecuting(id: string, approvalTicketId: string | null): Record<string, unknown> | null
    }>('ComputerActionRepository', database)

    sessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Save the document' },
      createdAt,
    })
    expect(sessions.listActive()).toEqual([
      expect.objectContaining({ id: 'computer-session-1', status: 'preflighting' }),
    ])
    const action = {
      id: 'action-1',
      computerSessionId: 'computer-session-1',
      stepIndex: 0,
      action: { type: 'click', point: { x: 0.5, y: 0.5 } },
      intent: 'Focus the editor',
      riskLevel: 'L1',
      policyDecision: 'allow',
      approvalTicketId: null,
      beforeFrameId: 'frame-1',
      expectedPostcondition: null,
      createdAt,
    }

    expect(actions.nextStepIndex('computer-session-1')).toBe(0)
    expect(actions.create(action)).toEqual(
      expect.objectContaining({ id: 'action-1', step_index: 0 }),
    )
    expect(actions.nextStepIndex('computer-session-1')).toBe(1)
    expect(() => actions.create({ ...action, id: 'action-duplicate-step' })).toThrow()
    expect(actions.startExecuting('action-1', null)).toEqual(
      expect.objectContaining({ status: 'executing', approval_ticket_id: null }),
    )
    expect(actions.startExecuting('action-1', null)).toBeNull()
    expect(sessions.get('computer-session-1')?.status).toBe('preflighting')
  })

  it('persists and pages Computer Use activity events by session sequence', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Computer activity',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    sessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Save the document' },
      createdAt,
    })
    const events = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      listAfter(
        computerSessionId: string,
        afterSeq: number,
        limit: number,
      ): Array<{
        seq: number
        event_json: string
      }>
      nextSeq(computerSessionId: string): number
    }>('ComputerActivityEventRepository', database)

    for (const seq of [0, 1, 2]) {
      events.create({
        id: `event-${seq}`,
        computerSessionId: 'computer-session-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        seq,
        eventType: 'computer_action_requested',
        event: { id: `event-${seq}`, seq },
        createdAt,
      })
    }

    expect(events.nextSeq('computer-session-1')).toBe(3)
    expect(events.listAfter('computer-session-1', 0, 1)).toEqual([
      expect.objectContaining({ seq: 1 }),
    ])
    expect(() =>
      events.create({
        id: 'event-duplicate-seq',
        computerSessionId: 'computer-session-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        seq: 1,
        eventType: 'computer_action_requested',
        event: {},
        createdAt,
      }),
    ).toThrow()
  })

  it('consumes an approved ticket exactly once and rejects digest mismatches', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Approval session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    const actions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerActionRepository', database)
    const approvals = exportedRepository<{
      createPending(input: Record<string, unknown>): Record<string, unknown>
      approve(input: Record<string, unknown>): Record<string, unknown> | null
      consume(input: Record<string, unknown>): boolean
      deny(id: string, computerSessionId: string, deniedAt: string): boolean
      findPendingByAction(
        computerSessionId: string,
        actionId: string,
        now: string,
      ): Record<string, unknown> | null
      denyPendingForSession(computerSessionId: string, deniedAt: string): number
      get(id: string): Record<string, unknown> | null
    }>('ComputerApprovalRepository', database)
    sessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Send the message' },
      createdAt,
    })
    actions.create({
      id: 'action-1',
      computerSessionId: 'computer-session-1',
      stepIndex: 0,
      action: { type: 'click', point: { x: 0.5, y: 0.5 } },
      intent: 'Send the approved message',
      riskLevel: 'L2',
      policyDecision: 'require_approval',
      approvalTicketId: null,
      beforeFrameId: 'frame-1',
      expectedPostcondition: null,
      createdAt,
    })
    approvals.createPending({
      id: 'approval-1',
      computerSessionId: 'computer-session-1',
      actionId: 'action-1',
      riskLevel: 'L2',
      actionDigest: 'a'.repeat(64),
      targetDigest: 'b'.repeat(64),
      dataClassDigest: null,
      expiresAt: '2026-07-28T03:10:00.000Z',
      createdAt,
    })
    expect(
      approvals.approve({
        id: 'approval-1',
        approvedBy: 'local_user',
        approverId: 'local-user',
        nonceHash: 'c'.repeat(64),
        approvedAt: '2026-07-28T03:01:00.000Z',
      }),
    ).toEqual(expect.objectContaining({ decision: 'approved' }))

    const consume = {
      id: 'approval-1',
      nonceHash: 'c'.repeat(64),
      actionDigest: 'a'.repeat(64),
      targetDigest: 'b'.repeat(64),
      dataClassDigest: null,
      usedAt: '2026-07-28T03:02:00.000Z',
    }
    expect(approvals.consume({ ...consume, targetDigest: 'd'.repeat(64) })).toBe(false)
    expect(approvals.consume(consume)).toBe(true)
    expect(approvals.consume(consume)).toBe(false)

    actions.create({
      id: 'action-2',
      computerSessionId: 'computer-session-1',
      stepIndex: 1,
      action: { type: 'click', point: { x: 0.25, y: 0.25 } },
      intent: 'Queue another governed action',
      riskLevel: 'L2',
      policyDecision: 'require_approval',
      approvalTicketId: null,
      beforeFrameId: 'frame-2',
      expectedPostcondition: null,
      createdAt,
    })
    approvals.createPending({
      id: 'approval-2',
      computerSessionId: 'computer-session-1',
      actionId: 'action-2',
      riskLevel: 'L2',
      actionDigest: 'd'.repeat(64),
      targetDigest: 'e'.repeat(64),
      dataClassDigest: null,
      expiresAt: '2026-07-28T03:10:00.000Z',
      createdAt,
    })
    expect(
      approvals.findPendingByAction('computer-session-1', 'action-2', '2026-07-28T03:02:00.000Z'),
    ).toEqual(expect.objectContaining({ id: 'approval-2', decision: 'pending' }))
    expect(approvals.denyPendingForSession('computer-session-1', '2026-07-28T03:03:00.000Z')).toBe(
      1,
    )
    expect(approvals.get('approval-2')).toEqual(expect.objectContaining({ decision: 'denied' }))
    expect(
      approvals.findPendingByAction('computer-session-1', 'action-2', '2026-07-28T03:03:00.000Z'),
    ).toBeNull()
    expect(approvals.get('approval-1')).toEqual(expect.objectContaining({ decision: 'approved' }))

    actions.create({
      id: 'action-3',
      computerSessionId: 'computer-session-1',
      stepIndex: 2,
      action: { type: 'click', point: { x: 0.75, y: 0.75 } },
      intent: 'Queue a user-denied action',
      riskLevel: 'L2',
      policyDecision: 'require_approval',
      approvalTicketId: null,
      beforeFrameId: 'frame-3',
      expectedPostcondition: null,
      createdAt,
    })
    approvals.createPending({
      id: 'approval-3',
      computerSessionId: 'computer-session-1',
      actionId: 'action-3',
      riskLevel: 'L2',
      actionDigest: 'f'.repeat(64),
      targetDigest: '0'.repeat(64),
      dataClassDigest: null,
      expiresAt: '2026-07-28T03:10:00.000Z',
      createdAt,
    })
    expect(approvals.deny('approval-3', 'other-session', '2026-07-28T03:04:00.000Z')).toBe(false)
    expect(approvals.deny('approval-3', 'computer-session-1', '2026-07-28T03:04:00.000Z')).toBe(
      true,
    )
    expect(approvals.get('approval-3')).toEqual(expect.objectContaining({ decision: 'denied' }))

    approvals.createPending({
      id: 'approval-4',
      computerSessionId: 'computer-session-1',
      actionId: 'action-3',
      riskLevel: 'L2',
      actionDigest: '1'.repeat(64),
      targetDigest: '2'.repeat(64),
      dataClassDigest: null,
      expiresAt: '2026-07-28T03:10:00.000Z',
      createdAt,
    })
    approvals.approve({
      id: 'approval-4',
      approvedBy: 'local_user',
      approverId: 'local-user',
      nonceHash: '3'.repeat(64),
      approvedAt: '2026-07-28T03:04:00.000Z',
    })
    expect(approvals.denyPendingForSession('computer-session-1', '2026-07-28T03:05:00.000Z')).toBe(
      1,
    )
    expect(approvals.get('approval-4')).toEqual(expect.objectContaining({ decision: 'denied' }))
  })

  it('rejects malformed approval digests and remote approval of L3 actions', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Hardened approval session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    const actions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerActionRepository', database)
    const approvals = exportedRepository<{
      createPending(input: Record<string, unknown>): Record<string, unknown>
      approve(input: Record<string, unknown>): Record<string, unknown> | null
    }>('ComputerApprovalRepository', database)
    sessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Approve a governed action' },
      createdAt,
    })
    actions.create({
      id: 'action-1',
      computerSessionId: 'computer-session-1',
      stepIndex: 0,
      action: { type: 'keypress', keys: ['DELETE'] },
      intent: 'Permanently delete the selected item',
      riskLevel: 'L3',
      policyDecision: 'require_approval',
      approvalTicketId: null,
      beforeFrameId: 'frame-1',
      expectedPostcondition: null,
      createdAt,
    })

    expect(() =>
      approvals.createPending({
        id: 'approval-malformed',
        computerSessionId: 'computer-session-1',
        actionId: 'action-1',
        riskLevel: 'L3',
        actionDigest: 'not-a-sha256',
        targetDigest: 'b'.repeat(64),
        dataClassDigest: null,
        expiresAt: '2026-07-28T03:10:00.000Z',
        createdAt,
      }),
    ).toThrow()
    expect(() =>
      approvals.createPending({
        id: 'approval-expired-at-create',
        computerSessionId: 'computer-session-1',
        actionId: 'action-1',
        riskLevel: 'L3',
        actionDigest: 'a'.repeat(64),
        targetDigest: 'b'.repeat(64),
        dataClassDigest: null,
        expiresAt: createdAt,
        createdAt,
      }),
    ).toThrow()

    approvals.createPending({
      id: 'approval-l3',
      computerSessionId: 'computer-session-1',
      actionId: 'action-1',
      riskLevel: 'L3',
      actionDigest: 'a'.repeat(64),
      targetDigest: 'b'.repeat(64),
      dataClassDigest: 'c'.repeat(64),
      expiresAt: '2026-07-28T03:10:00.000Z',
      createdAt,
    })
    expect(
      approvals.approve({
        id: 'approval-l3',
        approvedBy: 'remote_device',
        approverId: 'remote-device-1',
        nonceHash: 'd'.repeat(64),
        approvedAt: '2026-07-28T03:01:00.000Z',
      }),
    ).toBeNull()
    expect(() =>
      database.raw
        .prepare(
          `UPDATE computer_approvals
           SET approved_by = 'remote_device', nonce_hash = ?, approved_at = ?, decision = 'approved'
           WHERE id = 'approval-l3'`,
        )
        .run('d'.repeat(64), '2026-07-28T03:01:00.000Z'),
    ).toThrow()
  })

  it('completes verification records once with evidence IDs', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Verification session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    const verifications = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      complete(id: string, input: Record<string, unknown>): Record<string, unknown> | null
    }>('ComputerVerificationRepository', database)
    sessions.create({
      id: 'computer-session-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      taskContract: { objective: 'Verify output' },
      createdAt,
    })
    verifications.create({
      id: 'verification-1',
      computerSessionId: 'computer-session-1',
      spec: { kind: 'file', pathPolicyRef: 'workspace-output' },
      verifierModelId: null,
      createdAt,
    })

    expect(
      verifications.complete('verification-1', {
        status: 'passed',
        evidence: [{ snapshotId: 'snapshot-1' }],
        confidence: 0.99,
        completedAt: '2026-07-28T03:03:00.000Z',
      }),
    ).toEqual(expect.objectContaining({ status: 'passed', confidence: 0.99 }))
    expect(
      verifications.complete('verification-1', {
        status: 'failed',
        evidence: [],
        confidence: 0,
        completedAt: '2026-07-28T03:04:00.000Z',
      }),
    ).toBeNull()
  })

  it('enforces one active actuator lease per environment', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Lease session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerSessionRepository', database)
    const leases = exportedRepository<{
      acquire(input: Record<string, unknown>): Record<string, unknown>
      release(id: string, operatorId: string, releasedAt: string): boolean
    }>('ComputerActuatorLeaseRepository', database)
    for (const id of ['computer-session-1', 'computer-session-2']) {
      sessions.create({
        id,
        sessionId: 'session-1',
        turnId: `turn-${id}`,
        workflowRunId: null,
        environment: 'my_desktop',
        providerProfileId: 'provider-1',
        modelId: 'model-1',
        taskContract: { objective: 'Operate one at a time' },
        createdAt,
      })
    }
    leases.acquire({
      id: 'lease-1',
      environmentKey: 'my-desktop:local',
      computerSessionId: 'computer-session-1',
      operatorId: 'operator-1',
      acquiredAt: createdAt,
      expiresAt: '2026-07-28T03:05:00.000Z',
    })
    expect(() =>
      leases.acquire({
        id: 'lease-2',
        environmentKey: 'my-desktop:local',
        computerSessionId: 'computer-session-2',
        operatorId: 'operator-2',
        acquiredAt: '2026-07-28T03:01:00.000Z',
        expiresAt: '2026-07-28T03:06:00.000Z',
      }),
    ).toThrow()
    expect(leases.release('lease-1', 'operator-1', '2026-07-28T03:02:00.000Z')).toBe(true)
    expect(() =>
      leases.acquire({
        id: 'lease-2',
        environmentKey: 'my-desktop:local',
        computerSessionId: 'computer-session-2',
        operatorId: 'operator-2',
        acquiredAt: '2026-07-28T03:03:00.000Z',
        expiresAt: '2026-07-28T03:08:00.000Z',
      }),
    ).not.toThrow()
  })

  it('reclaims a leaked lease from a terminal session before granting the next task', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Recovered lease session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      get(id: string): Record<string, unknown> | null
      updateStatus(id: string, status: string, updatedAt: string, endedAt?: string | null): unknown
    }>('ComputerSessionRepository', database)
    const leases = exportedRepository<{
      acquire(input: Record<string, unknown>): Record<string, unknown>
    }>('ComputerActuatorLeaseRepository', database)
    for (const id of ['computer-session-failed', 'computer-session-next']) {
      sessions.create({
        id,
        sessionId: 'session-1',
        turnId: `turn-${id}`,
        workflowRunId: null,
        environment: 'my_desktop',
        providerProfileId: 'provider-1',
        modelId: 'model-1',
        taskContract: { objective: 'Recover a leaked actuator lease' },
        createdAt,
      })
    }
    leases.acquire({
      id: 'lease-leaked',
      environmentKey: 'my-desktop:local',
      computerSessionId: 'computer-session-failed',
      operatorId: 'operator-failed',
      acquiredAt: createdAt,
      expiresAt: '2026-07-28T04:00:00.000Z',
    })
    sessions.updateStatus(
      'computer-session-failed',
      'failed',
      '2026-07-28T03:01:00.000Z',
      '2026-07-28T03:01:00.000Z',
    )

    expect(() =>
      leases.acquire({
        id: 'lease-next',
        environmentKey: 'my-desktop:local',
        computerSessionId: 'computer-session-next',
        operatorId: 'operator-next',
        acquiredAt: '2026-07-28T03:02:00.000Z',
        expiresAt: '2026-07-28T03:12:00.000Z',
      }),
    ).not.toThrow()
    expect(sessions.get('computer-session-failed')?.actuator_lease_id).toBeNull()
  })

  it('rejects invalid lease windows and clears expired session lease links', () => {
    new SessionRepository(database).create({
      id: 'session-1',
      kind: 'chat',
      title: 'Expiring lease session',
      status: 'idle',
      projectId: 'default',
    })
    const sessions = exportedRepository<{
      create(input: Record<string, unknown>): Record<string, unknown>
      get(id: string): Record<string, unknown> | null
    }>('ComputerSessionRepository', database)
    const leases = exportedRepository<{
      acquire(input: Record<string, unknown>): Record<string, unknown>
      release(id: string, operatorId: string, releasedAt: string): boolean
    }>('ComputerActuatorLeaseRepository', database)
    for (const id of ['computer-session-1', 'computer-session-2']) {
      sessions.create({
        id,
        sessionId: 'session-1',
        turnId: `turn-${id}`,
        workflowRunId: null,
        environment: 'my_desktop',
        providerProfileId: 'provider-1',
        modelId: 'model-1',
        taskContract: { objective: 'Use a valid lease' },
        createdAt,
      })
    }

    expect(() =>
      leases.acquire({
        id: 'lease-invalid',
        environmentKey: 'my-desktop:invalid',
        computerSessionId: 'computer-session-1',
        operatorId: 'operator-1',
        acquiredAt: '2026-07-28T03:05:00.000Z',
        expiresAt: '2026-07-28T03:05:00.000Z',
      }),
    ).toThrow()

    leases.acquire({
      id: 'lease-expired',
      environmentKey: 'my-desktop:local',
      computerSessionId: 'computer-session-1',
      operatorId: 'operator-1',
      acquiredAt: createdAt,
      expiresAt: '2026-07-28T03:01:00.000Z',
    })
    leases.acquire({
      id: 'lease-current',
      environmentKey: 'my-desktop:local',
      computerSessionId: 'computer-session-2',
      operatorId: 'operator-2',
      acquiredAt: '2026-07-28T03:02:00.000Z',
      expiresAt: '2026-07-28T03:10:00.000Z',
    })

    expect(() =>
      leases.release('lease-current', 'operator-2', '2026-07-28T03:01:00.000Z'),
    ).toThrow()
    expect(sessions.get('computer-session-1')?.actuator_lease_id).toBeNull()
    expect(sessions.get('computer-session-2')?.actuator_lease_id).toBe('lease-current')
  })
})
