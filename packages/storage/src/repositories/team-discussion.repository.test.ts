/**
 * TeamDiscussionRepository 单元测试
 *
 * 覆盖：createDiscussion / advanceRound / conclude / appendMessage / renderThreadForPrompt
 * 以及 clampMaxRounds 硬上限、findActiveBySession、deleteBySession 等基础路径。
 *
 * 验证迁移 044 与 FK 约束（session_id → sessions.id；discussion_id → team_discussions.id）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import {
  TeamDiscussionRepository,
  DEFAULT_MAX_DISCUSSION_ROUNDS,
  HARD_MAX_DISCUSSION_ROUNDS,
  DEFAULT_THREAD_TOKEN_BUDGET,
  THREAD_MESSAGE_PREVIEW_CHARS,
} from './team-discussion.repository.js'
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

describe('TeamDiscussionRepository', () => {
  let db: SparkDatabase
  let sessions: SessionRepository
  let repo: TeamDiscussionRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-disc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    sessions = new SessionRepository(db)
    repo = new TeamDiscussionRepository(db)
    // FK: team_discussions.session_id → sessions.id，先建 session
    sessions.create({
      id: 'sess-1',
      kind: 'chat',
      title: 'Team Session',
      status: 'idle',
      projectId: 'proj-1',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  // ─── createDiscussion ───────────────────────────────────────────────────

  it('creates an active discussion with default round 0 and clamped maxRounds', () => {
    const row = repo.createDiscussion({
      id: 'disc-1',
      sessionId: 'sess-1',
      hostAgentId: 'host-agent',
      maxRounds: 6,
      topic: 'brainstorm feature X',
    })

    expect(row.id).toBe('disc-1')
    expect(row.state).toBe('active')
    expect(row.round_index).toBe(0)
    expect(row.max_rounds).toBe(6)
    expect(row.topic).toBe('brainstorm feature X')
    expect(row.ended_at).toBeNull()
  })

  it('clamps maxRounds to [1, HARD_MAX_DISCUSSION_ROUNDS]', () => {
    const tooSmall = repo.createDiscussion({
      id: 'disc-min',
      sessionId: 'sess-1',
      hostAgentId: 'h',
      maxRounds: 0,
    })
    expect(tooSmall.max_rounds).toBe(1)

    const tooBig = repo.createDiscussion({
      id: 'disc-max',
      sessionId: 'sess-1',
      hostAgentId: 'h',
      maxRounds: 9999,
    })
    expect(tooBig.max_rounds).toBe(HARD_MAX_DISCUSSION_ROUNDS)
  })

  it('clampMaxRounds static helper returns defaults for invalid input', () => {
    expect(TeamDiscussionRepository.clampMaxRounds(undefined)).toBe(DEFAULT_MAX_DISCUSSION_ROUNDS)
    expect(TeamDiscussionRepository.clampMaxRounds(null)).toBe(DEFAULT_MAX_DISCUSSION_ROUNDS)
    expect(TeamDiscussionRepository.clampMaxRounds(NaN)).toBe(DEFAULT_MAX_DISCUSSION_ROUNDS)
    expect(TeamDiscussionRepository.clampMaxRounds(7)).toBe(7)
    expect(TeamDiscussionRepository.clampMaxRounds(100)).toBe(HARD_MAX_DISCUSSION_ROUNDS)
  })

  // ─── findActiveBySession / listBySession ─────────────────────────────────

  it('finds the active discussion for a session (newest)', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'h', maxRounds: 6 })
    repo.createDiscussion({ id: 'd2', sessionId: 'sess-1', hostAgentId: 'h', maxRounds: 6 })
    // 收尾 d2，d1 仍是 active 但更旧——应返回 d1
    repo.conclude('d2', { reason: 'concluded' })
    // 因为 d2 已 conclude，应当找不到 active？不对：d1 仍 active
    const active = repo.findActiveBySession('sess-1')
    expect(active?.id).toBe('d1')
  })

  it('returns null when no active discussion exists', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'h', maxRounds: 6 })
    repo.conclude('d1', { reason: 'concluded' })
    expect(repo.findActiveBySession('sess-1')).toBeNull()
  })

  it('lists discussions by session newest first', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'h', maxRounds: 6 })
    repo.createDiscussion({ id: 'd2', sessionId: 'sess-1', hostAgentId: 'h', maxRounds: 6 })
    const list = repo.listBySession('sess-1')
    expect(list.map((d) => d.id)).toEqual(['d2', 'd1'])
  })

  // ─── appendMessage / listMessages / countMessages ───────────────────────

  it('appends messages and lists them oldest-first', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })

    repo.appendMessage({
      id: 'm1',
      discussionId: 'd1',
      senderAgentId: 'host',
      roundIndex: 0,
      kind: 'host_dispatch',
      content: 'please analyze',
    })
    repo.appendMessage({
      id: 'm2',
      discussionId: 'd1',
      senderAgentId: 'alice',
      roundIndex: 0,
      kind: 'member_reply',
      content: 'done, looks good',
    })

    const list = repo.listMessages('d1')
    expect(list.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(list[1]!.target_agent_id).toBeNull() // 缺省 = 广播
    expect(repo.countMessages('d1')).toBe(2)
  })

  it('appends a peer_message with a target and persists it', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'm1',
      discussionId: 'd1',
      senderAgentId: 'alice',
      targetAgentId: 'bob',
      roundIndex: 1,
      kind: 'peer_message',
      content: '@bob what do you think?',
      dispatchId: 'disp-9',
    })
    const m = repo.findMessageById('m1')!
    expect(m.kind).toBe('peer_message')
    expect(m.target_agent_id).toBe('bob')
    expect(m.dispatch_id).toBe('disp-9')
    expect(m.delivery).toBeNull()
  })

  it('persists peer_message delivery for async notes', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'note-1',
      discussionId: 'd1',
      senderAgentId: 'alice',
      targetAgentId: 'bob',
      roundIndex: 1,
      kind: 'peer_message',
      delivery: 'note',
      content: 'FYI for later',
    })
    const m = repo.findMessageById('note-1')!
    expect(m.delivery).toBe('note')
    expect(m.target_agent_id).toBe('bob')
  })

  // ─── advanceRound ───────────────────────────────────────────────────────

  it('advances the round and writes a round_summary message', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })

    const r1 = repo.advanceRound('d1', 'round 1 done: decided X', 'rs-1')
    expect(r1).not.toBeNull()
    expect(r1!.discussion.round_index).toBe(1)
    expect(r1!.summaryMessage).not.toBeNull()
    expect(r1!.summaryMessage!.kind).toBe('round_summary')
    expect(r1!.summaryMessage!.content).toContain('decided X')

    // round_summary 应该也能在 listMessages 里看到
    const all = repo.listMessages('d1')
    expect(all.find((m) => m.id === 'rs-1')).toBeDefined()
  })

  it('refuses to advance beyond max_rounds (hard ceiling)', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 2 })
    expect(repo.advanceRound('d1', 'r1', 'rs-1')).not.toBeNull()
    expect(repo.advanceRound('d1', 'r2', 'rs-2')).not.toBeNull()
    // 第三轮超出 max=2，应被拒
    expect(repo.advanceRound('d1', 'r3', 'rs-3')).toBeNull()
    expect(repo.getById('d1')!.round_index).toBe(2)
  })

  it('refuses to advance a non-active or missing discussion', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.conclude('d1', { reason: 'concluded' })
    expect(repo.advanceRound('d1', 'should fail', 'rs-x')).toBeNull()
    expect(repo.advanceRound('missing', 'should fail', 'rs-y')).toBeNull()
  })

  it('advanceRound with empty summary creates no round_summary row', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    const r = repo.advanceRound('d1', '', 'rs-1')
    expect(r!.discussion.round_index).toBe(1)
    expect(r!.summaryMessage).toBeNull()
    expect(repo.findMessageById('rs-1')).toBeNull()
  })

  // ─── conclude ───────────────────────────────────────────────────────────

  it('concludes an active discussion with the right state mapping', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })

    const concluded = repo.conclude('d1', { reason: 'concluded' })
    expect(concluded!.state).toBe('concluded')
    expect(concluded!.ended_at).not.toBeNull()

    // 二次 conclude 是 no-op，仍返回当前行
    const again = repo.conclude('d1', { reason: 'concluded' })
    expect(again!.state).toBe('concluded')
  })

  it('cancel maps to state=canceled', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    const canceled = repo.conclude('d1', { reason: 'canceled' })
    expect(canceled!.state).toBe('canceled')

    repo.createDiscussion({ id: 'd2', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 1 })
    const maxHit = repo.conclude('d2', { reason: 'max_rounds' })
    expect(maxHit!.state).toBe('canceled')
  })

  it('conclude on missing discussion returns null', () => {
    expect(repo.conclude('missing', { reason: 'concluded' })).toBeNull()
  })

  // ─── renderThreadForPrompt ─────────────────────────────────────────────

  it('returns empty string for empty thread', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    expect(repo.renderThreadForPrompt('d1')).toBe('')
  })

  it('renders recent messages in chronological order', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'm1',
      discussionId: 'd1',
      senderAgentId: 'host',
      roundIndex: 0,
      kind: 'host_dispatch',
      content: 'please analyze',
    })
    repo.appendMessage({
      id: 'm2',
      discussionId: 'd1',
      senderAgentId: 'alice',
      targetAgentId: 'bob',
      roundIndex: 0,
      kind: 'peer_message',
      content: '@bob thoughts?',
    })

    const rendered = repo.renderThreadForPrompt('d1', 200)
    // 倒序累加后 unshift 回正序：m1 在前 m2 在后
    const m1Idx = rendered.indexOf('please analyze')
    const m2Idx = rendered.indexOf('@bob thoughts?')
    expect(m1Idx).toBeGreaterThan(-1)
    expect(m2Idx).toBeGreaterThan(-1)
    expect(m1Idx).toBeLessThan(m2Idx)
    // 定向消息应包含 → bob
    expect(rendered).toContain('→ bob')
    // 广播消息应包含 → all
    expect(rendered).toContain('→ all')
  })

	  it('keeps all round_summaries and truncates older non-summary messages when over budget', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    // 写入大量非 summary 消息 + 一个 round_summary
    for (let i = 0; i < 30; i++) {
      repo.appendMessage({
        id: `m${i}`,
        discussionId: 'd1',
        senderAgentId: 'alice',
        roundIndex: 0,
        kind: 'member_reply',
        content: `message number ${i} with some padding text to make it longer`,
      })
    }
    repo.advanceRound('d1', 'round 1 concluded with decision Y', 'rs-1')

    const rendered = repo.renderThreadForPrompt('d1', 100) // 极小预算强制截断
    // round_summary 必须保留（它是低成本锚点）
    expect(rendered).toContain('Round 1 summary')
    expect(rendered).toContain('decision Y')
    // 应有截断提示
    expect(rendered).toContain('[older messages truncated]')
  })

  it('truncates a single over-long message to a preview instead of dropping it (bug: 成员看不到超长消息)', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    // 单条自我介绍级别的超长消息（远超预览上限）
    const huge = 'A'.repeat(THREAD_MESSAGE_PREVIEW_CHARS + 5000)
    repo.appendMessage({
      id: 'm-huge',
      discussionId: 'd1',
      senderAgentId: 'backend',
      roundIndex: 0,
      kind: 'peer_message',
      content: huge,
    })

    // 用默认预算渲染：旧实现会因单条超预算直接 break → 成员什么都看不到；
    // 新实现应给出截断预览（含省略提示 + team_thread_read 指引），且长度被预览上限约束住。
    const rendered = repo.renderThreadForPrompt('d1')
    expect(rendered).toContain('backend')
    expect(rendered).toContain('省略')
    expect(rendered).toContain('team_thread_read')
    // 不应把整条 5000+ 字塞进来
    expect(rendered.length).toBeLessThan(huge.length)
    expect(rendered).toContain('A'.repeat(200)) // 至少能看到开头正文
  })

  it('listPeerMessagesSince returns only peer_messages written after the given timestamp', async () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'old-1',
      discussionId: 'd1',
      senderAgentId: 'host',
      roundIndex: 0,
      kind: 'host_dispatch',
      content: 'kickoff',
    })
    const since = new Date().toISOString()
    await new Promise((r) => setTimeout(r, 5))
    repo.appendMessage({
      id: 'new-peer',
      discussionId: 'd1',
      senderAgentId: 'backend',
      roundIndex: 0,
      kind: 'peer_message',
      content: 'broadcast intro',
    })
    repo.appendMessage({
      id: 'new-reply',
      discussionId: 'd1',
      senderAgentId: 'backend',
      roundIndex: 0,
      kind: 'member_reply',
      content: 'already posted',
    })

    const fresh = repo.listPeerMessagesSince('d1', since)
    // 只回 peer_message（member_reply 通过回复链返回，不重复），且只回 since 之后的
    expect(fresh.map((m) => m.id)).toEqual(['new-peer'])
  })

  it('queryMessages paginates and filters by round and sender with a correct total', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    for (let i = 0; i < 5; i++) {
      repo.appendMessage({
        id: `r0-${i}`,
        discussionId: 'd1',
        senderAgentId: i % 2 === 0 ? 'alice' : 'bob',
        roundIndex: 0,
        kind: 'peer_message',
        content: `r0 msg ${i}`,
      })
    }
    repo.appendMessage({
      id: 'r1-0',
      discussionId: 'd1',
      senderAgentId: 'alice',
      roundIndex: 1,
      kind: 'peer_message',
      content: 'r1 msg',
    })

    // 分页
    const page1 = repo.queryMessages({ discussionId: 'd1', limit: 2, offset: 0 })
    expect(page1.total).toBe(6)
    expect(page1.messages).toHaveLength(2)
    expect(page1.messages[0]!.id).toBe('r0-0') // asc 默认最早优先

    // 按轮次过滤
    const round1 = repo.queryMessages({ discussionId: 'd1', roundIndex: 1 })
    expect(round1.total).toBe(1)
    expect(round1.messages[0]!.id).toBe('r1-0')

    // 按发送者过滤（alice: r0-0, r0-2, r0-4, r1-0 = 4 条）
    const fromAlice = repo.queryMessages({ discussionId: 'd1', senderAgentId: 'alice' })
    expect(fromAlice.total).toBe(4)

    // 最新优先
    const desc = repo.queryMessages({ discussionId: 'd1', order: 'desc', limit: 1 })
    expect(desc.messages[0]!.id).toBe('r1-0')
  })

  it('renders targeted notes for the viewer with [NOTE FOR YOU] at the end only for that viewer', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'm1',
      discussionId: 'd1',
      senderAgentId: 'alice',
      targetAgentId: 'bob',
      roundIndex: 0,
      kind: 'peer_message',
      delivery: 'note',
      content: 'Bob should check this later',
    })
    repo.appendMessage({
      id: 'm2',
      discussionId: 'd1',
      senderAgentId: 'host',
      targetAgentId: 'bob',
      roundIndex: 0,
      kind: 'host_dispatch',
      content: 'regular work item',
    })

    const bob = repo.renderThreadForPrompt('d1', 200, 'bob')
    expect(bob).toContain('[Notes For You]')
    expect(bob).toContain('[NOTE FOR YOU] [R0] alice → bob: Bob should check this later')
    expect(bob.trim().endsWith('Bob should check this later')).toBe(true)

    const alice = repo.renderThreadForPrompt('d1', 200, 'alice')
    expect(alice).not.toContain('[NOTE FOR YOU]')
    expect(alice).toContain('alice → bob: Bob should check this later')
  })

  it('deleteBySession cascades thread messages via FK', () => {
    repo.createDiscussion({ id: 'd1', sessionId: 'sess-1', hostAgentId: 'host', maxRounds: 6 })
    repo.appendMessage({
      id: 'm1',
      discussionId: 'd1',
      senderAgentId: 'host',
      roundIndex: 0,
      kind: 'host_dispatch',
      content: 'x',
    })
    expect(repo.countMessages('d1')).toBe(1)

    const removed = repo.deleteBySession('sess-1')
    expect(removed).toBe(1)
    // 级联删除：线程消息应一并消失
    expect(repo.countMessages('d1')).toBe(0)
    expect(repo.getById('d1')).toBeNull()
  })

  it('respects the default token budget constant', () => {
    expect(DEFAULT_MAX_DISCUSSION_ROUNDS).toBe(6)
    expect(HARD_MAX_DISCUSSION_ROUNDS).toBe(20)
    // 预算从 1500 提到 6000：长消息场景下别一条就吃光
    expect(DEFAULT_THREAD_TOKEN_BUDGET).toBe(6000)
    expect(THREAD_MESSAGE_PREVIEW_CHARS).toBeGreaterThan(0)
  })
})
