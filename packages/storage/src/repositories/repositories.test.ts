/**
 * @spark/storage 领域 Repository 单元测试
 *
 * 测试 SessionRepository、WorkspaceRepository、EventRepository 的核心操作
 * 使用文件数据库（临时目录），每个测试独立环境
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from '../repositories/session.repository.js'
import type { SessionRow } from '../repositories/session.repository.js'
import { WorkspaceRepository } from '../repositories/workspace.repository.js'
import type { WorkspaceRow } from '../repositories/workspace.repository.js'
import { EventRepository } from '../repositories/event.repository.js'
import { TurnRequestRepository } from '../repositories/turn-request.repository.js'
import type { AgentEventRow } from '../repositories/event.repository.js'
import { RulesRepository } from '../repositories/rules.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/**
 * 辅助函数：创建测试数据库并运行 migration
 */
function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

// ─── WorkspaceRepository ──────────────────────────────────────────────────

describe('WorkspaceRepository', () => {
  let db: SparkDatabase
  let repo: WorkspaceRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-ws-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new WorkspaceRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should create a workspace', () => {
    const ws = repo.create({
      id: 'ws-1',
      name: 'test-project',
      rootPath: '/tmp/test-project',
      projectKind: 'generic',
    })

    expect(ws.id).toBe('ws-1')
    expect(ws.name).toBe('test-project')
    expect(ws.root_path).toBe('/tmp/test-project')
    expect(ws.spark_config_path).toBe('/tmp/test-project/.spark')
    expect(ws.agent_runtime_path).toBe('/tmp/test-project/.agent_spark')
    expect(ws.project_kind).toBe('generic')
    expect(ws.created_at).toBeTruthy()
  })

  it('should find workspace by id', () => {
    repo.create({ id: 'ws-1', name: 'test', rootPath: '/tmp/test' })

    const found = repo.get('ws-1')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('test')
  })

  it('should find workspace by root path', () => {
    repo.create({ id: 'ws-1', name: 'test', rootPath: '/tmp/test' })

    const found = repo.findByRootPath('/tmp/test')
    expect(found).not.toBeNull()
    expect(found!.id).toBe('ws-1')

    const notFound = repo.findByRootPath('/nonexistent')
    expect(notFound).toBeNull()
  })

  it('should throw when finding non-existent workspace', () => {
    expect(() => repo.findByIdOrFail('nonexistent')).toThrow('Workspace not found')
  })

  it('should list workspaces ordered by updated_at', () => {
    repo.create({ id: 'ws-1', name: 'first', rootPath: '/tmp/first' })
    repo.create({ id: 'ws-2', name: 'second', rootPath: '/tmp/second' })

    const all = repo.listAll()
    expect(all).toHaveLength(2)
  })

  it('should update workspace name', () => {
    repo.create({ id: 'ws-1', name: 'old-name', rootPath: '/tmp/test' })
    repo.updateName('ws-1', 'new-name')

    const updated = repo.get('ws-1')
    expect(updated!.name).toBe('new-name')
  })

  it('should relocate workspace root paths and keep relocation history', () => {
    repo.create({
      id: 'ws-1',
      name: 'old-name',
      rootPath: '/tmp/test',
      relocatedFrom: ['/tmp/legacy'],
    })
    repo.relocate('ws-1', {
      rootPath: '/tmp/persistent',
      relocatedFrom: ['/tmp/legacy', '/tmp/test'],
    })

    const updated = repo.get('ws-1')
    expect(updated!.root_path).toBe('/tmp/persistent')
    expect(updated!.spark_config_path).toBe('/tmp/persistent/.spark')
    expect(updated!.agent_runtime_path).toBe('/tmp/persistent/.agent_spark')
    expect(updated!.relocated_from_json).toBe(JSON.stringify(['/tmp/legacy', '/tmp/test']))
  })
})

// ─── RulesRepository ──────────────────────────────────────────────────

