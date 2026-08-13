/**
 * @module event-search.test
 *
 * 验证会话内容搜索的 FTS5 链路：
 *   - insert 同步写索引，deleteBySession 触发器清索引
 *   - searchByContent 走 MATCH + snippet，返回纯文本而非 JSON 乱码
 *   - segmentCjk CJK 预分词与查询侧一致
 *   - FTS 不可用（迁移未应用）时回落到 LIKE 全表扫描
 *   - backfillSearchIndexIfNeeded 幂等，能给存量事件补建索引
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { EventRepository, extractSearchableEventBody } from './event.repository.js'
import type { InsertEventParams } from './event.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('EventRepository — 会话内容搜索 (FTS5)', () => {
  let db: SparkDatabase
  let repo: EventRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-eventsearch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new EventRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function userMessage(sessionId: string, content: string, id?: string): InsertEventParams {
    return {
      id: id ?? `evt-${Math.random().toString(36).slice(2)}`,
      sessionId,
      eventType: 'user_message',
      eventJson: JSON.stringify({ content, mode: 'complete' }),
    }
  }

  function assistantMessage(sessionId: string, content: string, id?: string): InsertEventParams {
    return {
      id: id ?? `evt-${Math.random().toString(36).slice(2)}`,
      sessionId,
      eventType: 'assistant_message',
      eventJson: JSON.stringify({ content, mode: 'complete' }),
    }
  }

  it('FTS 搜索命中写入的用户消息，并返回纯文本 snippet（不是 JSON 乱码）', () => {
    repo.insert(userMessage('s1', '请帮我把登录页面改成深色主题'))
    repo.insert(userMessage('s2', '另一段无关内容，不应该命中'))

    const results = repo.searchByContent('深色主题', 10)

    expect(results.map((r) => r.sessionId)).toEqual(['s1'])
    // snippet 必须是纯文本，不能含 `"content":` 这种 JSON 结构噪音
    expect(results[0]!.snippet).not.toContain('"content"')
    // segmentCjk 把 CJK 切成单字带空格的形态存储，snippet 也会带这些空格；
    // 去掉空格后再断言，避免把分词细节固化进断言
    const normalized = results[0]!.snippet.replace(/\s+/g, '')
    expect(normalized).toContain('深色主题')
  })

  it('支持 CJK 多字短语匹配（segmentCjk 写入与查询两侧一致）', () => {
    repo.insert(assistantMessage('s1', '我们正在迁移到 vite 构建工具'))

    // 旧 LIKE 在中文连续片段上能命中，FTS5 unicode61 默认会把整段中文当一个词，
    // 不预分词的话「迁移」这种二字词查不到。这条用例锁住 segmentCjk 的硬约束。
    const results = repo.searchByContent('迁移', 10)
    expect(results.map((r) => r.sessionId)).toEqual(['s1'])
  })

  it('assistant_message 与 user_message 都被索引；流式 delta 不进索引', () => {
    repo.insert(userMessage('s1', 'hello world'))
    repo.insert(assistantMessage('s1', 'world peace reply'))
    // delta 是同一段正文的碎片，索引它们会产生重复命中
    repo.insert({
      id: 'delta-1',
      sessionId: 's1',
      eventType: 'assistant_message',
      eventJson: JSON.stringify({ content: 'world', mode: 'delta' }),
    })

    const results = repo.searchByContent('world', 10)
    // s1 去重后只返回一条（每个 session 保留相关度最高的一条）
    expect(results.filter((r) => r.sessionId === 's1')).toHaveLength(1)
  })

  it('不索引明确隐藏的内部用户消息正文', () => {
    repo.insert({
      ...userMessage('s-hidden', 'scheduled-private-marker'),
      eventJson: JSON.stringify({
        content: 'scheduled-private-marker',
        turnSource: 'scheduled_task',
        userMessageVisibility: 'hidden',
      }),
    })

    expect(repo.searchByContent('scheduled-private-marker', 10)).toEqual([])
    expect(
      extractSearchableEventBody(
        'user_message',
        JSON.stringify({ content: 'secret', userMessageVisibility: 'hidden' }),
      ),
    ).toBeNull()
  })

  it('deleteBySession 同步清除该 session 的索引项（触发器保证）', () => {
    repo.insert(userMessage('s1', 'unique-marker-xyz-to-delete'))
    expect(repo.searchByContent('unique-marker-xyz-to-delete', 10)).toHaveLength(1)

    repo.deleteBySession('s1')

    expect(repo.searchByContent('unique-marker-xyz-to-delete', 10)).toHaveLength(0)
  })

  it('searchByContent 对 % _ 等通配符字面量安全（不再像 LIKE 那样匹配全库）', () => {
    repo.insert(userMessage('s1', '价格是 100% off 的活动'))
    repo.insert(userMessage('s2', '完全无关的内容'))

    // FTS5 的 MATCH 把 % 当字面量；旧 LIKE 会把 % 当通配符匹配全库
    const results = repo.searchByContent('100% off', 10)
    expect(results.map((r) => r.sessionId)).toEqual(['s1'])
    expect(results.some((r) => r.sessionId === 's2')).toBe(false)
  })

  it('空查询 / 仅空白查询返回空结果', () => {
    repo.insert(userMessage('s1', 'some content'))
    expect(repo.searchByContent('', 10)).toEqual([])
    expect(repo.searchByContent('   ', 10)).toEqual([])
  })

  it('未命中返回空数组', () => {
    repo.insert(userMessage('s1', '完全无关的内容'))
    expect(repo.searchByContent('绝对查不到的关键词', 10)).toEqual([])
  })

  it('backfillSearchIndexIfNeeded 给存量事件补建索引（迁移后第一次启动的场景）', async () => {
    // 模拟「061 应用前就有存量事件」：直接写主表，绕过 FTS 同步
    db.raw
      .prepare(
        `INSERT INTO agent_events (id, session_id, run_id, turn_id, event_type, event_json)
         VALUES (?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        'legacy-1',
        's-legacy',
        'user_message',
        JSON.stringify({ content: '一段历史会话里的重要内容', mode: 'complete' }),
      )

    // 回填前：FTS 查不到（索引里没有这条）
    expect(repo.searchByContent('历史会话', 10)).toEqual([])

    // 回填：返回本次处理的事件数（>0 表示真的做了工作）
    const processed = await repo.backfillSearchIndexIfNeeded()
    expect(processed).toBe(1)
    // 幂等：再调一次返回 0（标记已写入，跳过全部工作）
    const secondRun = await repo.backfillSearchIndexIfNeeded()
    expect(secondRun).toBe(0)

    const results = repo.searchByContent('历史会话', 10)
    expect(results.map((r) => r.sessionId)).toEqual(['s-legacy'])
  })

  it('extractSearchableEventBody 只返回对话正文的纯文本', () => {
    expect(
      extractSearchableEventBody(
        'user_message',
        JSON.stringify({ content: 'hi', mode: 'complete' }),
      ),
    ).toBe('hi')

    // 工具事件不参与检索
    expect(extractSearchableEventBody('tool_call', JSON.stringify({ input: {} }))).toBeNull()
    // delta 不参与检索
    expect(
      extractSearchableEventBody(
        'assistant_message',
        JSON.stringify({ content: 'frag', mode: 'delta' }),
      ),
    ).toBeNull()
    // 空 content 不参与
    expect(
      extractSearchableEventBody(
        'user_message',
        JSON.stringify({ content: '   ', mode: 'complete' }),
      ),
    ).toBeNull()
    // 坏 JSON 不抛
    expect(extractSearchableEventBody('user_message', '{bad')).toBeNull()
  })
})

describe('EventRepository — FTS 不可用时降级到 LIKE', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-eventsearch-nofallback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('061 未应用时（FTS 表不存在）走 LIKE 兜底，搜索仍能工作', () => {
    // 模拟「用户从旧版本升级，迁移建表尚未完成」：跑全部迁移后手动 drop FTS 相关表
    const db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    db.raw.exec(`DROP TRIGGER IF EXISTS agent_events_fts_after_delete`)
    db.raw.exec(`DROP TABLE IF EXISTS agent_event_fts`)
    db.raw.exec(`DROP TABLE IF EXISTS agent_event_fts_map`)

    const repo = new EventRepository(db)
    repo.insert({
      id: 'evt-1',
      sessionId: 's1',
      eventType: 'user_message',
      eventJson: JSON.stringify({ content: '降级路径下也能搜到我', mode: 'complete' }),
    })

    const results = repo.searchByContent('降级路径', 10)
    expect(results.map((r) => r.sessionId)).toEqual(['s1'])

    db.close()
  })

  it('LIKE 兜底不会暴露明确隐藏的内部用户消息', () => {
    const db = new SparkDatabase(join(testDir, 'hidden-fallback.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    db.raw.exec(`DROP TRIGGER IF EXISTS agent_events_fts_after_delete`)
    db.raw.exec(`DROP TABLE IF EXISTS agent_event_fts`)
    db.raw.exec(`DROP TABLE IF EXISTS agent_event_fts_map`)

    const repo = new EventRepository(db)
    repo.insert({
      id: 'hidden-event',
      sessionId: 'hidden-session',
      eventType: 'user_message',
      eventJson: JSON.stringify({
        content: 'fallback-private-marker',
        turnSource: 'scheduled_task',
        userMessageVisibility: 'hidden',
      }),
    })

    expect(repo.searchByContent('fallback-private-marker', 10)).toEqual([])

    db.close()
  })
})
