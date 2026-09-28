/**
 * HistoryImportService.preview 单测 —— 聚焦 zcode 双通道的 origin 路由：
 *   - cli 通道：filePath 指向 sqlite 库文件，必须传 origin='cli' 才会从库中
 *     重组会话载荷并按 CLI parser 解析（回归：缺 origin 时曾把 sqlite 二进制
 *     当 JSON 文本读入并用 v2 parser 解析，导致预览恒为空）
 *   - desktop 通道：filePath 即 v2 JSON 文件，不传 origin 走 v2 parser
 *
 * preview 与 import 共用 loadRaw + parse(origin) 链路，preview 返回非空即证明
 * import 的 probe 解析同样非空（importOne 以 events.length===0 判定失败）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import type { SparkDatabase } from '@spark/storage'
import { HistoryImportService, type HistoryImportDeps } from './HistoryImportService.js'

const T0 = 1778100000000

function createCliFixtureDb(dbPath: string): void {
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT,
      time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
  `)
  db.prepare(
    'INSERT INTO session (id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
  ).run('sess_a', '/Users/me/proj-a', '修复筛选报错', T0, T0 + 60_000)
  db.prepare('INSERT INTO message (id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run(
    'm1',
    'sess_a',
    JSON.stringify({ role: 'user', time: { created: T0 } }),
    0,
  )
  db.prepare(
    'INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?, ?, ?, ?, ?)',
  ).run('p1', 'm1', 'sess_a', JSON.stringify({ type: 'text', text: '查询任务列表' }), 0)
  db.prepare('INSERT INTO message (id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run(
    'm2',
    'sess_a',
    JSON.stringify({
      role: 'assistant',
      time: { created: T0 + 3 },
      modelID: 'GLM-5.3',
      providerID: 'builtin:bigmodel-coding-plan',
    }),
    1,
  )
  db.prepare(
    'INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?, ?, ?, ?, ?)',
  ).run('p2', 'm2', 'sess_a', JSON.stringify({ type: 'text', text: '缺少默认状态' }), 0)
  db.close()
}

function createV2Fixture(filePath: string): void {
  writeFileSync(
    filePath,
    JSON.stringify({
      meta: {
        taskId: 'task-1',
        title: '桌面会话标题',
        workspacePath: '/Users/me/proj-v2',
        createdAt: T0,
        updatedAt: T0 + 30_000,
        provider: 'glm',
      },
      messages: [
        { role: 'user', content: '帮我看下报错', timestamp: T0 },
        {
          role: 'assistant',
          timestamp: T0 + 10_000,
          parts: [
            { type: 'thought', content: '先想一下' },
            { type: 'content', content: '看日志定位' },
          ],
        },
      ],
    }),
    'utf-8',
  )
}

/** WorkBuddy fixture：projects/<encoded>/<sessionId>.jsonl + workbuddy.db 元数据 */
function createWorkbuddyFixture(root: string): { jsonlPath: string; deletedJsonlPath: string } {
  const projectsDir = path.join(root, '.workbuddy', 'projects', 'Users-me-wb')
  mkdirSync(projectsDir, { recursive: true })
  const lines = (sessionId: string, title: string): string =>
    [
      {
        type: 'message',
        id: `${sessionId}-u1`,
        role: 'user',
        sessionId,
        cwd: '/Users/me/wb-proj',
        timestamp: T0,
        content: [
          {
            type: 'input_text',
            text: `<system-reminder data-role="user-context">ctx</system-reminder>\n<user_query>${title}</user_query>`,
          },
        ],
      },
      {
        type: 'message',
        id: `${sessionId}-a1`,
        role: 'assistant',
        sessionId,
        timestamp: T0 + 1000,
        content: [{ type: 'output_text', text: '收到' }],
      },
      { type: 'custom-title', sessionId, timestamp: T0 + 2000, customTitle: `${title}（标题）` },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')

  const jsonlPath = path.join(projectsDir, 'wb-sess-1.jsonl')
  writeFileSync(jsonlPath, lines('wb-sess-1', '修复导入'), 'utf-8')
  // 已在 WorkBuddy 内删除的会话（仅剩残留 jsonl）：scan 应跳过
  const deletedJsonlPath = path.join(projectsDir, 'wb-sess-deleted.jsonl')
  writeFileSync(deletedJsonlPath, lines('wb-sess-deleted', '已删除会话'), 'utf-8')

  const db = new BetterSqlite3(path.join(root, '.workbuddy', 'workbuddy.db'))
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, cwd TEXT NOT NULL, user_id TEXT NOT NULL,
      title TEXT, custom_title TEXT, status TEXT NOT NULL DEFAULT 'Pending',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
  `)
  const insert = db.prepare(
    'INSERT INTO sessions (id, cwd, user_id, title, custom_title, status, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  insert.run('wb-sess-1', '/Users/me/wb-proj', 'u1', 'db 标题', null, 'Completed', T0, T0, null)
  insert.run(
    'wb-sess-deleted',
    '/Users/me/wb-proj',
    'u1',
    '已删除会话',
    null,
    'Completed',
    T0,
    T0,
    T0 + 50000,
  )
  db.close()

  return { jsonlPath, deletedJsonlPath }
}

/** Qoder fixture：userData/main.sqlite 的 chat_sessions + chat_session_messages */
function createQoderFixture(root: string): string {
  const dir = path.join(root, 'Library', 'Application Support', 'com.qoder.app.stable')
  mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'main.sqlite')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE chat_sessions (
      session_id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
      session_kind TEXT NOT NULL DEFAULT 'standard',
      created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, deleted_at TIMESTAMP
    );
    CREATE TABLE chat_session_messages (
      session_id TEXT NOT NULL, message_id TEXT NOT NULL, turn_id TEXT,
      sequence INTEGER NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed', source TEXT NOT NULL,
      PRIMARY KEY (session_id, message_id)
    );
  `)
  const insertSession = db.prepare(
    'INSERT INTO chat_sessions (session_id, title, cwd, session_kind, created_at, updated_at, archived, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
  )
  insertSession.run(
    'qoder-sess-1',
    '这是什么项目',
    '/Users/me/qoder-proj',
    'standard',
    T0,
    T0 + 600000,
    null,
  )
  // 侧聊与已删除会话：不应出现在导入候选
  insertSession.run('qoder-side', '侧聊', '/Users/me/qoder-proj', 'sideChat', T0, T0, null)
  insertSession.run('qoder-del', '已删除', '/Users/me/qoder-proj', 'standard', T0, T0, T0 + 1000)

  const insertMessage = db.prepare(
    'INSERT INTO chat_session_messages (session_id, message_id, turn_id, sequence, payload_json, status, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  insertMessage.run(
    'qoder-sess-1',
    'm1',
    't1',
    1,
    JSON.stringify({
      id: 'm1',
      role: 'user',
      turnId: 't1',
      text: 'hi，这是什么项目',
      timestamp: '2026-09-29T03:21:46.124Z',
    }),
    'completed',
    'host-projection',
  )
  insertMessage.run(
    'qoder-sess-1',
    'm2',
    't1',
    2,
    JSON.stringify({
      id: 'a1',
      role: 'assistant',
      turnId: 't1',
      text: '整轮汇总',
      timestamp: '2026-09-29T03:21:47.000Z',
      parts: [
        { type: 'thinking', text: '先看结构' },
        {
          type: 'tool',
          tool: {
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
            status: 'completed',
            response: 'total 0',
          },
        },
        { type: 'text', text: '这是一个项目' },
      ],
    }),
    'completed',
    'sdk-projection',
  )
  db.close()
  return dbPath
}