describe('RulesRepository', () => {
  let db: SparkDatabase
  let repo: RulesRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-rules-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new RulesRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should create, list, update, toggle, and delete rules', () => {
    const created = repo.create({
      id: 'rule-1',
      scope: 'user',
      name: 'Style',
      content: 'Use concise Chinese.',
      priority: 10,
    })

    expect(created.id).toBe('rule-1')
    expect(created.enabled).toBe(1)

    expect(repo.list({ scope: 'user' })).toHaveLength(1)

    const updated = repo.update('rule-1', { content: 'Use concise English.', priority: 20 })
    expect(updated!.content).toBe('Use concise English.')
    expect(updated!.priority).toBe(20)

    const toggled = repo.toggle('rule-1', false)
    expect(toggled!.enabled).toBe(0)

    expect(repo.delete('rule-1')).toBe(true)
    expect(repo.getById('rule-1')).toBeNull()
  })
})

// ─── SessionRepository ──────────────────────────────────────────────────

describe('SessionRepository', () => {
  let db: SparkDatabase
  let repo: SessionRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-session-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new SessionRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should create a session', () => {
    const session = repo.create({
      id: 'sess-1',
      kind: 'chat',
      title: 'Test Session',
      status: 'idle',
      projectId: 'proj-1',
    })

    expect(session.id).toBe('sess-1')
    expect(session.kind).toBe('chat')
    expect(session.title).toBe('Test Session')
    expect(session.status).toBe('idle')
    expect(session.project_id).toBe('proj-1')
    expect(session.workspace_ids_json).toBe('[]')
  })

  it('should create a session with workspace ids', () => {
    const session = repo.create({
      id: 'sess-2',
      kind: 'project',
      title: 'With Workspaces',
      status: 'idle',
      projectId: 'proj-1',
      workspaceIds: ['ws-1', 'ws-2'],
    })

    const workspaceIds = repo.getWorkspaceIds('sess-2')
    expect(workspaceIds).toEqual(['ws-1', 'ws-2'])
  })

  it('should update session status', () => {
    repo.create({ id: 'sess-1', kind: 'chat', title: 'Test', status: 'idle', projectId: 'proj-1' })

    repo.updateStatus('sess-1', 'running')

    const updated = repo.get('sess-1')
    expect(updated!.status).toBe('running')
  })

  it('should update session title', () => {
    repo.create({
      id: 'sess-1',
      kind: 'chat',
      title: 'Old Title',
      status: 'idle',
      projectId: 'proj-1',
    })

    repo.updateTitle('sess-1', 'New Title')

    const updated = repo.get('sess-1')
    expect(updated!.title).toBe('New Title')
  })

  it('should patch session metadata', () => {
    repo.create({ id: 'sess-1', kind: 'chat', title: 'Test', status: 'idle', projectId: 'proj-1' })

    const next = repo.patchMetadata('sess-1', {
      team: {
        enabled: true,
        hostAgentId: 'pm-agent',
        memberAgentIds: ['docs-agent'],
        maxDepth: 1,
        allowNesting: false,
      },
    })

    expect(next).toEqual({
      team: {
        enabled: true,
        hostAgentId: 'pm-agent',
        memberAgentIds: ['docs-agent'],
        maxDepth: 1,
        allowNesting: false,
      },
    })
    expect(repo.getMetadata('sess-1')).toEqual(next)
    expect(JSON.parse(repo.get('sess-1')!.metadata_json)).toEqual(next)
  })

  it('should list sessions with filters', () => {
    repo.create({ id: 'sess-1', kind: 'chat', title: 'A', status: 'idle', projectId: 'proj-1' })
    repo.create({
      id: 'sess-2',
      kind: 'project',
      title: 'B',
      status: 'running',
      projectId: 'proj-1',
    })
    repo.create({ id: 'sess-3', kind: 'chat', title: 'C', status: 'idle', projectId: 'proj-2' })

    // 按 project 过滤
    const proj1 = repo.list({ projectId: 'proj-1' })
    expect(proj1.sessions).toHaveLength(2)

    // 按 status 过滤
    const running = repo.list({ status: 'running' })
    expect(running.sessions).toHaveLength(1)
    expect(running.sessions[0]!.id).toBe('sess-2')

    // 无过滤
    const all = repo.list()
    expect(all.total).toBe(3)
  })
})

// ─── EventRepository ──────────────────────────────────────────────────

