import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { EventRepository } from './event.repository.js'
import { SessionCollaborationRepository } from './session-collaboration.repository.js'
import { SessionRepository } from './session.repository.js'

function createDatabase(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'collaboration.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

function addEvent(
  events: EventRepository,
  input: {
    id: string
    sessionId: string
    runId: string
    turnId: string
    seq: number
    type: string
    mode?: 'delta' | 'complete'
    content?: string
    status?: string
    sdkSessionId?: string
    userMessageVisibility?: 'visible' | 'hidden'
  },
): void {
  events.insert({
    id: input.id,
    sessionId: input.sessionId,
    runId: input.runId,
    turnId: input.turnId,
    eventType: input.type,
    eventJson: JSON.stringify({
      id: input.id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      seq: input.seq,
      type: input.type,
      ...(input.mode != null ? { mode: input.mode } : {}),
      ...(input.content != null ? { content: input.content } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.sdkSessionId != null ? { sdkSessionId: input.sdkSessionId } : {}),
      ...(input.userMessageVisibility != null
        ? { userMessageVisibility: input.userMessageVisibility }
        : {}),
    }),
  })
}

describe('SessionCollaborationRepository', () => {
  let db: SparkDatabase
  let testDir: string
  let sessions: SessionRepository
  let events: EventRepository
  let collaboration: SessionCollaborationRepository

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-session-collaboration-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
    db = createDatabase(testDir)
    sessions = new SessionRepository(db)
    events = new EventRepository(db)
    collaboration = new SessionCollaborationRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('does not fork an incomplete running turn', () => {
    sessions.create({
      id: 'source-running',
      kind: 'chat',
      title: 'Running source',
      status: 'running',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'running-user',
      sessionId: 'source-running',
      runId: 'run-running',
      turnId: 'turn-running',
      seq: 0,
      type: 'user_message',
      content: 'unfinished',
    })
    addEvent(events, {
      id: 'running-delta',
      sessionId: 'source-running',
      runId: 'run-running',
      turnId: 'turn-running',
      seq: 1,
      type: 'assistant_message',
      mode: 'delta',
      content: 'partial',
    })

    const result = collaboration.forkSession({ sourceSessionId: 'source-running' })

    expect(result.sourceWasRunning).toBe(true)
    expect(result.copiedTurnCount).toBe(0)
    expect(result.lineage.fork_anchor_turn_id).toBeNull()
    expect(events.queryAllBySession(result.child.id)).toEqual([])
    expect(result.child.turn_count).toBe(0)
  })

  it('materializes only completed history, rewrites identity, and preserves run linkage', () => {
    sessions.create({
      id: 'source-complete',
      kind: 'chat',
      title: 'Completed source',
      status: 'idle',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'first-user',
      sessionId: 'source-complete',
      runId: 'run-1',
      turnId: 'turn-1',
      seq: 0,
      type: 'user_message',
      content: 'first',
    })
    addEvent(events, {
      id: 'first-assistant',
      sessionId: 'source-complete',
      runId: 'run-1',
      turnId: 'turn-1',
      seq: 1,
      type: 'assistant_message',
      mode: 'complete',
      content: 'answer',
    })
    addEvent(events, {
      id: 'first-prompt-snapshot',
      sessionId: 'source-complete',
      runId: 'run-1',
      turnId: 'turn-1',
      seq: 2,
      type: 'turn_prompt_snapshot',
      sdkSessionId: 'source-sdk',
    })
    addEvent(events, {
      id: 'first-status',
      sessionId: 'source-complete',
      runId: 'run-1',
      turnId: 'turn-1',
      seq: 3,
      type: 'agent_status',
      status: 'completed',
    })
    addEvent(events, {
      id: 'second-user',
      sessionId: 'source-complete',
      runId: 'run-2',
      turnId: 'turn-2',
      seq: 4,
      type: 'user_message',
      content: 'running now',
    })
    addEvent(events, {
      id: 'second-delta',
      sessionId: 'source-complete',
      runId: 'run-2',
      turnId: 'turn-2',
      seq: 5,
      type: 'assistant_message',
      mode: 'delta',
      content: 'partial',
    })

    const result = collaboration.forkSession({ sourceSessionId: 'source-complete' })
    const copied = events.queryAllBySession(result.child.id)

    expect(result.copiedTurnCount).toBe(1)
    expect(result.lineage.fork_anchor_turn_id).toBe('turn-1')
    expect(copied.map((row) => row.event_type)).toEqual([
      'user_message',
      'assistant_message',
      'agent_status',
    ])
    expect(copied.map((row) => row.seq)).toEqual([0, 1, 2])
    expect(copied.every((row) => row.run_id === 'run-1')).toBe(true)
    expect(
      copied.every((row) => row.id !== 'first-user' && row.session_id === result.child.id),
    ).toBe(true)
    expect(copied.every((row) => JSON.parse(row.event_json).sessionId === result.child.id)).toBe(
      true,
    )
    expect(result.child.turn_count).toBe(1)
  })

  it('does not copy hidden internal turns that precede a visible fork anchor', () => {
    sessions.create({
      id: 'hidden-source',
      kind: 'chat',
      title: 'Source with internal work',
      status: 'idle',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'hidden-user',
      sessionId: 'hidden-source',
      runId: 'hidden-run',
      turnId: 'hidden-turn',
      seq: 0,
      type: 'user_message',
      content: 'internal instruction',
      userMessageVisibility: 'hidden',
    })
    addEvent(events, {
      id: 'hidden-assistant',
      sessionId: 'hidden-source',
      runId: 'hidden-run',
      turnId: 'hidden-turn',
      seq: 1,
      type: 'assistant_message',
      mode: 'complete',
      content: 'internal result',
    })
    addEvent(events, {
      id: 'hidden-status',
      sessionId: 'hidden-source',
      runId: 'hidden-run',
      turnId: 'hidden-turn',
      seq: 2,
      type: 'agent_status',
      status: 'completed',
    })
    addEvent(events, {
      id: 'visible-user',
      sessionId: 'hidden-source',
      runId: 'visible-run',
      turnId: 'visible-turn',
      seq: 3,
      type: 'user_message',
      content: 'visible request',
    })
    addEvent(events, {
      id: 'visible-assistant',
      sessionId: 'hidden-source',
      runId: 'visible-run',
      turnId: 'visible-turn',
      seq: 4,
      type: 'assistant_message',
      mode: 'complete',
      content: 'visible answer',
    })
    addEvent(events, {
      id: 'visible-status',
      sessionId: 'hidden-source',
      runId: 'visible-run',
      turnId: 'visible-turn',
      seq: 5,
      type: 'agent_status',
      status: 'completed',
    })

    const result = collaboration.forkSession({
      sourceSessionId: 'hidden-source',
      anchorTurnId: 'visible-turn',
    })
    const copied = events.queryAllBySession(result.child.id)
    expect(copied.map((event) => event.turn_id)).toEqual([
      'visible-turn',
      'visible-turn',
      'visible-turn',
    ])
    expect(copied.map((event) => event.event_type)).toEqual([
      'user_message',
      'assistant_message',
      'agent_status',
    ])
  })

  it('enforces reference ownership and marks a deleted source unavailable', () => {
    sessions.create({
      id: 'reference-target',
      kind: 'chat',
      title: 'Target',
      status: 'idle',
      projectId: 'project-1',
    })
    sessions.create({
      id: 'reference-source',
      kind: 'chat',
      title: 'Source',
      status: 'idle',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'reference-user',
      sessionId: 'reference-source',
      runId: 'run-ref',
      turnId: 'turn-ref',
      seq: 0,
      type: 'user_message',
      content: 'reference body',
    })
    addEvent(events, {
      id: 'reference-status',
      sessionId: 'reference-source',
      runId: 'run-ref',
      turnId: 'turn-ref',
      seq: 1,
      type: 'agent_status',
      status: 'completed',
    })

    const reference = collaboration.attachReference({
      targetSessionId: 'reference-target',
      sourceSessionId: 'reference-source',
    })
    expect(
      collaboration.readReference({
        targetSessionId: 'reference-target',
        referenceId: reference.id,
      }).turns[0]?.userMessage,
    ).toBe('reference body')
    expect(() =>
      collaboration.readReference({
        targetSessionId: 'other-target',
        referenceId: reference.id,
      }),
    ).toThrow('不属于当前会话')
    expect(() =>
      collaboration.updateReferenceSnapshot({
        targetSessionId: 'other-target',
        referenceId: reference.id,
      }),
    ).toThrow('不属于当前会话')
    expect(() =>
      collaboration.revokeReference({
        targetSessionId: 'other-target',
        referenceId: reference.id,
      }),
    ).toThrow('不属于当前会话')
    expect(sessions.deleteWithRelatedData('reference-source')).toBe(true)
    expect(collaboration.listReferences('reference-target')[0]?.status).toBe('unavailable')
    expect(() =>
      collaboration.readReference({
        targetSessionId: 'reference-target',
        referenceId: reference.id,
      }),
    ).toThrow('已删除')
  })

  it('does not expose a running user message through reference reads or search', () => {
    sessions.create({
      id: 'incomplete-target',
      kind: 'chat',
      title: 'Target',
      status: 'idle',
      projectId: 'project-1',
    })
    sessions.create({
      id: 'incomplete-source',
      kind: 'chat',
      title: 'Running source',
      status: 'running',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'incomplete-user',
      sessionId: 'incomplete-source',
      runId: 'run-incomplete',
      turnId: 'turn-incomplete',
      seq: 0,
      type: 'user_message',
      content: 'secret unfinished prompt',
    })

    const reference = collaboration.attachReference({
      targetSessionId: 'incomplete-target',
      sourceSessionId: 'incomplete-source',
    })
    const read = collaboration.readReference({
      targetSessionId: 'incomplete-target',
      referenceId: reference.id,
    })
    expect(read.turns).toEqual([])
    expect(read.nextCursor).toBeNull()
    expect(read.hasMore).toBe(false)
    expect(
      collaboration.searchReference({
        targetSessionId: 'incomplete-target',
        referenceId: reference.id,
        query: 'unfinished',
      }).hits,
    ).toEqual([])
    expect(collaboration.listCandidates({ targetSessionId: 'incomplete-target' })).toEqual([
      expect.objectContaining({
        sessionId: 'incomplete-source',
        latestCompletedSeq: 0,
        latestCompletedTurnId: null,
        turnCount: 0,
      }),
    ])
  })

  it('keeps revoked references revoked and bounds snapshot counts to the snapshot seq', () => {
    sessions.create({
      id: 'snapshot-target',
      kind: 'chat',
      title: 'Target',
      status: 'idle',
      projectId: 'project-1',
    })
    sessions.create({
      id: 'snapshot-source',
      kind: 'chat',
      title: 'Source',
      status: 'idle',
      projectId: 'project-1',
    })
    addEvent(events, {
      id: 'snapshot-turn-1-user',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-1',
      turnId: 'snapshot-turn-1',
      seq: 0,
      type: 'user_message',
      content: 'first turn',
    })
    addEvent(events, {
      id: 'snapshot-turn-1-assistant',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-1',
      turnId: 'snapshot-turn-1',
      seq: 1,
      type: 'assistant_message',
      mode: 'complete',
      content: 'first answer',
    })
    addEvent(events, {
      id: 'snapshot-turn-1-status',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-1',
      turnId: 'snapshot-turn-1',
      seq: 2,
      type: 'agent_status',
      status: 'completed',
    })
    addEvent(events, {
      id: 'snapshot-turn-2-user',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-2',
      turnId: 'snapshot-turn-2',
      seq: 3,
      type: 'user_message',
      content: 'second turn',
    })
    addEvent(events, {
      id: 'snapshot-turn-2-assistant',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-2',
      turnId: 'snapshot-turn-2',
      seq: 4,
      type: 'assistant_message',
      mode: 'complete',
      content: 'second answer',
    })
    addEvent(events, {
      id: 'snapshot-turn-2-status',
      sessionId: 'snapshot-source',
      runId: 'snapshot-run-2',
      turnId: 'snapshot-turn-2',
      seq: 5,
      type: 'agent_status',
      status: 'completed',
    })

    const reference = collaboration.attachReference({
      targetSessionId: 'snapshot-target',
      sourceSessionId: 'snapshot-source',
      snapshotSeq: 2,
    })
    expect(reference.snapshotSeq).toBe(2)
    expect(reference.turnCount).toBe(1)
    expect(
      collaboration
        .readReference({
          targetSessionId: 'snapshot-target',
          referenceId: reference.id,
        })
        .turns.map((turn) => turn.turnId),
    ).toEqual(['snapshot-turn-1'])

    expect(
      collaboration.revokeReference({
        targetSessionId: 'snapshot-target',
        referenceId: reference.id,
      }),
    ).toBe(true)
    expect(() =>
      collaboration.updateReferenceSnapshot({
        targetSessionId: 'snapshot-target',
        referenceId: reference.id,
      }),
    ).toThrow('已撤销')
    expect(collaboration.listReferences('snapshot-target')[0]).toEqual(
      expect.objectContaining({ status: 'revoked', turnCount: 1 }),
    )
  })
})
