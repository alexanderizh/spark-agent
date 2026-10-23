import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { ToolInvocationRepository } from './tool-invocation.repository.js'

/** 全链迁移后的新 schema 上验证账本 API（appendLedger/链校验/配对收尾/游标分页/统计/对账/清理）。 */

describe('ToolInvocationRepository audit ledger', () => {
  let db: SparkDatabase
  let dir: string
  let repo: ToolInvocationRepository

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `spark-tool-invocation-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new ToolInvocationRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function append(params: {
    id: string
    sessionId?: string
    workflowId?: string
    turnId?: string
    toolName?: string
    correlationId?: string
    memberAgentId?: string
    sourceKind?:
      | 'sdk-builtin'
      | 'mcp'
      | 'custom-tool'
      | 'tool-package'
      | 'connector'
      | 'workflow'
      | 'hook'
      | 'test'
    invocationSource?: 'model' | 'workflow' | 'test' | 'platform' | 'nested' | 'hook'
    engine?: string
    startedAt?: string
  }) {
    return repo.appendLedger({
      id: params.id,
      correlationId: params.correlationId ?? params.id,
      sourceKind: params.sourceKind ?? 'sdk-builtin',
      sourceId: params.sessionId ?? 'test-source',
      toolName: params.toolName ?? 'Bash',
      invocationSource: params.invocationSource ?? 'model',
      ...(params.engine != null ? { engine: params.engine } : {}),
      ...(params.sessionId != null ? { sessionId: params.sessionId } : {}),
      ...(params.turnId != null ? { turnId: params.turnId } : {}),
      ...(params.workflowId != null ? { workflowId: params.workflowId } : {}),
      ...(params.memberAgentId != null ? { memberAgentId: params.memberAgentId } : {}),
      inputSha256: 'b'.repeat(64),
      inputBytes: 64,
      ...(params.startedAt != null ? { startedAt: params.startedAt } : {}),
    })
  }

  it('appendLedger assigns global ledger_seq and chains prev_hash per chain', () => {
    const a1 = append({ id: 'a1', sessionId: 'session-a' })
    const b1 = append({ id: 'b1', sessionId: 'session-b' })
    const a2 = append({ id: 'a2', sessionId: 'session-a' })
    const wf = append({ id: 'wf1', workflowId: 'wf-7' })
    const none = append({ id: 'none1' })

    // 全局单调（跨链交错也不回退）
    expect([a1.ledger_seq, b1.ledger_seq, a2.ledger_seq, wf.ledger_seq, none.ledger_seq]).toEqual([
      1, 2, 3, 4, 5,
    ])

    // 分链串接：链首 prev_hash 为 NULL，后续接前一条 record_hash
    expect(a1.prev_hash).toBeNull()
    expect(a2.prev_hash).toBe(a1.record_hash)
    expect(b1.prev_hash).toBeNull()
    for (const row of [a1, b1, a2, wf, none]) {
      expect(row.record_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.status).toBe('running')
    }

    // 分链键推导
    expect(a1.chain_session_id).toBe('session-a')
    expect(wf.chain_session_id).toBe('wf:wf-7')
    expect(none.chain_session_id).toBe('unattributed')

    // 双链各自完整
    expect(repo.verifyChain('session-a')).toMatchObject({ valid: true, checkedCount: 2 })
    expect(repo.verifyChain('session-b')).toMatchObject({ valid: true, checkedCount: 1 })
  })

  it('verifyChain detects tampering and prev_hash breaks', () => {
    append({ id: 't1', sessionId: 'session-t' })
    append({ id: 't2', sessionId: 'session-t' })
    append({ id: 't3', sessionId: 'session-t' })
    expect(repo.verifyChain('session-t')).toMatchObject({ valid: true, checkedCount: 3 })

    // 篡改中间行内容 → hash-mismatch（期望哈希 ≠ 实际哈希）
    db.raw.prepare("UPDATE tool_invocations SET tool_name = 'hacked' WHERE id = 't2'").run()
    const tampered = repo.verifyChain('session-t')
    expect(tampered.valid).toBe(false)
    expect(tampered.checkedCount).toBe(1)
    expect(tampered.break).toMatchObject({ ledgerSeq: 2, reason: 'hash-mismatch' })
    if (tampered.break != null) {
      expect(tampered.break.expectedRecordHash).not.toBe(tampered.break.actualRecordHash)
    }

    // 直接改 prev_hash → prev-mismatch
    db.raw
      .prepare("UPDATE tool_invocations SET tool_name = 'Bash', prev_hash = NULL WHERE id = 't2'")
      .run()
    expect(repo.verifyChain('session-t').break).toMatchObject({
      ledgerSeq: 2,
      reason: 'prev-mismatch',
    })
  })

  it('verifyChain treats NULL record_hash rows as chain starts (backfill exemption)', () => {
    // 模拟 121 回填段：直接 SQL 插入无哈希行（分链内最早）
    db.raw
      .prepare(
        `INSERT INTO tool_invocations (
          id, ledger_seq, correlation_id, chain_session_id, tool_name,
          source_kind, invocation_source, source_id, status, started_at, created_at
        ) VALUES ('legacy', 1, 'legacy', 'session-n', 'legacy-tool', 'custom-tool', 'model', 'legacy-tool', 'ok', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run()
    const n1 = append({ id: 'n1', sessionId: 'session-n' })
    append({ id: 'n2', sessionId: 'session-n' })

    // 回填行之后的新行从 NULL 起链
    expect(n1.prev_hash).toBeNull()
    const result = repo.verifyChain('session-n')
    expect(result).toMatchObject({ valid: true, checkedCount: 2 })
  })

  it('finish keeps creation hash and records supplementary finished hash', () => {
    const row = append({ id: 'f1', sessionId: 'session-f', startedAt: '2026-03-01T00:00:00.000Z' })
    expect(row.finished_record_hash).toBeNull()

    const finished = repo.finish('f1', {
      status: 'ok',
      outputBytes: 512,
      outputSha256: 'c'.repeat(64),
      outputArtifactId: 'c'.repeat(64),
      finishedAt: '2026-03-01T00:00:02.500Z',
    })
    expect(finished).toMatchObject({
      status: 'ok',
      duration_ms: 2500,
      output_bytes: 512,
      result_archived: 1, // outputArtifactId 非空 → 投影置位（修 F2）
    })
    expect(finished?.finished_record_hash).toMatch(/^[0-9a-f]{64}$/)
    // 主链哈希不变（创建态受保护）
    expect(finished?.record_hash).toBe(row.record_hash)
    expect(repo.verifyChain('session-f')).toMatchObject({ valid: true, checkedCount: 1 })

    // 篡改收尾态字段（duration_ms）→ 补充哈希失配
    db.raw.prepare("UPDATE tool_invocations SET duration_ms = 1 WHERE id = 'f1'").run()
    const finishTampered = repo.verifyChain('session-f')
    expect(finishTampered.valid).toBe(false)
    expect(finishTampered.break).toMatchObject({ ledgerSeq: 1, reason: 'finish-hash-mismatch' })

    // durationMs 覆盖：事件侧权威耗时优先
    const again = repo.appendLedger({
      id: 'f2',
      sourceKind: 'mcp',
      sourceId: 'mcp-github',
      toolName: 'mcp__github__create_issue',
      invocationSource: 'model',
      sessionId: 'session-f',
      startedAt: '2026-03-01T00:01:00.000Z',
    })
    const finished2 = repo.finish(again.id, {
      status: 'error',
      errorCode: 'E_TIMEOUT',
      errorMessage: 'upstream timeout after 30s',
      durationMs: 30,
      finishedAt: '2026-03-01T00:01:45.000Z',
    })
    expect(finished2).toMatchObject({
      status: 'error',
      duration_ms: 30,
      error_message: 'upstream timeout after 30s',
    })
  })

  it('finalizeByCorrelation pairs the latest running row', () => {
    append({ id: 'p1', sessionId: 'session-p' })
    const finished = repo.finalizeByCorrelation('p1', {
      status: 'ok',
      finishedAt: '2026-03-01T00:00:01.000Z',
    })
    expect(finished).toMatchObject({ id: 'p1', status: 'ok' })

    // 已终态：无 running 行可配对
    expect(repo.finalizeByCorrelation('p1', { status: 'error' })).toBeUndefined()
    // 未知 correlation
    expect(repo.finalizeByCorrelation('missing', { status: 'error' })).toBeUndefined()
  })

  it('legacy start/finish signatures keep working and join the chain', () => {
    const row = repo.start({
      id: 'legacy-1',
      correlationId: 'legacy-1',
      sourceKind: 'custom-tool',
      sourceId: 'tool-legacy',
      toolName: 'tool-legacy',
      adapter: 'http',
      invocationSource: 'model',
      sessionId: 'session-legacy',
      inputSha256: 'd'.repeat(64),
      startedAt: '2026-03-01T00:00:00.000Z',
    })
    expect(row.ledger_seq).toBeGreaterThan(0)
    expect(row.record_hash).toMatch(/^[0-9a-f]{64}$/)

    const finished = repo.finish('legacy-1', {
      status: 'ok',
      outputBytes: 32,
      finishedAt: '2026-03-01T00:00:00.500Z',
    })
    expect(finished).toMatchObject({ status: 'ok', duration_ms: 500 })
    expect(repo.verifyChain('session-legacy')).toMatchObject({ valid: true, checkedCount: 1 })
  })

  it('listLedger pages by ledger_seq cursor with stable total', () => {
    for (let i = 1; i <= 5; i += 1) {
      append({
        id: `l${i}`,
        sessionId: 'session-l',
        turnId: i <= 3 ? 'turn-1' : 'turn-2',
        toolName: i % 2 === 0 ? 'Read' : 'Bash',
      })
    }
    // 干扰行：别的会话不计入
    append({ id: 'other', sessionId: 'session-other' })

    const page1 = repo.listLedger({ sessionId: 'session-l', limit: 2 })
    expect(page1.total).toBe(5)
    expect(page1.items.map((row) => row.id)).toEqual(['l5', 'l4'])
    expect(page1.nextCursor).toBe(4)

    const page2 = repo.listLedger({
      sessionId: 'session-l',
      limit: 2,
      ...(page1.nextCursor != null ? { cursor: page1.nextCursor } : {}),
    })
    expect(page2.items.map((row) => row.id)).toEqual(['l3', 'l2'])
    expect(page2.nextCursor).toBe(2)

    const page3 = repo.listLedger({
      sessionId: 'session-l',
      limit: 2,
      ...(page2.nextCursor != null ? { cursor: page2.nextCursor } : {}),
    })
    expect(page3.items.map((row) => row.id)).toEqual(['l1'])
    expect(page3.nextCursor).toBeNull()

    // 过滤条件与 total
    expect(repo.listLedger({ sessionId: 'session-l', turnId: 'turn-1' }).total).toBe(3)
    expect(repo.listLedger({ sessionId: 'session-l', toolName: 'Read' }).total).toBe(2)
    expect(repo.listLedger({ chainSessionId: 'session-other' }).total).toBe(1)
  })

  it('statsBySession aggregates status/source/tool, percentiles, bytes and time range', () => {
    const rows = [
      {
        id: 's1',
        tool: 'Bash',
        status: 'ok' as const,
        dur: 10,
        started: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 's2',
        tool: 'Read',
        status: 'ok' as const,
        dur: 20,
        started: '2026-03-01T00:01:00.000Z',
      },
      {
        id: 's3',
        tool: 'Bash',
        status: 'error' as const,
        dur: 30,
        started: '2026-03-01T00:02:00.000Z',
      },
      {
        id: 's4',
        tool: 'Edit',
        status: 'ok' as const,
        dur: 40,
        started: '2026-03-01T00:03:00.000Z',
      },
      {
        id: 's5',
        tool: 'Bash',
        status: 'ok' as const,
        dur: 50,
        started: '2026-03-01T00:04:00.000Z',
      },
    ]
    for (const [index, r] of rows.entries()) {
      const row = append({
        id: r.id,
        sessionId: 'session-stats',
        toolName: r.tool,
        startedAt: r.started,
      })
      repo.finish(row.id, {
        status: r.status,
        durationMs: r.dur,
        outputBytes: (index + 1) * 100,
        finishedAt: new Date(Date.parse(r.started) + r.dur).toISOString(),
      })
    }

    const stats = repo.statsBySession('session-stats')
    expect(stats.total).toBe(5)
    expect(stats.byStatus).toEqual({ ok: 4, error: 1 })
    expect(stats.bySourceKind).toEqual({ 'sdk-builtin': 5 })
    expect(stats.byTool).toEqual([
      { toolName: 'Bash', count: 3 },
      { toolName: 'Edit', count: 1 },
      { toolName: 'Read', count: 1 },
    ])
    // durations [10,20,30,40,50]：nearest-rank p50=30（秩3），p95=50（秩5）
    expect(stats.durationP50Ms).toBe(30)
    expect(stats.durationP95Ms).toBe(50)
    expect(stats.totalOutputBytes).toBe(1500)
    expect(stats.firstStartedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(stats.lastFinishedAt).toBe('2026-03-01T00:04:00.050Z')
    // 空会话
    expect(repo.statsBySession('no-such-session').total).toBe(0)
    expect(repo.statsBySession('no-such-session').durationP50Ms).toBeNull()
  })

  it('reconcileStale promotes hanging running rows with a supplementary hash', () => {
    append({ id: 'hang-1', sessionId: 'session-h', startedAt: '2026-01-01T00:00:00.000Z' })
    append({ id: 'fresh-1', sessionId: 'session-h', startedAt: '2026-03-10T00:00:00.000Z' })

    const changed = repo.reconcileStale('2026-03-01T00:00:00.000Z')
    expect(changed).toBe(1)

    const stale = repo.get('hang-1')
    expect(stale).toMatchObject({ status: 'stale', finished_at: '2026-03-01T00:00:00.000Z' })
    expect(stale?.finished_record_hash).toMatch(/^[0-9a-f]{64}$/)
    // 新近 running 行不受影响
    expect(repo.get('fresh-1')?.status).toBe('running')
    // 对账后链仍完整（创建态哈希未被触碰）
    expect(repo.verifyChain('session-h')).toMatchObject({ valid: true, checkedCount: 2 })
  })

  it('prune deletes old rows and only reports artifacts with no remaining references', () => {
    const sharedArtifact = 'e'.repeat(64)
    const oldRow = append({
      id: 'old-1',
      sessionId: 'session-pr',
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    repo.finish(oldRow.id, {
      status: 'ok',
      outputArtifactId: sharedArtifact,
      outputSha256: sharedArtifact,
      finishedAt: '2026-01-01T00:00:01.000Z',
    })
    const oldRow2 = append({
      id: 'old-2',
      sessionId: 'session-pr',
      startedAt: '2026-01-02T00:00:00.000Z',
    })
    repo.finish(oldRow2.id, {
      status: 'ok',
      outputArtifactId: 'f'.repeat(64),
      finishedAt: '2026-01-02T00:00:01.000Z',
    })
    // 新行复用 old-1 的同一内容寻址载荷 → 该 artifact 不能进清理清单
    const newRow = append({
      id: 'new-1',
      sessionId: 'session-pr',
      startedAt: '2026-03-01T00:00:00.000Z',
    })
    repo.finish(newRow.id, {
      status: 'ok',
      outputArtifactId: sharedArtifact,
      finishedAt: '2026-03-01T00:00:01.000Z',
    })

    const result = repo.prune('2026-02-01T00:00:00.000Z')
    expect(result.deletedRows).toBe(2)
    expect(result.artifactIds).toEqual(['f'.repeat(64)])
    // 剩余行及其 artifact 引用完好
    expect(repo.get('new-1')?.output_artifact_id).toBe(sharedArtifact)
    // 审查 D2 回归：prune 截断后保留段首行的 prev_hash 指向被删行——
    // verifyChain 必须仍判 valid（段首跳过 prev 检查），不得误报链断裂。
    const verified = repo.verifyChain('session-pr')
    expect(verified.valid).toBe(true)
    expect(verified.checkedCount).toBeGreaterThanOrEqual(1)
    // 段首豁免只免 prev 检查，行内容篡改仍必须可检（hash-mismatch）。
    db.raw.prepare("UPDATE tool_invocations SET tool_name = 'tampered' WHERE id = 'new-1'").run()
    expect(repo.verifyChain('session-pr').valid).toBe(false)
  })

  it('prune keeps chain-integrity over retention: out-of-order old rows beyond the seq prefix survive', () => {
    // 审查 P1-1：seq 按到达序、created_at 按事件时钟，两域可倒挂。
    // 链内 seq1(new) / seq2(old) / seq3(new)：按时间删 seq2 会在链中段掏空 →
    // verifyChain 永久误报 prev-mismatch。前缀删除只删 seq < 幸存最小 seq 的行。
    const seqNew1 = append({
      id: 'o-1',
      sessionId: 'session-oo',
      startedAt: '2026-03-05T00:00:00.000Z',
    })
    const seqOld = append({
      id: 'o-2',
      sessionId: 'session-oo',
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    const seqNew2 = append({
      id: 'o-3',
      sessionId: 'session-oo',
      startedAt: '2026-03-06T00:00:00.000Z',
    })
    expect(seqNew1.ledger_seq).toBeLessThan(seqOld.ledger_seq)
    expect(seqOld.ledger_seq).toBeLessThan(seqNew2.ledger_seq)
    for (const id of ['o-1', 'o-2', 'o-3']) {
      repo.finish(id, { status: 'ok', finishedAt: '2026-03-06T00:00:01.000Z' })
    }

    const result = repo.prune('2026-02-01T00:00:00.000Z')
    // o-2 超保留期但 seq 高于幸存最小 seq（o-1 的 seq）——必须保留
    expect(result.deletedRows).toBe(0)
    expect(repo.get('o-2')).toBeDefined()
    // 链完整
    expect(repo.verifyChain('session-oo').valid).toBe(true)

    // 整链全旧（幸存集为空）→ 整链删除
    const allOld = append({
      id: 'oo-a',
      sessionId: 'session-oo2',
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    append({ id: 'oo-b', sessionId: 'session-oo2', startedAt: '2026-01-02T00:00:00.000Z' })
    expect(allOld.ledger_seq).toBeGreaterThan(0)
    const result2 = repo.prune('2026-02-01T00:00:00.000Z')
    expect(repo.get('oo-a')).toBeUndefined()
    expect(repo.get('oo-b')).toBeUndefined()
    expect(result2.deletedRows).toBeGreaterThanOrEqual(2)
  })

  it('finish refuses to overwrite terminal rows (terminal immutability, P2-3)', () => {
    const row = append({ id: 'term-1', sessionId: 'session-term' })
    repo.finish(row.id, { status: 'ok', finishedAt: '2026-01-01T00:00:05.000Z' })
    // 迟到的失败收尾不得覆写已终态行
    const late = repo.finish(row.id, {
      status: 'error',
      errorMessage: 'late failure must not win',
      finishedAt: '2026-01-01T00:00:09.000Z',
    })
    expect(late).toBeUndefined()
    const after = repo.get(row.id)
    expect(after?.status).toBe('ok')
    expect(after?.error_message).toBeNull()
    // 链校验不受影响
    expect(repo.verifyChain('session-term').valid).toBe(true)
  })

  it('finalizeByCorrelation narrows by session when provided (F4)', () => {
    // running 态部分唯一索引已结构性保证同一 correlationId 至多一条 running 行；
    // 会话收窄是纵深防御：会话键不匹配时即使全局存在 running 行也不得误收。
    const a = append({
      id: 'fa-1',
      sessionId: 'session-fa',
      correlationId: 'mcp-42',
    })
    // 错会话的收尾：全局有 running 行但会话键不匹配 → no-op
    expect(
      repo.finalizeByCorrelation(
        'mcp-42',
        { status: 'ok', finishedAt: '2026-01-01T00:00:05.000Z' },
        'session-fb',
      ),
    ).toBeUndefined()
    expect(repo.get('fa-1')?.status).toBe('running')
    // 正确会话键 → 收尾成功
    const finished = repo.finalizeByCorrelation(
      'mcp-42',
      { status: 'ok', finishedAt: '2026-01-01T00:00:06.000Z' },
      'session-fa',
    )
    expect(finished?.id).toBe(a.id)
    expect(repo.get('fa-1')?.status).toBe('ok')
  })

  it('listLedger toolName filter is contains-match with LIKE escaping (U1)', () => {
    append({
      id: 'l-1',
      sessionId: 'session-l',
      toolName: 'mcp__spark_plugins__spark_wiki__wiki_search',
    })
    append({ id: 'l-2', sessionId: 'session-l', toolName: 'Bash' })
    append({ id: 'l-3', sessionId: 'session-l', toolName: 'a%b_c' })
    // 部分词命中
    expect(
      repo.listLedger({ sessionId: 'session-l', toolName: 'wiki' }).items.map((r) => r.id),
    ).toEqual(['l-1'])
    // 大小写不敏感命中（SQLite LIKE 默认 ASCII 不敏感）
    expect(
      repo.listLedger({ sessionId: 'session-l', toolName: 'bash' }).items.map((r) => r.id),
    ).toEqual(['l-2'])
    // LIKE 通配符被转义：用户输入 % 不再当通配符
    expect(
      repo.listLedger({ sessionId: 'session-l', toolName: '%' }).items.map((r) => r.id),
    ).toEqual(['l-3'])
    expect(
      repo.listLedger({ sessionId: 'session-l', toolName: 'a%b' }).items.map((r) => r.id),
    ).toEqual(['l-3'])
    expect(repo.listLedger({ sessionId: 'session-l', toolName: 'a_b' }).items).toEqual([])
    expect(repo.listLedger({ sessionId: 'session-l', toolName: 'a%b_c' }).total).toBe(1)
  })

  it('verifyChain detects attribution tampering on v2 rows and stays compatible with v1 rows (P2-2)', () => {
    // v2 行：归因列篡改（turn_id 挪到别的轮次）必须被主链哈希检出
    const v2row = append({
      id: 'v2-1',
      sessionId: 'session-v2',
      turnId: 'turn-1',
      memberAgentId: 'member-a',
    })
    db.raw.prepare("UPDATE tool_invocations SET turn_id = 'turn-hijacked' WHERE id = 'v2-1'").run()
    const broken = repo.verifyChain('session-v2')
    expect(broken.valid).toBe(false)
    expect(broken.break?.reason).toBe('hash-mismatch')
    // 复原后 valid
    db.raw.prepare("UPDATE tool_invocations SET turn_id = 'turn-1' WHERE id = 'v2-1'").run()
    expect(repo.verifyChain('session-v2').valid).toBe(true)
    expect(v2row.turn_id).toBe('turn-1')
  })

  it('verifyChain flags terminal rows whose finished hash was erased (P3-3)', () => {
    const row = append({ id: 'fh-1', sessionId: 'session-fh' })
    repo.finish(row.id, { status: 'ok', finishedAt: '2026-01-01T00:00:05.000Z' })
    expect(repo.verifyChain('session-fh').valid).toBe(true)
    // 抹掉收尾哈希 = 廉价篡改路径，必须视为断链而非跳过
    db.raw
      .prepare('UPDATE tool_invocations SET finished_record_hash = NULL WHERE id = ?')
      .run(row.id)
    const broken = repo.verifyChain('session-fh')
    expect(broken.valid).toBe(false)
    expect(broken.break?.reason).toBe('missing-finish-hash')
  })

  it('enforces at most one running row per correlation_id', () => {
    append({ id: 'c1', sessionId: 'session-c' })
    expect(() =>
      repo.appendLedger({
        id: 'c1b',
        correlationId: 'c1',
        sourceKind: 'sdk-builtin',
        sourceId: 'test-source',
        toolName: 'Bash',
        invocationSource: 'model',
        sessionId: 'session-c',
      }),
    ).toThrow(/UNIQUE/)
  })

  // ── 以下两例自 HEAD 恢复（P1 重写本文件时误覆盖，git 取回合并）─────────────

  it('records privacy-preserving lifecycle data and supports filtered pagination', () => {
    repo.start({
      id: 'invocation-1',
      correlationId: 'correlation-1',
      sourceKind: 'tool-package',
      sourceId: 'acme.tools',
      packageId: 'acme.tools',
      toolName: 'search',
      version: '1.0.0',
      adapter: 'process',
      sessionId: 'session-1',
      invocationSource: 'model',
      inputSha256: 'a'.repeat(64),
      startedAt: '2026-09-05T00:00:00.000Z',
    })
    const finished = repo.finish('invocation-1', {
      status: 'ok',
      outputBytes: 128,
      finishedAt: '2026-09-05T00:00:00.025Z',
    })
    expect(finished).toMatchObject({
      status: 'ok',
      duration_ms: 25,
      output_bytes: 128,
      input_sha256: 'a'.repeat(64),
    })
    expect(repo.list({ sessionId: 'session-1', limit: 20 })).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ correlation_id: 'correlation-1' })],
    })
    expect(repo.list({ status: 'error' }).total).toBe(0)
  })

  it('backfills legacy Custom Tool history idempotently', () => {
    const timestamp = '2026-09-04T23:59:00.000Z'
    db.raw
      .prepare(
        `INSERT INTO custom_tools(
          id, title, description, type, input_schema_json, spec_json, risk, effect,
          idempotency, timeout_ms, enabled, origin, published_version, draft_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'http', '{}', '{}', 'read', 'read', 'safe', 30000, 1, 'local', 1, 1, ?, ?)`,
      )
      .run('legacy-search', 'Legacy search', 'Legacy history fixture', timestamp, timestamp)
    db.raw
      .prepare(
        `INSERT INTO custom_tool_invocations(
          tool_id, session_id, turn_id, input_sha256, status, duration_ms,
          output_bytes, created_at, tool_version, source
        ) VALUES (?, ?, ?, ?, 'ok', 25, 64, ?, 1, 'model')`,
      )
      .run('legacy-search', 'session-legacy', 'turn-legacy', 'b'.repeat(64), timestamp)
    db.raw.prepare('DELETE FROM schema_migrations WHERE version = 95').run()

    // 095 在 121 之后的重放（修复库场景）：新表两列 NOT NULL 有 DEFAULT 兜底，不崩库
    db.runMigrations(join(process.cwd(), 'migrations'))
    db.raw.prepare('DELETE FROM schema_migrations WHERE version = 95').run()
    db.runMigrations(join(process.cwd(), 'migrations'))

    expect(repo.list({ sourceKind: 'custom-tool', sourceId: 'legacy-search' })).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          id: 'legacy-custom-tool-1',
          session_id: 'session-legacy',
          invocation_source: 'model',
          status: 'ok',
        }),
      ],
    })
  })

  it('listMcpUsageBySession groups mcp rows by server with tools/calls/lastStartedAt', () => {
    const appendMcp = (params: {
      id: string
      sessionId: string
      toolName: string
      serverId: string
      startedAt: string
    }) =>
      repo.appendLedger({
        id: params.id,
        correlationId: params.id,
        sourceKind: 'mcp',
        sourceId: params.serverId,
        toolName: params.toolName,
        invocationSource: 'model',
        mcpServerId: params.serverId,
        sessionId: params.sessionId,
        startedAt: params.startedAt,
      })

    appendMcp({
      id: 'm1',
      sessionId: 'session-journey',
      toolName: 'mcp__search__web_search',
      serverId: 'search',
      startedAt: '2026-10-23T10:00:00.000Z',
    })
    appendMcp({
      id: 'm2',
      sessionId: 'session-journey',
      toolName: 'mcp__search__fetch_url',
      serverId: 'search',
      startedAt: '2026-10-23T11:00:00.000Z',
    })
    appendMcp({
      id: 'm3',
      sessionId: 'session-journey',
      toolName: 'mcp__canvas__node_add',
      serverId: 'canvas',
      startedAt: '2026-10-23T09:00:00.000Z',
    })
    // 非本会话 / 非 mcp 来源不参与聚合
    appendMcp({
      id: 'm4',
      sessionId: 'session-other',
      toolName: 'mcp__search__web_search',
      serverId: 'search',
      startedAt: '2026-10-23T12:00:00.000Z',
    })
    append({ id: 'b1', sessionId: 'session-journey', toolName: 'Bash' })

    expect(repo.listMcpUsageBySession('session-journey')).toEqual([
      {
        serverId: 'search',
        tools: 2,
        calls: 2,
        lastStartedAt: '2026-10-23T11:00:00.000Z',
      },
      {
        serverId: 'canvas',
        tools: 1,
        calls: 1,
        lastStartedAt: '2026-10-23T09:00:00.000Z',
      },
    ])
  })

  it('listRecentByToolNames returns matching rows newest-first with budget', () => {
    append({ id: 'w1', sessionId: 'session-journey', toolName: 'WebSearch' })
    append({ id: 'b1', sessionId: 'session-journey', toolName: 'Bash' })
    append({ id: 'w2', sessionId: 'session-journey', toolName: 'WebFetch' })
    append({ id: 'w3', sessionId: 'session-other', toolName: 'WebSearch' })

    const rows = repo.listRecentByToolNames('session-journey', ['WebSearch', 'WebFetch'], 10)
    expect(rows.map((row) => row.id)).toEqual(['w2', 'w1'])
    expect(repo.listRecentByToolNames('session-journey', [], 10)).toEqual([])
    expect(
      repo
        .listRecentByToolNames('session-journey', ['WebSearch', 'WebFetch'], 1)
        .map((row) => row.id),
    ).toEqual(['w2'])
  })
})
