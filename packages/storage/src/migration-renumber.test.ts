/**
 * migration 编号对账（renumber reconcile）集成测试
 *
 * 背景：并行任务曾产生 111/112 撞号，后进 master 的 workspace 组改号为 115/116。
 * 曾在旧分支（workspace 组仍占 111/112）上运行过的数据库，其 schema_migrations
 * 记录的是旧号——不加对账会发生两类数据事故：
 *   1. 111/112 旧记录挡住 execution_continuity / wiki_core，表永远缺建；
 *   2. workspace 组被误判未执行而重跑 ALTER TABLE ADD COLUMN → duplicate column 崩库。
 *
 * 这里用真实 migration 文件拼出一个"旧分支时代"的目录，先跑出旧状态库，
 * 再用当前目录升级，验证对账修复了以上两点。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inspectPendingMigrations, SparkDatabase } from './database.js'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const here = dirname(fileURLToPath(import.meta.url))
const currentMigrationsDir = join(here, '..', 'migrations')

/** 拼出"workspace 组仍占 111/112、execution/wiki 组尚未存在"的旧分支 migration 目录 */
function buildLegacyMigrationsDir(targetDir: string): string {
  mkdirSync(targetDir, { recursive: true })
  const excluded = new Set([
    '111_execution_continuity.sql',
    '112_wiki_core.sql',
    '113_wiki_extraction_state.sql',
    '114_wiki_page_pinned.sql',
    '115_workspace_default_agent.sql',
    '116_workspace_allowed_agents.sql',
  ])
  for (const name of readdirSync(currentMigrationsDir)) {
    if (!name.endsWith('.sql') || excluded.has(name)) continue
    copyFileSync(join(currentMigrationsDir, name), join(targetDir, name))
  }
  // workspace 组以旧号 111/112 出现（内容与现 115/116 完全一致）
  copyFileSync(
    join(currentMigrationsDir, '115_workspace_default_agent.sql'),
    join(targetDir, '111_workspace_default_agent.sql'),
  )
  copyFileSync(
    join(currentMigrationsDir, '116_workspace_allowed_agents.sql'),
    join(targetDir, '112_workspace_allowed_agents.sql'),
  )
  return targetDir
}

describe('migration renumber reconcile', () => {
  let testDir: string
  let db: SparkDatabase | undefined

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-renumber-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = undefined
  })

  afterEach(() => {
    db?.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('升级旧号库：补齐缺表、不重跑已执行 ALTER、修正 applied 记录', () => {
    const legacyDir = buildLegacyMigrationsDir(join(testDir, 'legacy-migrations'))
    const dbPath = join(testDir, 'legacy.db')

    // 阶段一：模拟在旧分支上运行过的库（111/112 = workspace 组）
    db = new SparkDatabase(dbPath)
    db.runMigrations(legacyDir)
    db.close()
    db = undefined

    // 阶段二：用当前目录升级——对账应让 migration 全部正确落位且不崩溃
    db = new SparkDatabase(dbPath)
    db.runMigrations(currentMigrationsDir)

    // 1) 曾被旧 111/112 记录挡住的表必须补建成功
    expect(hasTable(db, 'execution_runs')).toBe(true)
    expect(hasTable(db, 'wiki_page')).toBe(true)

    // 2) workspace 列保留（旧分支已加），且 ALTER 没有重跑崩溃
    const workspaceColumns = db.raw.prepare('PRAGMA table_info(workspaces)').all() as Array<{
      name: string
    }>
    const columnNames = workspaceColumns.map((column) => column.name)
    expect(columnNames).toContain('default_agent_id')
    expect(columnNames).toContain('allowed_agent_ids_json')

    // 3) applied 记录修正：version 归位到现文件号；name 保留执行时文件名（历史事实，
    //    对账只改 version 不改 name，version 才是追踪键）
    const appliedRows = db.raw
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string }>
    const nameByVersion = new Map(appliedRows.map((row) => [row.version, row.name]))
    expect(nameByVersion.get(111)).toBe('111_execution_continuity.sql')
    expect(nameByVersion.get(112)).toBe('112_wiki_core.sql')
    expect(nameByVersion.get(115)).toBe('111_workspace_default_agent.sql')
    expect(nameByVersion.get(116)).toBe('112_workspace_allowed_agents.sql')
    // version 主键唯一性未被对账破坏
    expect(new Set(appliedRows.map((row) => row.version)).size).toBe(appliedRows.length)

    // 4) 只读巡检视角：修正后应无 pending（对账也作用于 inspectPendingMigrations）
    db.close()
    db = undefined
    const plan = inspectPendingMigrations(dbPath, currentMigrationsDir)
    expect(plan.pendingMigrations).toEqual([])
  })

  it('全新库直接跑当前目录：全部 migration 正常执行', () => {
    const dbPath = join(testDir, 'fresh.db')
    db = new SparkDatabase(dbPath)
    db.runMigrations(currentMigrationsDir)

    expect(hasTable(db, 'execution_runs')).toBe(true)
    expect(hasTable(db, 'wiki_page')).toBe(true)
    const columnNames = (
      db.raw.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columnNames).toContain('default_agent_id')
    expect(columnNames).toContain('allowed_agent_ids_json')
  })

  it('正常库（无改号）跑对账：记录保持原样', () => {
    const dbPath = join(testDir, 'normal.db')
    db = new SparkDatabase(dbPath)
    db.runMigrations(currentMigrationsDir)
    db.close()
    db = undefined

    // 再跑一次：全部已 applied，对账无事发生，也不重复执行
    db = new SparkDatabase(dbPath)
    db.runMigrations(currentMigrationsDir)
    const count = db.raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number
    }
    const fileCount = readdirSync(currentMigrationsDir).filter((name) =>
      name.endsWith('.sql'),
    ).length
    expect(count.count).toBe(fileCount)
  })
})

function hasTable(db: SparkDatabase, table: string): boolean {
  const row = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  return row != null
}
