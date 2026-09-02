/**
 * zcodeCliStore 单测 —— 用临时 sqlite 库模拟 zcode CLI 的 session/message/part 三表，
 * 覆盖：会话枚举（hidden/synthetic 过滤计数）、单会话重组（parts 分组排序、
 * timelineType 噪声剔除）、库不存在返回 null。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { listZcodeCliSessions, loadZcodeCliSession, loadZcodeCliSessionText } from './zcodeCliStore.js'

const T0 = 1778100000000

function createFixtureDb(dbPath: string): void {
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT,
      time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
  `)
  const insertSession = db.prepare(
    'INSERT INTO session (id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
  )
  const insertMessage = db.prepare(
    'INSERT INTO message (id, session_id, data, sequence) VALUES (?, ?, ?, ?)',
  )
  const insertPart = db.prepare(
    'INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?, ?, ?, ?, ?)',
  )

  insertSession.run('sess_a', '/Users/me/proj-a', '修复筛选报错', T0, T0 + 60_000)
  insertSession.run('sess_b', '/Users/me/proj-b', null, T0 + 1000, T0 + 2000)

  // sess_a：1 真实 user + 1 hidden + 1 synthetic + 1 assistant（2 part + 1 timeline 噪声）
  insertMessage.run('m1', 'sess_a', JSON.stringify({ role: 'user', time: { created: T0 } }), 0)
  insertPart.run('p1', 'm1', 'sess_a', JSON.stringify({ type: 'text', text: '查询任务列表' }), 0)
  insertMessage.run(
    'm2',
    'sess_a',
    JSON.stringify({ role: 'user', time: { created: T0 + 1 }, semantics: { uiVisibility: 'hidden' } }),
    1,
  )
  insertPart.run('p2', 'm2', 'sess_a', JSON.stringify({ type: 'text', text: 'todo' }), 0)
  insertMessage.run(
    'm3',
    'sess_a',
    JSON.stringify({ role: 'user', time: { created: T0 + 2 }, synthetic: true }),
    2,
  )
  insertPart.run('p3', 'm3', 'sess_a', JSON.stringify({ type: 'text', text: '<task-notification>x' }), 0)
  insertMessage.run(
    'm4',
    'sess_a',
    JSON.stringify({
      role: 'assistant',
      time: { created: T0 + 3 },
      modelID: 'GLM-5.3',
      providerID: 'builtin:bigmodel-coding-plan',
    }),
    3,
  )
  insertPart.run('p4', 'm4', 'sess_a', JSON.stringify({ timelineType: 'model_change', display: 'separator' }), 0)
  insertPart.run('p5', 'm4', 'sess_a', JSON.stringify({ type: 'reasoning', text: '先查条件' }), 1)
  insertPart.run('p6', 'm4', 'sess_a', JSON.stringify({ type: 'text', text: '缺少默认状态' }), 2)

  // sess_b：仅 1 条 assistant（计数 1）
  insertMessage.run('m5', 'sess_b', JSON.stringify({ role: 'assistant', time: { created: T0 + 5 } }), 0)
  insertPart.run('p7', 'm5', 'sess_b', JSON.stringify({ type: 'text', text: 'done' }), 0)

  // sess_c：全部消息被过滤（计 0，扫描时应被上层剔除）
  insertSession.run('sess_c', '/Users/me/proj-c', '只有通知', T0, T0)
  insertMessage.run(
    'm6',
    'sess_c',
    JSON.stringify({ role: 'user', time: { created: T0 }, synthetic: true }),
    0,
  )
  insertPart.run('p8', 'm6', 'sess_c', JSON.stringify({ type: 'text', text: '<task-notification>y' }), 0)

  db.close()
}

describe('zcodeCliStore', () => {
  let dir: string
  let dbPath: string

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zcode-cli-store-'))
    dbPath = path.join(dir, 'db.sqlite')
    createFixtureDb(dbPath)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('listZcodeCliSessions：hidden/synthetic 不计入 messageCount', () => {
    const sessions = listZcodeCliSessions(dbPath)
    expect(sessions).not.toBeNull()
    const byId = new Map((sessions ?? []).map((s) => [s.sessionId, s]))
    expect(byId.get('sess_a')).toMatchObject({
      title: '修复筛选报错',
      cwd: '/Users/me/proj-a',
      messageCount: 2,
    })
    expect(byId.get('sess_b')?.messageCount).toBe(1)
    expect(byId.get('sess_c')?.messageCount).toBe(0)
  })

  it('listZcodeCliSessions：库不存在返回 null', () => {
    expect(listZcodeCliSessions(path.join(dir, 'nope.sqlite'))).toBeNull()
  })

  it('loadZcodeCliSession：重组 meta + parts（剔除 timelineType 噪声、按序分组）', () => {
    const payload = loadZcodeCliSession(dbPath, 'sess_a')
    expect(payload).not.toBeNull()
    expect(payload?.meta).toMatchObject({
      sessionId: 'sess_a',
      title: '修复筛选报错',
      cwd: '/Users/me/proj-a',
      modelId: 'GLM-5.3',
      providerId: 'builtin:bigmodel-coding-plan',
    })
    expect(payload?.messages).toHaveLength(4)
    const assistant = payload?.messages[3]
    expect(assistant?.parts).toEqual([
      { type: 'reasoning', text: '先查条件' },
      { type: 'text', text: '缺少默认状态' },
    ])
    // 文本化版本可直接喂给 parser
    const text = loadZcodeCliSessionText(dbPath, 'sess_a')
    expect(typeof text).toBe('string')
    expect(text).toContain('查询任务列表')
  })

  it('loadZcodeCliSession：会话不存在返回 null', () => {
    expect(loadZcodeCliSession(dbPath, 'sess_missing')).toBeNull()
  })
})
