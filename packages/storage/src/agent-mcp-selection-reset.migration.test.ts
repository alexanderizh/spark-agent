import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'

const migrationsDir = join(process.cwd(), 'migrations')

/** 线上库中 playwright 托管 server 的 DB 行 id（旧版选择器遗留清单的典型形态）。 */
const PLAYWRIGHT_SERVER_ID = '98dc2812-d3e4-474d-a239-016beec368fb'

describe('124 legacy agent MCP selection reset migration', () => {
  let db: SparkDatabase | undefined
  let dir: string | undefined

  afterEach(() => {
    db?.close()
    if (dir != null) rmSync(dir, { recursive: true, force: true })
  })

  function setupThrough123(): SparkDatabase {
    dir = join(tmpdir(), `spark-agent-mcp-reset-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    const database = new SparkDatabase(join(dir, 'test.db'))
    db = database
    applyMigrationsThrough(database, 123)
    return database
  }

  function insertAgent(
    database: SparkDatabase,
    id: string,
    mcpJson: string,
    fields: Record<string, string> = {},
  ): void {
    database.raw
      .prepare(
        `INSERT INTO agents (id, name, prompt, skill_ids_json, mcp_server_ids_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, fields.name ?? id, fields.prompt ?? '', fields.skillIds ?? '[]', mcpJson)
  }

  function readMcp(database: SparkDatabase, id: string): string {
    const row = database.raw
      .prepare('SELECT mcp_server_ids_json FROM agents WHERE id = ?')
      .get(id) as { mcp_server_ids_json: string } | undefined
    return row?.mcp_server_ids_json ?? '<missing>'
  }

  it('重置休眠期遗留的托管 server 清单，还原「全部可用」', () => {
    const database = setupThrough123()
    insertAgent(database, 'legacy-playwright', JSON.stringify([PLAYWRIGHT_SERVER_ID]))

    database.runMigrations(migrationsDir)

    expect(readMcp(database, 'legacy-playwright')).toBe('[]')
  })

  it('重置含内置合成 id 的存量白名单（无法与误导操作区分，一并还原）', () => {
    const database = setupThrough123()
    insertAgent(
      database,
      'legacy-mixed',
      JSON.stringify(['builtin:spark_search', PLAYWRIGHT_SERVER_ID, 'builtin:spark_media']),
    )

    database.runMigrations(migrationsDir)

    expect(readMcp(database, 'legacy-mixed')).toBe('[]')
  })

  it('已是空清单的行保持原样，不受迁移影响', () => {
    const database = setupThrough123()
    insertAgent(database, 'already-empty', '[]')

    database.runMigrations(migrationsDir)

    expect(readMcp(database, 'already-empty')).toBe('[]')
  })

  it('畸形 JSON 与空白串规范化为 []，避免下游解析出未定义行为', () => {
    const database = setupThrough123()
    insertAgent(database, 'malformed', 'not-json-at-all')
    insertAgent(database, 'blank', '   ')

    database.runMigrations(migrationsDir)

    expect(readMcp(database, 'malformed')).toBe('[]')
    expect(readMcp(database, 'blank')).toBe('[]')
  })

  it('迁移只改 MCP 选择，其他 Agent 字段保持不变', () => {
    const database = setupThrough123()
    insertAgent(database, 'keep-fields', JSON.stringify([PLAYWRIGHT_SERVER_ID]), {
      name: '工程师小🐮',
      prompt: '通用全栈编码 Agent。',
      skillIds: JSON.stringify(['builtin:platform-manager']),
    })

    database.runMigrations(migrationsDir)

    const row = database.raw
      .prepare('SELECT name, prompt, skill_ids_json, mcp_server_ids_json FROM agents WHERE id = ?')
      .get('keep-fields') as {
      name: string
      prompt: string
      skill_ids_json: string
      mcp_server_ids_json: string
    }
    expect(row.name).toBe('工程师小🐮')
    expect(row.prompt).toBe('通用全栈编码 Agent。')
    expect(row.skill_ids_json).toBe(JSON.stringify(['builtin:platform-manager']))
    expect(row.mcp_server_ids_json).toBe('[]')
  })

  it('迁移可重复执行且结果稳定（幂等）', () => {
    const database = setupThrough123()
    insertAgent(database, 'idempotent', JSON.stringify([PLAYWRIGHT_SERVER_ID]))

    const migrationSql = readFileSync(
      join(migrationsDir, '124_reset_legacy_agent_mcp_selection.sql'),
      'utf8',
    )
    database.raw.exec(migrationSql)
    const first = readMcp(database, 'idempotent')
    database.raw.exec(migrationSql)

    expect(first).toBe('[]')
    expect(readMcp(database, 'idempotent')).toBe('[]')
  })
})

function applyMigrationsThrough(db: SparkDatabase, targetVersion: number): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  for (const name of readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const version = Number.parseInt(name, 10)
    if (version > targetVersion) break
    db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    db.raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, name)
  }
}
