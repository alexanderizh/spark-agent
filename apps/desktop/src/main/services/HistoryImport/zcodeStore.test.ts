/**
 * ZCode store 单测 —— 用 better-sqlite3 :memory: 重建 session/message/part 三表，
 * 覆盖 listZcodeSessions / loadZcodeMessages / lookupZcodeMessageMeta /
 * getZcodeSessionInfo / assertZcodeSchema 的查询与反序列化行为。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  assertZcodeSchema,
  getZcodeSessionInfo,
  listZcodeSessions,
  loadZcodeMessages,
  lookupZcodeMessageMeta,
  openZcodeDb,
} from './zcodeStore.js'

function createFixtureDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      parent_id text,
      directory text,
      title text,
      title_source text,
      revert text,
      task_type text DEFAULT 'interactive',
      time_created integer,
      time_updated integer
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text,
      time_created integer,
      time_updated integer,
      data text,
      sequence integer
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text,
      session_id text,
      time_created integer,
      time_updated integer,
      data text,
      sequence integer
    );
  `)

  const insertSession = db.prepare(
    `INSERT INTO session (id, directory, title, title_source, revert, task_type, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insertSession.run(
    'sess_main',
    'D:\\proj',
    '主会话标题',
    'generated',
    JSON.stringify({
      kind: 'conversation_rewind',
      targetMessageID: 'm2',
      createdMessageID: 'm5',
      keptMessageIDs: ['m0', 'm1'],
    }),
    'interactive',
    1000,
    7000,
  )
  insertSession.run(
    'sess_side',
    'D:\\proj',
    '划词侧聊',
    'first_input',
    null,
    'selection_side_chat',
    2000,
    3000,
  )
  insertSession.run('sess_sub', 'D:\\proj', null, null, null, 'subagent_child', 1500, 1600)
  insertSession.run('sess_empty', 'D:\\other', null, null, null, 'interactive', 500, 600)

  const insertMessage = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const rows: Array<{ id: string; seq: number; created: number; role: string }> = [
    { id: 'm0', seq: 0, created: 1000, role: 'user' },
    { id: 'm1', seq: 1, created: 2000, role: 'assistant' },
    { id: 'm2', seq: 2, created: 3000, role: 'user' },
    { id: 'm5', seq: 3, created: 4000, role: 'user' },
  ]
  for (const r of rows) {
    insertMessage.run(
      r.id,
      'sess_main',
      r.created,
      r.created,
      JSON.stringify({ role: r.role, time: { created: r.created } }),
      r.seq,
    )
  }

  const insertPart = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insertPart.run(
    'p0',
    'm0',
    'sess_main',
    1000,
    1000,
    JSON.stringify({ type: 'text', text: '你好' }),
    0,
  )
  insertPart.run(
    'p1',
    'm1',
    'sess_main',
    2000,
    2000,
    JSON.stringify({
      type: 'tool',
      callID: 'call_1',
      tool: 'Bash',
      state: { status: 'completed', input: {}, output: 'ok' },
    }),
    0,
  )
  // 故意乱序插入，验证按 sequence 排序
  insertPart.run(
    'p3',
    'm1',
    'sess_main',
    2100,
    2100,
    JSON.stringify({ type: 'text', text: '第二块' }),
    2,
  )
  insertPart.run(
    'p2',
    'm1',
    'sess_main',
    2050,
    2050,
    JSON.stringify({ type: 'reasoning', text: '思考' }),
    1,
  )
  return db
}

describe('zcodeStore', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createFixtureDb()
  })

  it('listZcodeSessions 只返回主线程会话（interactive + selection_side_chat），按活跃倒序', () => {
    const sessions = listZcodeSessions(db)
    const ids = sessions.map((s) => s.id)
    expect(ids).toEqual(['sess_main', 'sess_side', 'sess_empty'])
    expect(ids).not.toContain('sess_sub')

    const main = sessions.find((s) => s.id === 'sess_main')
    expect(main).toMatchObject({
      directory: 'D:\\proj',
      title: '主会话标题',
      messageCount: 4,
      timeCreated: 1000,
      timeUpdated: 7000,
    })
    expect(main?.revert).toMatchObject({ targetMessageID: 'm2', createdMessageID: 'm5' })

    // 空会话也在列表中（messageCount=0），由 Service 层过滤
    expect(sessions.find((s) => s.id === 'sess_empty')?.messageCount).toBe(0)
  })

  it('loadZcodeMessages 按 sequence 排序消息与 part，并反序列化 JSON', () => {
    const messages = loadZcodeMessages(db, 'sess_main')
    expect(messages.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm5'])
    expect(messages.map((m) => m.sequence)).toEqual([0, 1, 2, 3])

    const m1 = messages.find((m) => m.id === 'm1')
    expect(m1?.data.role).toBe('assistant')
    expect(m1?.parts.map((p) => p.type)).toEqual(['tool', 'reasoning', 'text'])
    expect(m1?.parts[0]).toMatchObject({ callID: 'call_1', tool: 'Bash' })

    expect(loadZcodeMessages(db, 'sess_missing')).toEqual([])
  })

  it('lookupZcodeMessageMeta 点查 sequence 与时间', () => {
    const metas = lookupZcodeMessageMeta(db, 'sess_main', ['m2', 'm5', 'm0'])
    expect(metas.get('m2')).toEqual({ sequence: 2, timeCreated: 3000 })
    expect(metas.get('m5')).toEqual({ sequence: 3, timeCreated: 4000 })
    expect(metas.size).toBe(3)
    expect(lookupZcodeMessageMeta(db, 'sess_main', [])).toEqual(new Map())
  })

  it('getZcodeSessionInfo 返回 title/directory/revert', () => {
    const info = getZcodeSessionInfo(db, 'sess_main')
    expect(info).toMatchObject({ title: '主会话标题', directory: 'D:\\proj' })
    expect(info?.revert).toMatchObject({ targetMessageID: 'm2' })
    expect(getZcodeSessionInfo(db, 'sess_side')?.revert).toBeNull()
    expect(getZcodeSessionInfo(db, 'nope')).toBeNull()
  })

  it('assertZcodeSchema：缺表时抛错', () => {
    const bare = new Database(':memory:')
    bare.exec('CREATE TABLE session (id text)')
    expect(() => assertZcodeSchema(bare)).toThrow(/schema 版本不兼容/)
    expect(() => assertZcodeSchema(db)).not.toThrow()
  })

  it('openZcodeDb：文件不存在时抛错（上层置 available:false）', () => {
    expect(() => openZcodeDb('Z:/definitely/not/exist/db.sqlite')).toThrow()
  })
})