describe('TurnRequestRepository', () => {
  let db: SparkDatabase
  let repo: TurnRequestRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-turn-request-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    new SessionRepository(db).create({
      id: 'session-1',
      kind: 'agent',
      title: 'Session',
      status: 'idle',
      projectId: 'project-1',
    })
    repo = new TurnRequestRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('persists and transitions a durable turn request', () => {
    repo.create({
      id: 'turn-1',
      sessionId: 'session-1',
      payloadJson: JSON.stringify({ turnId: 'turn-1', message: 'hello' }),
      createdAt: '2026-07-13T00:00:00.000Z',
    })

    expect(repo.listRecoverable()).toHaveLength(1)
    expect(repo.markRunning('turn-1')).toBe(true)
    expect(repo.get('turn-1')?.status).toBe('running')
    expect(repo.markCompleted('turn-1')).toBe(true)
    expect(repo.get('turn-1')?.status).toBe('completed')
    expect(repo.get('turn-1')?.payload_json).toBe('{}')
    expect(repo.listRecoverable()).toHaveLength(0)
  })

  it('clears terminal payloads and prunes expired terminal requests in batches', () => {
    for (const id of ['completed', 'failed', 'cancelled']) {
      repo.create({
        id,
        sessionId: 'session-1',
        payloadJson: JSON.stringify({ message: `secret-${id}` }),
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    }

    expect(repo.markCompleted('completed')).toBe(true)
    expect(repo.markFailed('failed', 'expected failure')).toBe(true)
    expect(repo.cancel('cancelled')).toBe(true)
    expect(repo.get('completed')?.payload_json).toBe('{}')
    expect(repo.get('failed')?.payload_json).toBe('{}')
    expect(repo.get('cancelled')?.payload_json).toBe('{}')

    expect(repo.deleteTerminalBeforeBatch('2099-01-01T00:00:00.000Z', 2)).toBe(2)
    expect(repo.deleteTerminalBeforeBatch('2099-01-01T00:00:00.000Z', 2)).toBe(1)
    expect(repo.deleteTerminalBeforeBatch('2099-01-01T00:00:00.000Z', 2)).toBe(0)
  })

  it('cascades requests when their session is deleted', () => {
    repo.create({
      id: 'turn-1',
      sessionId: 'session-1',
      payloadJson: '{}',
      createdAt: '2026-07-13T00:00:00.000Z',
    })

    new SessionRepository(db).delete('session-1')

    expect(repo.get('turn-1')).toBeNull()
  })
})

// ─── EventRepository ─────────────────────────────────

describe('EventRepository', () => {
  let db: SparkDatabase
  let repo: EventRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-event-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new EventRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should insert an event', () => {
    repo.insert({
      id: 'evt-1',
      sessionId: 'sess-1',
      runId: 'run-1',
      turnId: 'turn-1',
      eventType: 'user_message',
      eventJson: JSON.stringify({ type: 'user_message', content: 'Hello' }),
    })

    const result = repo.queryBySession({ sessionId: 'sess-1' })
    expect(result.events).toHaveLength(1)
    expect(result.hasMore).toBe(false)

    const evt = result.events[0]!
    expect(evt.id).toBe('evt-1')
    expect(evt.event_type).toBe('user_message')
  })

  it('should insert batch events in a transaction', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `evt-${i}`,
      sessionId: 'sess-1',
      runId: 'run-1',
      eventType: 'assistant_message',
      eventJson: JSON.stringify({ type: 'assistant_message', content: `chunk-${i}` }),
    }))

    repo.insertBatch(events)

    expect(repo.countBySession('sess-1')).toBe(10)
  })

  it('should count multiple sessions in one query', () => {
    repo.insertBatch([
      {
        id: 'evt-count-1',
        sessionId: 'sess-1',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: 1 }),
      },
      {
        id: 'evt-count-2',
        sessionId: 'sess-1',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: 2 }),
      },
      {
        id: 'evt-count-3',
        sessionId: 'sess-2',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: 1 }),
      },
    ])

    expect(repo.countBySessions(['sess-1', 'sess-2', 'sess-empty'])).toEqual(
      new Map([
        ['sess-1', 2],
        ['sess-2', 1],
      ]),
    )
  })

  it('maintains persisted turn and logical message counters', () => {
    const sessions = new SessionRepository(db)
    for (const id of ['sess-1', 'sess-2']) {
      sessions.create({
        id,
        kind: 'interactive',
        title: id,
        status: 'idle',
        projectId: 'project-1',
      })
    }
    repo.insertBatch([
      {
        id: 'evt-user-1',
        sessionId: 'sess-1',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: 1 }),
      },
      {
        id: 'evt-thinking-1',
        sessionId: 'sess-1',
        eventType: 'agent_thinking',
        eventJson: JSON.stringify({ seq: 2, mode: 'delta' }),
      },
      {
        id: 'evt-assistant-1',
        sessionId: 'sess-1',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: 3, mode: 'complete' }),
      },
      {
        id: 'evt-user-2',
        sessionId: 'sess-2',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: 1 }),
      },
    ])

    expect(sessions.get('sess-1')).toMatchObject({
      turn_count: 1,
      logical_message_count: 2,
    })
    expect(sessions.get('sess-2')).toMatchObject({
      turn_count: 1,
      logical_message_count: 1,
    })

    expect(repo.deleteEventsByIds(['evt-user-1', 'evt-assistant-1'])).toBe(2)
    expect(sessions.get('sess-1')).toMatchObject({
      turn_count: 0,
      logical_message_count: 0,
    })
  })

  it('deletes every transient stream delta while retaining complete events', () => {
    const transientTypes = [
      'assistant_message',
      'agent_thinking',
      'team_member_message',
      'subagent_message',
    ]
    repo.insertBatch([
      ...transientTypes.map((eventType, index) => ({
        id: `evt-transient-${index}`,
        sessionId: 'sess-stream',
        eventType,
        eventJson: JSON.stringify({ seq: index + 1, mode: 'delta' }),
      })),
      {
        id: 'evt-complete',
        sessionId: 'sess-stream',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: 5, mode: 'complete' }),
      },
    ])

    expect(repo.deleteTransientDeltasBatch(2)).toBe(2)
    expect(repo.deleteTransientDeltasBatch(10)).toBe(2)
    expect(repo.deleteTransientDeltasBatch(10)).toBe(0)
    expect(repo.queryBySession({ sessionId: 'sess-stream' }).events).toHaveLength(1)
    expect(repo.queryBySession({ sessionId: 'sess-stream' }).events[0]?.id).toBe('evt-complete')
  })

  it('allocates the next seq from the persisted maximum after rows are deleted', () => {
    repo.insertBatch([
      {
        id: 'evt-next-low',
        sessionId: 'sess-seq',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: 2, mode: 'complete', content: 'low' }),
      },
      {
        id: 'evt-next-high',
        sessionId: 'sess-seq',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: 9, mode: 'complete', content: 'high' }),
      },
    ])
    repo.deleteEventsByIds(['evt-next-low'])

    expect(repo.countBySession('sess-seq')).toBe(1)
    expect(repo.nextSeqBySession('sess-seq')).toBe(10)
  })

  it('includes hidden delta rows when allocating the next persisted seq', () => {
    repo.insert({
      id: 'evt-hidden-delta',
      sessionId: 'sess-delta-seq',
      eventType: 'assistant_message',
      eventJson: JSON.stringify({ seq: 41, mode: 'delta', content: 'partial' }),
    })

    expect(repo.queryRenderablePage({ sessionId: 'sess-delta-seq' }).events).toHaveLength(0)
    expect(repo.nextSeqBySession('sess-delta-seq')).toBe(42)
    expect(repo.nextSeqBySession('sess-empty')).toBe(0)
  })

  it('queries persisted stream events for a single turn including hidden deltas', () => {
    const repo = new EventRepository(db)
    for (const [id, turnId, seq, eventType, mode] of [
      ['evt-1', 'turn-1', 1, 'assistant_message', 'delta'],
      ['evt-tool', 'turn-1', 2, 'tool_call', null],
      ['evt-2', 'turn-1', 3, 'agent_thinking', 'delta'],
      ['evt-subagent-delta', 'turn-1', 4, 'subagent_message', 'delta'],
      ['evt-subagent-complete', 'turn-1', 5, 'subagent_message', 'complete'],
      ['evt-3', 'turn-2', 6, 'assistant_message', 'complete'],
    ] as const) {
      repo.insert({
        id,
        sessionId: 'sess-turn-events',
        turnId,
        eventType,
        eventJson: JSON.stringify({
          id,
          sessionId: 'sess-turn-events',
          turnId,
          seq,
          type: eventType,
          mode,
          content: id,
        }),
      })
    }

    expect(repo.queryStreamEventsByTurn('sess-turn-events', 'turn-1').map((row) => row.id)).toEqual(
      ['evt-1', 'evt-2', 'evt-subagent-delta', 'evt-subagent-complete'],
    )
    const renderablePageIds = repo
      .queryRenderablePage({ sessionId: 'sess-turn-events' })
      .events.map((row) => row.id)
    expect(renderablePageIds).toContain('evt-subagent-complete')
    expect(renderablePageIds).not.toContain('evt-subagent-delta')
    expect(
      repo.queryRenderableTurns({ sessionId: 'sess-turn-events' }).events.map((row) => row.id),
    ).not.toContain('evt-subagent-delta')
  })

  it('should query events with pagination', () => {
    // 插入 5 个事件
    for (let i = 0; i < 5; i++) {
      repo.insert({
        id: `evt-${i}`,
        sessionId: 'sess-1',
        eventType: 'user_message',
        eventJson: JSON.stringify({ content: `msg-${i}` }),
      })
    }

    // limit=3 应该返回 hasMore=true
    const page1 = repo.queryBySession({ sessionId: 'sess-1', limit: 3 })
    expect(page1.events).toHaveLength(3)
    expect(page1.hasMore).toBe(true)

    // 使用 ID 分页：取 page1 最后一个事件的 ID，查询剩余事件
    // （注：同毫秒插入的事件 created_at 相同，不适合做游标，用 limit+总数 验证）
    const remaining = repo.queryBySession({ sessionId: 'sess-1', limit: 10 })
    const page2Events = remaining.events.slice(3) // 跳过前 3 个
    expect(page2Events).toHaveLength(2)
  })

  it('returns the latest page in chronological order and pages older events by seq', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({
        id: `evt-seq-${i}`,
        sessionId: 'sess-1',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: i, content: `chunk-${i}` }),
      })
    }

    const latest = repo.queryBySession({ sessionId: 'sess-1', limit: 3 })
    expect(latest.events.map((event) => JSON.parse(event.event_json).seq)).toEqual([2, 3, 4])
    expect(latest.hasMore).toBe(true)

    const older = repo.queryBySession({ sessionId: 'sess-1', limit: 3, beforeSeq: 2 })
    expect(older.events.map((event) => JSON.parse(event.event_json).seq)).toEqual([0, 1])
    expect(older.hasMore).toBe(false)
  })

  it('uses generated seq and mode columns for renderable history queries', () => {
    repo.insert({
      id: 'evt-generated',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      eventType: 'assistant_message',
      eventJson: JSON.stringify({ seq: 7, mode: 'complete', content: 'done' }),
    })

    const row = db.raw
      .prepare('SELECT seq, event_mode FROM agent_events WHERE id = ?')
      .get('evt-generated') as { seq: number; event_mode: string }

    expect(row).toEqual({ seq: 7, event_mode: 'complete' })
  })

  it('limits renderable turn pages by complete turns', () => {
    const events = [
      ...Array.from({ length: 3 }, (_, i) => ({ turnId: 'turn-old', seq: i })),
      ...Array.from({ length: 3 }, (_, i) => ({ turnId: 'turn-mid', seq: 10 + i })),
      ...Array.from({ length: 3 }, (_, i) => ({ turnId: 'turn-new', seq: 20 + i })),
    ]
    for (const event of events) {
      repo.insert({
        id: `evt-turn-${event.seq}`,
        sessionId: 'sess-1',
        turnId: event.turnId,
        eventType: 'tool_call',
        eventJson: JSON.stringify({ seq: event.seq }),
      })
    }

    const limited = repo.queryRenderableTurns({
      sessionId: 'sess-1',
      turnLimit: 3,
      eventLimit: 5,
    })

    expect(limited.events.map((event) => event.turn_id)).toEqual([
      'turn-new',
      'turn-new',
      'turn-new',
    ])
    expect(limited.events.map((event) => JSON.parse(event.event_json).seq)).toEqual([20, 21, 22])
    expect(limited.hasMore).toBe(true)
  })

  it('keeps session-level renderable events across selected turn pages', () => {
    const turnEvents = [
      ...Array.from({ length: 3 }, (_, i) => ({ turnId: 'turn-old', seq: i })),
      ...Array.from({ length: 3 }, (_, i) => ({ turnId: 'turn-new', seq: 20 + i })),
    ]
    for (const event of turnEvents) {
      repo.insert({
        id: `evt-window-turn-${event.seq}`,
        sessionId: 'sess-1',
        turnId: event.turnId,
        eventType: 'tool_call',
        eventJson: JSON.stringify({ seq: event.seq }),
      })
    }
    for (const seq of [1, 21, 30]) {
      repo.insert({
        id: `evt-window-session-${seq}`,
        sessionId: 'sess-1',
        eventType: 'session_note',
        eventJson: JSON.stringify({ seq }),
      })
    }

    const page = repo.queryRenderableTurns({
      sessionId: 'sess-1',
      turnLimit: 1,
      eventLimit: 20,
    })

    expect(page.events.map((event) => event.id)).toEqual([
      'evt-window-session-1',
      'evt-window-turn-20',
      'evt-window-turn-21',
      'evt-window-session-21',
      'evt-window-turn-22',
      'evt-window-session-30',
    ])
    expect(page.hasMore).toBe(true)
  })

  it('returns all session events in chronological order for complete history hydration', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({
        id: `evt-all-${i}`,
        sessionId: 'sess-1',
        eventType: 'assistant_message',
        eventJson: JSON.stringify({ seq: i, content: `chunk-${i}` }),
      })
    }

    const events = repo.queryAllBySession('sess-1')

    expect(events.map((event) => JSON.parse(event.event_json).seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('should filter by event type', () => {
    repo.insert({
      id: 'evt-1',
      sessionId: 'sess-1',
      eventType: 'user_message',
      eventJson: '{}',
    })
    repo.insert({
      id: 'evt-2',
      sessionId: 'sess-1',
      eventType: 'tool_call',
      eventJson: '{}',
    })

    const userMessages = repo.queryBySession({ sessionId: 'sess-1', eventType: 'user_message' })
    expect(userMessages.events).toHaveLength(1)
    expect(userMessages.events[0]!.event_type).toBe('user_message')
  })

  it('should delete session events in bounded batches', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({
        id: `evt-delete-${i}`,
        sessionId: 'sess-1',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: i }),
      })
    }

    expect(repo.deleteBySessionBatch('sess-1', 2)).toBe(2)
    expect(repo.countBySession('sess-1')).toBe(3)
    expect(repo.deleteBySessionBatch('sess-1', 10)).toBe(3)
    expect(repo.countBySession('sess-1')).toBe(0)
  })

  it('should delete orphaned session events in bounded batches', () => {
    const sessionRepo = new SessionRepository(db)
    sessionRepo.create({
      id: 'sess-live',
      kind: 'agent',
      title: 'Live',
      status: 'idle',
      projectId: 'default',
    })
    repo.insert({
      id: 'evt-live',
      sessionId: 'sess-live',
      eventType: 'user_message',
      eventJson: JSON.stringify({ seq: 1 }),
    })
    for (let i = 0; i < 3; i++) {
      repo.insert({
        id: `evt-orphan-${i}`,
        sessionId: 'sess-missing',
        eventType: 'user_message',
        eventJson: JSON.stringify({ seq: i }),
      })
    }

    expect(repo.deleteOrphanedSessionEventsBatch(2)).toBe(2)
    expect(repo.countBySession('sess-missing')).toBe(1)
    expect(repo.deleteOrphanedSessionEventsBatch(10)).toBe(1)
    expect(repo.countBySession('sess-missing')).toBe(0)
    expect(repo.countBySession('sess-live')).toBe(1)
  })
})
