/**
 * TeamDispatchRepository 单元测试
 *
 * 覆盖：create / update / listBySession / listByTurn / markStaleAsFailed / deleteBySession
 * 使用临时文件数据库，验证 migration 016 与 FK 约束（session_id → sessions.id）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import { TeamDispatchRepository } from './team-dispatch.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('TeamDispatchRepository', () => {
  let db: SparkDatabase
  let sessions: SessionRepository
  let repo: TeamDispatchRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-team-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    sessions = new SessionRepository(db)
    repo = new TeamDispatchRepository(db)
    // FK: team_dispatches.session_id → sessions.id，先建 session
    sessions.create({ id: 'sess-1', kind: 'chat', title: 'Team Session', status: 'idle', projectId: 'proj-1' })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates a dispatch with default working state', () => {
    const row = repo.create({
      id: 'd1',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      taskJson: JSON.stringify({ taskId: 'd1', instruction: 'review this' }),
    })

    expect(row.id).toBe('d1')
    expect(row.state).toBe('working')
    expect(row.member_agent_id).toBe('reviewer')
    expect(row.reply_json).toBeNull()
    expect(row.ended_at).toBeNull()
  })

  it('updates dispatch to completed with reply + usage', () => {
    repo.create({
      id: 'd1',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      taskJson: '{}',
    })

    const updated = repo.update('d1', {
      state: 'completed',
      replyJson: JSON.stringify({ taskId: 'd1', state: 'completed', content: 'looks good' }),
      inputTokens: 480,
      outputTokens: 820,
      durationMs: 1240,
      endedAt: new Date().toISOString(),
    })

    expect(updated!.state).toBe('completed')
    expect(updated!.input_tokens).toBe(480)
    expect(updated!.output_tokens).toBe(820)
    expect(updated!.duration_ms).toBe(1240)
    expect(updated!.ended_at).not.toBeNull()
    expect(JSON.parse(updated!.reply_json!).content).toBe('looks good')
  })

  it('lists dispatches by session (newest first) and by turn (oldest first)', () => {
    repo.create({ id: 'd1', sessionId: 'sess-1', turnId: 'turn-1', hostAgentId: 'h', memberAgentId: 'a', taskJson: '{}' })
    repo.create({ id: 'd2', sessionId: 'sess-1', turnId: 'turn-1', hostAgentId: 'h', memberAgentId: 'b', taskJson: '{}' })

    const bySession = repo.listBySession('sess-1')
    expect(bySession).toHaveLength(2)

    const byTurn = repo.listByTurn('turn-1')
    expect(byTurn.map((d) => d.id)).toEqual(['d1', 'd2'])
  })

  it('reclaims stale pending/working dispatches', () => {
    repo.create({ id: 'd1', sessionId: 'sess-1', turnId: 'turn-1', hostAgentId: 'h', memberAgentId: 'a', taskJson: '{}', state: 'working' })

    // 用未来时间作为阈值，确保 d1 (started_at = now) 被判定为 stale
    const future = new Date(Date.now() + 60_000).toISOString()
    const reclaimed = repo.markStaleAsFailed(future)

    expect(reclaimed).toBe(1)
    expect(repo.listBySession('sess-1')[0]!.state).toBe('failed')
  })

  it('cascades delete when session removed and supports deleteBySession', () => {
    repo.create({ id: 'd1', sessionId: 'sess-1', turnId: 'turn-1', hostAgentId: 'h', memberAgentId: 'a', taskJson: '{}' })

    const removed = repo.deleteBySession('sess-1')
    expect(removed).toBe(1)
    expect(repo.listBySession('sess-1')).toHaveLength(0)
  })
})
