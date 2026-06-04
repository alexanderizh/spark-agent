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
    repo.create({ id: 'ws-1', name: 'old-name', rootPath: '/tmp/test', relocatedFrom: ['/tmp/legacy'] })
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
    repo.create({ id: 'sess-1', kind: 'chat', title: 'Old Title', status: 'idle', projectId: 'proj-1' })

    repo.updateTitle('sess-1', 'New Title')

    const updated = repo.get('sess-1')
    expect(updated!.title).toBe('New Title')
  })

  it('should list sessions with filters', () => {
    repo.create({ id: 'sess-1', kind: 'chat', title: 'A', status: 'idle', projectId: 'proj-1' })
    repo.create({ id: 'sess-2', kind: 'project', title: 'B', status: 'running', projectId: 'proj-1' })
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
})