describe('HistoryImportService.preview（zcode origin 路由）', () => {
  let home: string
  let cliDbPath: string
  let v2FilePath: string
  let service: HistoryImportService

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'history-import-preview-'))
    const v2Dir = path.join(home, '.zcode', 'v2', 'sessions', 'hash-a')
    mkdirSync(v2Dir, { recursive: true })
    mkdirSync(path.join(home, '.zcode', 'cli', 'db'), { recursive: true })
    cliDbPath = path.join(home, '.zcode', 'cli', 'db', 'db.sqlite')
    createCliFixtureDb(cliDbPath)
    v2FilePath = path.join(v2Dir, 'task-1.json')
    createV2Fixture(v2FilePath)

    const deps: HistoryImportDeps = {
      db: {} as SparkDatabase,
      resolveProvider: async () => ({
        providerProfileId: 'p1',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-ask',
      }),
      createSession: async () => ({ sessionId: 's1' }),
      homeDir: home,
    }
    service = new HistoryImportService(deps)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('zcode CLI 来源：传 origin=cli 时从 sqlite 重组并返回消息（原缺陷：预览恒为空）', async () => {
    const response = await service.preview('zcode', cliDbPath, 20, 'sess_a', 'cli')
    expect(response.messages.length).toBeGreaterThan(0)
    const userMsg = response.messages.find((m) => m.role === 'user')
    expect(userMsg?.text).toBe('查询任务列表')
    const assistantMsg = response.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.text).toBe('缺少默认状态')
  })

  it('zcode 桌面来源：不传 origin 时按 v2 JSON 文件解析', async () => {
    const response = await service.preview('zcode', v2FilePath, 20, 'task-1')
    expect(response.messages.length).toBeGreaterThan(0)
    expect(response.messages[0]).toMatchObject({ role: 'user', text: '帮我看下报错' })
    expect(response.messages.some((m) => m.role === 'assistant' && m.text === '看日志定位')).toBe(
      true,
    )
    expect(response.messages.some((m) => m.role === 'thinking' && m.text === '先想一下')).toBe(true)
  })

  it('zcode CLI 来源：limit 截断时返回 truncated 标记', async () => {
    const response = await service.preview('zcode', cliDbPath, 1, 'sess_a', 'cli')
    expect(response.messages).toHaveLength(1)
    expect(response.truncated).toBe(true)
  })
})

