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
