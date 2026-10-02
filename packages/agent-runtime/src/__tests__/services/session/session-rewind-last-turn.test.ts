import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EventRepository,
  SessionRepository,
  SessionSummaryRepository,
  SparkDatabase,
} from '@spark/storage'
import {
  SessionCheckpointManager,
  type SessionCheckpointHost,
} from '../../../services/session/checkpoint.js'
import {
  createCodexNativeThreadMetadataPatch,
  readCodexNativeThreadBinding,
  readCodexNativeThreadGeneration,
} from '../../../services/session/codex-native-thread-binding.js'
import {
  createSparkLedgerBindingPatch,
  readSparkLedgerSessionId,
} from '../../../services/session/spark-ledger-binding.js'

describe('SessionCheckpointManager（历史修订：rewind / clear / delete）', () => {
  let db: SparkDatabase
  let directory: string
  let eventRepo: EventRepository
  let sessionRepo: SessionRepository
  let host: SessionCheckpointHost

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spark-edit-last-turn-'))
    db = new SparkDatabase(join(directory, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../storage/migrations'))
    eventRepo = new EventRepository(db)
    sessionRepo = new SessionRepository(db)
    sessionRepo.create({
      id: 'session-edit',
      kind: 'chat',
      title: '保留这个标题',
      status: 'idle',
      projectId: '',
      providerProfileId: 'provider-test',
      modelId: 'model-test',
      agentAdapter: 'codex',
    })
    sessionRepo.patchMetadata('session-edit', { lastRunOutcome: 'completed' })
    host = {
      emitCheckpointEvent: vi.fn(),
      clearSessionMemoryForEvents: vi.fn(() => false),
      listActiveSessionIds: vi.fn(() => []),
      clearUsageLedgerTurnState: vi.fn(),
      clearSessionEventSequencer: vi.fn(),
    }
  })

  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function insertTurn(
    turnId: string,
    content: string,
    status: 'completed' | 'cancelled' | 'error' = 'completed',
  ): void {
    const common = {
      sessionId: 'session-edit',
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    }
    eventRepo.insert({
      id: `${turnId}-user`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'user_message',
      eventJson: JSON.stringify({ ...common, id: `${turnId}-user`, type: 'user_message', content }),
    })
    eventRepo.insert({
      id: `${turnId}-tool`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'tool_result',
      eventJson: JSON.stringify({ ...common, id: `${turnId}-tool`, type: 'tool_result' }),
    })
    eventRepo.insert({
      id: `${turnId}-assistant`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'assistant_message',
      eventJson: JSON.stringify({
        ...common,
        id: `${turnId}-assistant`,
        type: 'assistant_message',
        content: 'answer',
        isFinal: true,
      }),
    })
    eventRepo.insert({
      id: `${turnId}-completed`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'agent_status',
      eventJson: JSON.stringify({
        ...common,
        id: `${turnId}-completed`,
        type: 'agent_status',
        status,
      }),
    })
  }

  it('removes every event in the latest completed turn and preserves earlier history', async () => {
    insertTurn('turn-1', 'first')
    insertTurn('turn-2', 'second')
    new SessionSummaryRepository(db).create({
      id: 'summary-with-old-turn',
      sessionId: 'session-edit',
      summaryTurnId: 'turn-2',
      summaryText: 'contains the superseded turn',
      summarizedEntryCount: 2,
      summarizedFromSeq: 1,
      summarizedToSeq: 8,
      estimatedTokens: 12,
    })

    const result = await new SessionCheckpointManager(db, host).rewindLastTurnForEdit(
      'session-edit',
      'turn-2',
    )

    expect(eventRepo.queryAllBySession('session-edit').map((row) => row.turn_id)).toEqual([
      'turn-1',
      'turn-1',
      'turn-1',
      'turn-1',
    ])
    expect(result.retractedEventIds).toEqual([
      'turn-2-user',
      'turn-2-tool',
      'turn-2-assistant',
      'turn-2-completed',
    ])
    expect(result).toMatchObject({ turnCount: 1, logicalMessageCount: 2 })
    expect(sessionRepo.get('session-edit')).toMatchObject({
      title: '保留这个标题',
      status: 'idle',
    })
    expect(sessionRepo.getMetadata('session-edit')).not.toHaveProperty('lastRunOutcome')
    expect(readCodexNativeThreadGeneration(sessionRepo.get('session-edit')?.metadata_json)).toBe(1)
    expect(new SessionSummaryRepository(db).getLatest('session-edit')).toBeUndefined()
    expect(host.clearSessionMemoryForEvents).toHaveBeenCalledWith('session-edit')
    expect(host.clearUsageLedgerTurnState).toHaveBeenCalledWith('session-edit', 'turn-2')
  })

  it('refuses to rewind a turn that is no longer the latest user turn', async () => {
    insertTurn('turn-1', 'first')
    insertTurn('turn-2', 'second')

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', 'turn-1'),
    ).rejects.toThrow('只能编辑当前会话最后一轮用户消息')
    expect(eventRepo.countBySession('session-edit')).toBe(8)
    expect(host.clearSessionMemoryForEvents).not.toHaveBeenCalled()
  })

  it('refuses to rewind while the session is running', async () => {
    insertTurn('turn-running', 'still working')
    sessionRepo.updateStatus('session-edit', 'running')

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', 'turn-running'),
    ).rejects.toThrow('Agent 正在执行')
    expect(eventRepo.countBySession('session-edit')).toBe(4)
  })

  it('refuses to rewind while a durable turn request is queued', async () => {
    insertTurn('turn-queued', 'queued')
    const now = new Date().toISOString()
    db.raw
      .prepare(
        `INSERT INTO turn_requests (id, session_id, payload_json, status, created_at, updated_at)
         VALUES (?, ?, '{}', 'accepted', ?, ?)`,
      )
      .run('queued-request', 'session-edit', now, now)

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', 'turn-queued'),
    ).rejects.toThrow('会话仍有待处理消息')
    expect(eventRepo.countBySession('session-edit')).toBe(4)
  })

  it.each(['cancelled', 'error'] as const)(
    'allows the latest non-running turn after %s',
    async (status) => {
      insertTurn('turn-stopped', 'retry me', status)
      await expect(
        new SessionCheckpointManager(db, host).rewindLastTurnForEdit(
          'session-edit',
          'turn-stopped',
        ),
      ).resolves.toMatchObject({ turnCount: 0, logicalMessageCount: 0 })
    },
  )

  it('allows an idle latest turn even when a terminal status event is missing', async () => {
    const turnId = 'turn-without-terminal-event'
    eventRepo.insert({
      id: `${turnId}-user`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'user_message',
      eventJson: JSON.stringify({
        id: `${turnId}-user`,
        sessionId: 'session-edit',
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        type: 'user_message',
        content: 'retry after an interrupted shutdown',
      }),
    })

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', turnId),
    ).resolves.toMatchObject({ turnCount: 0, logicalMessageCount: 0 })
  })

  it('removes a latest durable turn cancelled before its user message was persisted', async () => {
    insertTurn('turn-1', 'earlier message')
    const turnId = 'turn-cancelled-before-user-message'
    const now = new Date().toISOString()
    db.raw
      .prepare(
        `INSERT INTO turn_requests (id, session_id, payload_json, status, created_at, updated_at)
         VALUES (?, ?, '{}', 'cancelled', ?, ?)`,
      )
      .run(turnId, 'session-edit', now, now)
    eventRepo.insert({
      id: `${turnId}-cancelled`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'agent_status',
      eventJson: JSON.stringify({
        id: `${turnId}-cancelled`,
        sessionId: 'session-edit',
        turnId,
        timestamp: now,
        seq: 0,
        type: 'agent_status',
        status: 'cancelled',
      }),
    })

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', turnId),
    ).resolves.toMatchObject({ turnCount: 1, logicalMessageCount: 2 })
    expect(eventRepo.queryAllBySession('session-edit').map((row) => row.turn_id)).toEqual([
      'turn-1',
      'turn-1',
      'turn-1',
      'turn-1',
    ])
    expect(db.raw.prepare('SELECT 1 FROM turn_requests WHERE id = ?').get(turnId)).toBeUndefined()
  })

  it('rejects an event-only cancelled turn without a matching durable request', async () => {
    const turnId = 'unknown-cancelled-turn'
    eventRepo.insert({
      id: `${turnId}-cancelled`,
      sessionId: 'session-edit',
      turnId,
      eventType: 'agent_status',
      eventJson: JSON.stringify({
        id: `${turnId}-cancelled`,
        sessionId: 'session-edit',
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        type: 'agent_status',
        status: 'cancelled',
      }),
    })

    await expect(
      new SessionCheckpointManager(db, host).rewindLastTurnForEdit('session-edit', turnId),
    ).rejects.toThrow('只能编辑当前会话最后一轮用户消息')
  })

  /** 模拟既有原生续跑状态：codex 持久线程 binding + spark ledger binding + 摘要胶囊。 */
  function seedNativeResumeState(): void {
    const metadata = sessionRepo.getMetadata('session-edit')
    sessionRepo.patchMetadata(
      'session-edit',
      createCodexNativeThreadMetadataPatch(metadata, {
        bindingKey: 'native:host:agent-1',
        threadId: 'thread-before-delete',
        runtimeFingerprint: 'a'.repeat(64),
        threadFingerprint: 'b'.repeat(64),
      }),
    )
    sessionRepo.patchMetadata(
      'session-edit',
      createSparkLedgerBindingPatch(sessionRepo.getMetadata('session-edit'), {
        bindingKey: 'native:host:agent-1',
        sparkSessionId: 'spark-session-before-delete',
      }),
    )
    new SessionSummaryRepository(db).create({
      id: 'summary-before-delete',
      sessionId: 'session-edit',
      summaryTurnId: 'turn-1',
      summaryText: 'summary mentioning deleted turns',
      summarizedEntryCount: 2,
      summarizedFromSeq: 1,
      summarizedToSeq: 4,
      estimatedTokens: 12,
    })
    expect(
      readCodexNativeThreadBinding(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      )?.threadId,
    ).toBe('thread-before-delete')
    expect(
      readSparkLedgerSessionId(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      ),
    ).toBe('spark-session-before-delete')
  }

  it('clearEvents 同时作废 codex/spark 原生绑定与摘要，事件清空后无残留续跑渠道', async () => {
    insertTurn('turn-1', 'first')
    insertTurn('turn-2', 'second')
    seedNativeResumeState()

    await new SessionCheckpointManager(db, host).clearEvents('session-edit')

    expect(eventRepo.countBySession('session-edit')).toBe(0)
    // codex：generation 轮换 + binding 清空，runtime 缓存的旧 key 因 scope 变化不可再命中
    expect(readCodexNativeThreadGeneration(sessionRepo.get('session-edit')?.metadata_json)).toBe(1)
    expect(
      readCodexNativeThreadBinding(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      ),
    ).toBeNull()
    // spark：ledger binding 清空即断链
    expect(
      readSparkLedgerSessionId(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      ),
    ).toBeNull()
    // 摘要胶囊作废，fresh 重建的下一轮不会从旧摘要复述被清内容
    expect(new SessionSummaryRepository(db).getLatest('session-edit')).toBeUndefined()
    expect(host.clearSessionMemoryForEvents).toHaveBeenCalledWith('session-edit')
    expect(host.clearSessionEventSequencer).toHaveBeenCalledWith('session-edit')
  })

  it('deleteMessage 按轮扩展删除并作废原生绑定与摘要（idle 常见路径无残留上下文）', async () => {
    insertTurn('turn-1', 'first')
    insertTurn('turn-2', 'second')
    seedNativeResumeState()

    const result = await new SessionCheckpointManager(db, host).deleteMessage('session-edit', [
      'turn-1-user',
    ])

    // turn-1 的 user + assistant 消息整对被删（tool_result / agent_status 留存），
    // turn-2 完整保留。
    expect(result.deleted).toBe(2)
    const remaining = eventRepo.queryAllBySession('session-edit')
    expect(remaining.filter((row) => row.event_type === 'user_message').map((r) => r.id)).toEqual([
      'turn-2-user',
    ])
    expect(
      remaining.filter((row) => row.event_type === 'assistant_message').map((r) => r.id),
    ).toEqual(['turn-2-assistant'])
    expect(remaining.length).toBe(6)
    expect(readCodexNativeThreadGeneration(sessionRepo.get('session-edit')?.metadata_json)).toBe(1)
    expect(
      readCodexNativeThreadBinding(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      ),
    ).toBeNull()
    expect(
      readSparkLedgerSessionId(
        sessionRepo.get('session-edit')?.metadata_json,
        'native:host:agent-1',
      ),
    ).toBeNull()
    expect(new SessionSummaryRepository(db).getLatest('session-edit')).toBeUndefined()
    // 与 rewind 不同：单条删除不终止在跑的执行器（UI 允许运行中删除）
    expect(host.clearSessionMemoryForEvents).not.toHaveBeenCalled()
  })
})
