import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventRepository, SessionRepository, SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import {
  SessionCommandController,
  type SessionCommandHost,
} from '../../../services/session/session-commands.js'
import {
  createCodexNativeThreadMetadataPatch,
  readCodexNativeThreadBindings,
  readCodexNativeThreadGeneration,
} from '../../../services/session/codex-native-thread-binding.js'

describe('/clear Codex native continuity', () => {
  let db: SparkDatabase
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spark-clear-codex-'))
    db = new SparkDatabase(join(directory, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../storage/migrations'))
  })

  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('deletes Spark history and makes the old Host/member binding scopes unreachable', async () => {
    const sessionId = 'session-clear-codex'
    const sessionRepo = new SessionRepository(db)
    const eventRepo = new EventRepository(db)
    sessionRepo.create({
      id: sessionId,
      kind: 'chat',
      title: 'Clear continuity',
      status: 'idle',
      projectId: '',
      providerProfileId: 'provider-codex',
      modelId: 'gpt-test',
      agentAdapter: 'codex',
    })
    const oldBinding = {
      bindingKey: 'old-host-or-member-binding',
      threadId: 'native-thread-before-clear',
      runtimeFingerprint: 'a'.repeat(64),
      threadFingerprint: 'b'.repeat(64),
    }
    sessionRepo.patchMetadata(
      sessionId,
      createCodexNativeThreadMetadataPatch(sessionRepo.getMetadata(sessionId), oldBinding),
    )
    eventRepo.insert({
      id: 'old-user-message',
      sessionId,
      turnId: 'old-turn',
      eventType: 'user_message',
      eventJson: JSON.stringify({ type: 'user_message', content: 'remember this' }),
    })

    const published: AgentEvent[] = []
    const host: SessionCommandHost = {
      clearSessionEventSequencer: vi.fn(),
      reserveEventSeqs: vi.fn(() => 0),
      persistAndPublishCommandEvents: vi.fn((_repo, events) => published.push(...events)),
      notifySessionRenamed: vi.fn(),
      getMcpStatusSummary: vi.fn(() => []),
      hasActiveTurnLoop: vi.fn(() => false),
      startCommandFollowUpTurn: vi.fn(async () => ({ started: false })),
      clearUsageLedgerTurnState: vi.fn(),
      applyApprovalToggle: vi.fn(),
      restoreCheckpointViaSnapshot: vi.fn(async () => {
        throw new Error('not used')
      }),
      getSessionCheckpointEnabled: vi.fn(() => false),
      setSessionCheckpointEnabled: vi.fn((_id, enabled) => enabled),
      setGoal: vi.fn(async () => {
        throw new Error('not used')
      }),
      getGoal: vi.fn(() => {
        throw new Error('not used')
      }),
      controlGoal: vi.fn(async () => {
        throw new Error('not used')
      }),
      confirmGoalContract: vi.fn(async () => {
        throw new Error('not used')
      }),
      rejectGoalContract: vi.fn(async () => {
        throw new Error('not used')
      }),
    }

    const result = await new SessionCommandController(db, host).executeCommandAsEvents({
      sessionId,
      message: '/clear',
    })

    const metadataJson = sessionRepo.get(sessionId)?.metadata_json
    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    expect(eventRepo.countBySession(sessionId)).toBe(0)
    expect(readCodexNativeThreadBindings(metadataJson, oldBinding.bindingKey)).toEqual([])
    expect(readCodexNativeThreadGeneration(metadataJson)).toBe(1)
    expect(published[0]).toMatchObject({ type: 'session_history_reset' })
    expect(host.clearSessionEventSequencer).toHaveBeenCalledWith(sessionId)
    expect(host.clearUsageLedgerTurnState).toHaveBeenCalledWith(sessionId)
  })
})