describe('HistoryImportService（WorkBuddy / Qoder）', () => {
  let home: string
  let workbuddyJsonl: string
  let qoderDbPath: string
  let service: HistoryImportService
  let originalHome: string | undefined

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'history-import-new-sources-'))
    // 两个来源都会额外探测 $HOME 下的候选目录；测试期间把 HOME 指到 fixture，
    // 避免扫到本机真实安装的数据（隔离性）
    originalHome = process.env.HOME
    process.env.HOME = home
    workbuddyJsonl = createWorkbuddyFixture(home).jsonlPath
    qoderDbPath = createQoderFixture(home)
    service = new HistoryImportService({
      db: {} as SparkDatabase,
      resolveProvider: async () => ({
        providerProfileId: 'p1',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-ask',
      }),
      createSession: async () => ({ sessionId: 's1' }),
      homeDir: home,
    })
  })

  afterAll(() => {
    if (originalHome == null) delete process.env.HOME
    else process.env.HOME = originalHome
    rmSync(home, { recursive: true, force: true })
  })

  it('WorkBuddy 预览：只取 <user_query>，带出正文与思考', async () => {
    const response = await service.preview('workbuddy', workbuddyJsonl, 20, 'wb-sess-1')
    expect(response.messages.length).toBeGreaterThan(0)
    const userMsg = response.messages.find((m) => m.role === 'user')
    expect(userMsg?.text).toBe('修复导入')
    expect(response.messages.some((m) => m.role === 'assistant' && m.text === '收到')).toBe(true)
  })

  it('Qoder 预览：按 sourceSessionId 从 main.sqlite 重组并解析', async () => {
    const response = await service.preview('qoder', qoderDbPath, 20, 'qoder-sess-1')
    expect(response.messages.length).toBeGreaterThan(0)
    expect(response.messages[0]).toMatchObject({ role: 'user', text: 'hi，这是什么项目' })
    expect(response.messages.some((m) => m.role === 'thinking' && m.text === '先看结构')).toBe(true)
    expect(response.messages.some((m) => m.role === 'assistant' && m.text === '这是一个项目')).toBe(
      true,
    )
  })

  it('Qoder 缺少 sourceSessionId 时报错而不是把 sqlite 当 JSON 解析', async () => {
    await expect(service.preview('qoder', qoderDbPath, 20)).rejects.toThrow(/sourceSessionId/)
  })

  it('scan：WorkBuddy 跳过已删除会话，Qoder 只取未删除 standard 会话', async () => {
    const response = await service.scan(['workbuddy', 'qoder'])
    const workbuddy = response.items.filter((item) => item.source === 'workbuddy')
    expect(workbuddy).toHaveLength(1)
    expect(workbuddy[0]).toMatchObject({
      sourceSessionId: 'wb-sess-1',
      cwd: '/Users/me/wb-proj',
      filePath: workbuddyJsonl,
    })
    expect(response.items.some((item) => item.sourceSessionId === 'wb-sess-deleted')).toBe(false)

    const qoder = response.items.filter((item) => item.source === 'qoder')
    expect(qoder).toHaveLength(1)
    expect(qoder[0]).toMatchObject({
      sourceSessionId: 'qoder-sess-1',
      cwd: '/Users/me/qoder-proj',
      filePath: qoderDbPath,
    })

    expect(response.sources.find((s) => s.source === 'workbuddy')).toMatchObject({
      available: true,
      count: 1,
    })
    expect(response.sources.find((s) => s.source === 'qoder')).toMatchObject({
      available: true,
      count: 1,
    })
  })
})
