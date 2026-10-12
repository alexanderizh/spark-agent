import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'

/**
 * 121 迁移回放：093 建旧表 → 099 补 hook 列 → 插入旧形态数据 → 121 重建为审计账本。
 * 重点验证：存量保全、ledger_seq/chain_session_id 回填、重复 running 悬挂对账、
 * CHECK 扩值（source_kind 8 值 / invocation_source 增 'hook' / status 增 'stale'）、
 * running 态 correlation 部分唯一索引。
 */

interface OldShapeRow {
  id: string
  correlation_id: string
  source_kind: string
  source_id: string
  tool_name: string
  invocation_source: string
  session_id: string | null
  turn_id: string | null
  workflow_id: string | null
  hook_id: string | null
  hook_run_id: string | null
  status: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  input_sha256: string
  output_bytes: number | null
  created_at: string
}

function insertOldRow(db: SparkDatabase, row: OldShapeRow): void {
  db.raw
    .prepare(
      `INSERT INTO tool_invocations (
        id, correlation_id, source_kind, source_id, tool_name, invocation_source,
        session_id, turn_id, workflow_id, hook_id, hook_run_id,
        status, started_at, finished_at, duration_ms, error_code,
        input_sha256, output_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.correlation_id,
      row.source_kind,
      row.source_id,
      row.tool_name,
      row.invocation_source,
      row.session_id,
      row.turn_id,
      row.workflow_id,
      row.hook_id,
      row.hook_run_id,
      row.status,
      row.started_at,
      row.finished_at,
      row.duration_ms,
      row.error_code,
      row.input_sha256,
      row.output_bytes,
      row.created_at,
    )
}

function baseOldRow(overrides: Partial<OldShapeRow>): OldShapeRow {
  return {
    id: 'row-x',
    correlation_id: 'corr-x',
    source_kind: 'custom-tool',
    source_id: 'tool-x',
    tool_name: 'tool-x',
    invocation_source: 'model',
    session_id: 'session-x',
    turn_id: 'turn-1',
    workflow_id: null,
    hook_id: null,
    hook_run_id: null,
    status: 'ok',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:01.000Z',
    duration_ms: 1000,
    error_code: null,
    input_sha256: 'a'.repeat(64),
    output_bytes: 128,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('tool_invocations 121 audit ledger migration', () => {
  let db: SparkDatabase
  let dir: string
  let migrations: string

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `spark-tool-invocation-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    migrations = join(process.cwd(), 'migrations')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('preserves legacy rows while backfilling ledger_seq / chain_session_id / NULL hashes', () => {
    db.raw.exec(readFileSync(join(migrations, '093_unified_tool_invocations.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '099_sparkwork_hooks_v2.sql'), 'utf8'))

    insertOldRow(
      db,
      baseOldRow({
        id: 'row-a',
        correlation_id: 'corr-a',
        session_id: 'session-1',
        created_at: '2026-01-01T00:00:00.000Z',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
      }),
    )
    insertOldRow(
      db,
      baseOldRow({
        id: 'row-b',
        correlation_id: 'corr-b',
        session_id: null,
        workflow_id: 'wf-9',
        status: 'running',
        finished_at: null,
        duration_ms: null,
        created_at: '2026-01-02T00:00:00.000Z',
        started_at: '2026-01-02T00:00:00.000Z',
      }),
    )
    insertOldRow(
      db,
      baseOldRow({
        id: 'row-c',
        correlation_id: 'corr-c',
        session_id: null,
        workflow_id: null,
        status: 'error',
        error_code: 'E_TOOL',
        created_at: '2026-01-03T00:00:00.000Z',
        started_at: '2026-01-03T00:00:00.000Z',
        finished_at: '2026-01-03T00:00:02.000Z',
      }),
    )

    db.raw.exec(readFileSync(join(migrations, '121_tool_invocations_audit_ledger.sql'), 'utf8'))

    const rows = db.raw
      .prepare('SELECT * FROM tool_invocations ORDER BY ledger_seq')
      .all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)

    const byId = new Map(rows.map((row) => [row.id, row]))
    // 存量保全：业务字段原样保留
    expect(byId.get('row-a')).toMatchObject({
      correlation_id: 'corr-a',
      source_kind: 'custom-tool',
      status: 'ok',
      input_sha256: 'a'.repeat(64),
      output_bytes: 128,
      duration_ms: 1000,
    })
    expect(byId.get('row-c')).toMatchObject({ status: 'error', error_code: 'E_TOOL' })

    // ledger_seq 按 created_at 顺序重编（全局单调）
    expect(rows.map((row) => row.ledger_seq)).toEqual([1, 2, 3])

    // chain_session_id 回填口径
    expect(byId.get('row-a')).toMatchObject({ chain_session_id: 'session-1' })
    expect(byId.get('row-b')).toMatchObject({ chain_session_id: 'wf:wf-9' })
    expect(byId.get('row-c')).toMatchObject({ chain_session_id: 'unattributed' })

    // 旧行哈希置 NULL：链校验从迁移后第一条新记录起算
    for (const row of rows) {
      expect(row.record_hash).toBeNull()
      expect(row.prev_hash).toBeNull()
      expect(row.finished_record_hash).toBeNull()
    }
  })

  it('demotes duplicate running correlation rows to stale before the unique index', () => {
    db.raw.exec(readFileSync(join(migrations, '093_unified_tool_invocations.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '099_sparkwork_hooks_v2.sql'), 'utf8'))

    // 崩撞悬挂（旧 running）+ 重试（新 running）共享 correlation_id
    insertOldRow(
      db,
      baseOldRow({
        id: 'orphan-1',
        correlation_id: 'corr-dup',
        session_id: 'session-2',
        status: 'running',
        finished_at: null,
        duration_ms: null,
        created_at: '2026-01-01T00:00:00.000Z',
        started_at: '2026-01-01T00:00:00.000Z',
      }),
    )
    insertOldRow(
      db,
      baseOldRow({
        id: 'orphan-2',
        correlation_id: 'corr-dup',
        session_id: 'session-2',
        status: 'running',
        finished_at: null,
        duration_ms: null,
        created_at: '2026-01-02T00:00:00.000Z',
        started_at: '2026-01-02T00:00:00.000Z',
      }),
    )

    db.raw.exec(readFileSync(join(migrations, '121_tool_invocations_audit_ledger.sql'), 'utf8'))

    const rows = db.raw
      .prepare(
        "SELECT id, status FROM tool_invocations WHERE correlation_id = 'corr-dup' ORDER BY ledger_seq",
      )
      .all() as Array<{ id: string; status: string }>
    expect(rows).toEqual([
      { id: 'orphan-1', status: 'stale' },
      { id: 'orphan-2', status: 'running' },
    ])
  })

  it('expands CHECK enums and enforces running-correlation uniqueness', () => {
    db.raw.exec(readFileSync(join(migrations, '093_unified_tool_invocations.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '099_sparkwork_hooks_v2.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '121_tool_invocations_audit_ledger.sql'), 'utf8'))

    const insertDirect = db.raw.prepare(
      `INSERT INTO tool_invocations (
        id, ledger_seq, correlation_id, chain_session_id, tool_name,
        source_kind, invocation_source, source_id, status, started_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // CHECK 扩值：新枚举首次合法（F1 修复：invocation_source='hook'）
    insertDirect.run(
      'new-sdk',
      100,
      'corr-sdk',
      'session-1',
      'Bash',
      'sdk-builtin',
      'model',
      'claude-engine',
      'running',
      '2026-02-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    )
    insertDirect.run(
      'new-mcp',
      101,
      'corr-mcp',
      'session-1',
      'mcp__github__create_issue',
      'mcp',
      'model',
      'mcp-github',
      'running',
      '2026-02-01T00:00:01.000Z',
      '2026-02-01T00:00:01.000Z',
    )
    insertDirect.run(
      'new-hook',
      102,
      'corr-hook',
      'unattributed',
      'guard',
      'hook',
      'hook',
      'hook-1',
      'ok',
      '2026-02-01T00:00:02.000Z',
      '2026-02-01T00:00:02.000Z',
    )
    // status='stale' 合法
    insertDirect.run(
      'new-stale',
      103,
      'corr-stale',
      'unattributed',
      'tool-x',
      'custom-tool',
      'model',
      'tool-x',
      'stale',
      '2026-02-01T00:00:03.000Z',
      '2026-02-01T00:00:03.000Z',
    )

    // 同一 correlation_id 第二条 running → 部分唯一索引拒绝
    expect(() =>
      insertDirect.run(
        'dup-running',
        104,
        'corr-sdk',
        'session-1',
        'Bash',
        'sdk-builtin',
        'model',
        'claude-engine',
        'running',
        '2026-02-01T00:00:04.000Z',
        '2026-02-01T00:00:04.000Z',
      ),
    ).toThrow(/UNIQUE/)

    // 同一 correlation_id 终态行不受限（保留重试历史）
    insertDirect.run(
      'dup-finished',
      104,
      'corr-sdk',
      'session-1',
      'Bash',
      'sdk-builtin',
      'model',
      'claude-engine',
      'error',
      '2026-02-01T00:00:05.000Z',
      '2026-02-01T00:00:05.000Z',
    )

    // 旧枚举仍合法（向后兼容）
    insertDirect.run(
      'legacy-kind',
      105,
      'corr-legacy',
      'session-1',
      'tool-x',
      'tool-package',
      'workflow',
      'pkg-1',
      'ok',
      '2026-02-01T00:00:06.000Z',
      '2026-02-01T00:00:06.000Z',
    )

    // 违规值仍被拒绝
    expect(() =>
      insertDirect.run(
        'bad-kind',
        106,
        'corr-bad',
        'session-1',
        'x',
        'unknown-kind',
        'model',
        'x',
        'ok',
        '2026-02-01T00:00:07.000Z',
        '2026-02-01T00:00:07.000Z',
      ),
    ).toThrow(/CHECK/)
  })
})
