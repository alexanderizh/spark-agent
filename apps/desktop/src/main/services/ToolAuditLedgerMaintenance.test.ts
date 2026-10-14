/**
 * ToolAuditLedgerMaintenance 治理单测（设计 P4：prune 时间冻结）。
 *
 * 直建 SparkDatabase（全量 migrations）+ 临时工作区目录造载荷归档文件，
 * 验证三条保留期路径：无引用载荷回收（随行删除）、mtime 超期、配额从旧删。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase, ToolInvocationRepository, WorkspaceRepository } from '@spark/storage'
import { ToolAuditLedgerMaintenance } from './ToolAuditLedgerMaintenance.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS

/** 固定「现在」：测试内所有 mtime/cutoff 相对它构造。 */
const NOW = Date.parse('2026-10-12T12:00:00.000Z')

function createTestDb(dir: string): SparkDatabase {
  const db = new SparkDatabase(path.join(dir, 'maintenance-test.db'))
  db.runMigrations(path.join(process.cwd(), '..', '..', 'packages', 'storage', 'migrations'))
  return db
}

describe('ToolAuditLedgerMaintenance', () => {
  let db: SparkDatabase
  let repo: ToolInvocationRepository
  let testDir: string
  let workspaceRoot: string

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'tool-audit-maintenance-'))
    db = createTestDb(testDir)
    repo = new ToolInvocationRepository(db)
    workspaceRoot = path.join(testDir, 'ws')
    new WorkspaceRepository(db).create({
      id: randomUUID(),
      name: '测试工作区',
      rootPath: workspaceRoot,
    })
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* Windows EBUSY 残留交给临时区 */
    }
  })

  function payloadDir(): string {
    return path.join(workspaceRoot, '.spark-agent', 'audit', 'tool-payloads')
  }

  function payloadExists(artifactId: string): boolean {
    return existsSync(path.join(payloadDir(), `${artifactId}.json`))
  }

  function writePayload(artifactId: string, content: string, mtime: number): void {
    mkdirSync(payloadDir(), { recursive: true })
    const file = path.join(payloadDir(), `${artifactId}.json`)
    writeFileSync(file, content, 'utf8')
    utimesSync(file, new Date(mtime), new Date(mtime))
  }

  function appendRow(params: { artifactId: string; createdAt: string; bytes: number }): string {
    const id = `row-${params.artifactId.slice(0, 8)}`
    repo.appendLedger({
      id,
      correlationId: id,
      sourceKind: 'mcp',
      sourceId: 'srv',
      toolName: 't',
      invocationSource: 'workflow',
      inputArtifactId: params.artifactId,
      inputSha256: params.artifactId,
      inputBytes: params.bytes,
      startedAt: params.createdAt,
    })
    // 直接改 created_at 触达目标保留窗口（appendLedger 默认 now）。
    db.raw
      .prepare('UPDATE tool_invocations SET created_at = ? WHERE id = ?')
      .run(params.createdAt, id)
    return id
  }

  it('账本超 90 天删行，且无引用载荷文件随之回收', async () => {
    const oldArtifact = 'a'.repeat(64)
    writePayload(oldArtifact, '{"old":1}', NOW - 40 * DAY_MS)
    appendRow({
      artifactId: oldArtifact,
      createdAt: new Date(NOW - 91 * DAY_MS).toISOString(),
      bytes: 9,
    })
    // 新行（90 天窗口内）引用不同载荷，必须保留。
    const freshArtifact = 'b'.repeat(64)
    writePayload(freshArtifact, '{"fresh":1}', NOW - HOUR_MS)
    appendRow({
      artifactId: freshArtifact,
      createdAt: new Date(NOW - HOUR_MS).toISOString(),
      bytes: 11,
    })

    const maintenance = new ToolAuditLedgerMaintenance(db, { now: () => NOW })
    const result = await maintenance.runOnce()

    expect(result.ledgerRowsDeleted).toBe(1)
    expect(repo.list({}).items).toHaveLength(1)
    // 旧载荷文件随无引用回收；新载荷保留。
    expect(payloadExists(oldArtifact)).toBe(false)
    expect(payloadExists(freshArtifact)).toBe(true)
  })

  it('载荷 mtime 超 30 天删除（行保留，仅失去原文回看）', async () => {
    const artifact = 'c'.repeat(64)
    writePayload(artifact, '{"v":1}', NOW - 31 * DAY_MS)
    appendRow({
      artifactId: artifact,
      createdAt: new Date(NOW - 31 * DAY_MS).toISOString(),
      bytes: 8,
    })

    const maintenance = new ToolAuditLedgerMaintenance(db, { now: () => NOW })
    const result = await maintenance.runOnce()

    // 行在 90 天窗口内 → 不删行；载荷 mtime 超 30 天 → 删文件。
    expect(result.ledgerRowsDeleted).toBe(0)
    expect(repo.list({}).items).toHaveLength(1)
    expect(payloadExists(artifact)).toBe(false)
  })

  it('配额超限：从最旧开始删到配额内', async () => {
    // 三个新载荷（30 天内），配额压到 2 个文件大小 → 最旧一个被删。
    const firstId = 'd'.repeat(64)
    const secondId = 'e'.repeat(64)
    const oldestId = 'f'.repeat(64)
    const ids = [firstId, secondId, oldestId]
    const size = 100
    ids.forEach((id, index) => {
      writePayload(id, `${index}:${'x'.repeat(size - 2)}`, NOW - (index + 1) * HOUR_MS)
      appendRow({
        artifactId: id,
        createdAt: new Date(NOW - (index + 1) * HOUR_MS).toISOString(),
        bytes: size,
      })
    })

    const maintenance = new ToolAuditLedgerMaintenance(db, {
      now: () => NOW,
      payloadQuotaBytes: size * 2 + 10, // 只容 2 个文件多一点点
    })
    const result = await maintenance.runOnce()

    expect(result.ledgerRowsDeleted).toBe(0)
    // mtime 最旧的是 oldestId（NOW-3h）——被删；其余保留。
    expect(payloadExists(oldestId)).toBe(false)
    expect(payloadExists(firstId)).toBe(true)
    expect(payloadExists(secondId)).toBe(true)
    expect(result.bytesFreed).toBeGreaterThanOrEqual(size)
  })
})
