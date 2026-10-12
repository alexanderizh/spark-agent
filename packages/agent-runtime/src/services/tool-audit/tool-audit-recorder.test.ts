/**
 * ToolAuditRecorder 聚焦单测（设计 §8 P2 验证要求：配对/去重/背压/脱敏/哈希链）。
 *
 * 直建 SparkDatabase（跑全量 migrations）+ flushSync 排空，覆盖三个采集点的
 * 关键行为与「审计故障不冒泡」约束。哈希链校验经 repository.verifyChain。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase, ToolInvocationRepository } from '@spark/storage'
import { ToolAuditRecorder } from './tool-audit-recorder.js'
import { AUDIT_PAYLOAD_DIRECTORY, canonicalJsonStringify } from './tool-audit-payload.js'

function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex')
}

describe('ToolAuditRecorder', () => {
  let db: SparkDatabase
  let recorder: ToolAuditRecorder
  let repo: ToolInvocationRepository
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'tool-audit-recorder-'))
    db = new SparkDatabase(path.join(testDir, 'audit-test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))
    repo = new ToolInvocationRepository(db)
    // 长 flush 间隔：测试统一用 flushSync 显式排空，避免定时器抢跑。
    recorder = new ToolAuditRecorder({ db, flushIntervalMs: 60_000 })
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      /* db already closed */
    }
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* Windows 句柄延迟释放时的残留目录交给系统临时区清理 */
    }
  })

  function rows(): ReturnType<ToolInvocationRepository['list']>['items'] {
    return repo.list({}).items
  }

  function firstRow(): ReturnType<ToolInvocationRepository['list']>['items'][number] {
    const row = rows()[0]
    if (row == null) throw new Error('期望至少一行账本记录')
    return row
  }

  it('事件漏斗配对：tool_call + tool_result → 单行 running→ok，duration 取事件权威值', () => {
    recorder.noteTurnRuntime('session-1', 'turn-1', 'claude', testDir)
    recorder.recordEventFunnel('session-1', 'turn-1', {
      type: 'tool_call',
      toolCallId: 'call-1',
      toolName: 'Bash',
      toolInput: { command: 'ls -la' },
      source: 'builtin',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    recorder.recordEventFunnel('session-1', 'turn-1', {
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'Bash',
      status: 'success',
      output: 'total 0',
      durationMs: 1234,
      timestamp: '2026-10-12T10:00:01.500Z',
    })
    recorder.flushSync()

    const items = rows()
    expect(items).toHaveLength(1)
    const row = firstRow()
    expect(row.status).toBe('ok')
    expect(row.tool_name).toBe('Bash')
    expect(row.source_kind).toBe('sdk-builtin')
    expect(row.invocation_source).toBe('model')
    expect(row.session_id).toBe('session-1')
    expect(row.turn_id).toBe('turn-1')
    expect(row.engine).toBe('claude')
    expect(row.duration_ms).toBe(1234)
    // 输入过脱敏管道后按 canonical-json 入哈希；内容寻址归档同表示。
    expect(row.input_sha256).toBe(sha256Of({ command: 'ls -la' }))
    expect(row.input_artifact_id).toBe(row.input_sha256)
    const archived = path.join(testDir, ...AUDIT_PAYLOAD_DIRECTORY, `${row.input_sha256}.json`)
    expect(existsSync(archived)).toBe(true)
    expect(JSON.parse(readFileSync(archived, 'utf8') as string)).toEqual({ command: 'ls -la' })
  })

  it('去重：目录工具（spark_plugins 桥接名 + 名册登记）在事件漏斗跳过，不双行', () => {
    recorder.noteCatalogSnapshot([{ qualifiedName: 'my_custom_tool' }])
    recorder.recordEventFunnel('session-2', 'turn-2', {
      type: 'tool_call',
      toolCallId: 'call-2',
      toolName: 'mcp__spark_plugins__my_custom_tool',
      toolInput: { q: 'hi' },
      source: 'mcp',
      mcpServerId: 'spark_plugins',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    recorder.recordEventFunnel('session-2', 'turn-2', {
      type: 'tool_result',
      toolCallId: 'call-2',
      toolName: 'mcp__spark_plugins__my_custom_tool',
      status: 'success',
      timestamp: '2026-10-12T10:00:00.500Z',
    })
    recorder.flushSync()
    expect(rows()).toHaveLength(0)
  })

  it('去重（chat 模式）：目录工具以裸 qualifiedName 直注 native function calling，事件 source=builtin 也跳过（F1）', () => {
    recorder.noteCatalogSnapshot([{ qualifiedName: 'my_custom_tool' }])
    recorder.recordEventFunnel('session-2b', 'turn-2b', {
      type: 'tool_call',
      toolCallId: 'call-2b',
      // codex chat 模式：executor 硬编码 source='builtin'，工具名就是裸 qualifiedName
      toolName: 'my_custom_tool',
      toolInput: { q: 'hi' },
      source: 'builtin',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    recorder.flushSync()
    expect(rows()).toHaveLength(0)
    // 名册外的 builtin 工具（SDK 原生 Bash）照常入账
    recorder.recordEventFunnel('session-2b', 'turn-2b', {
      type: 'tool_call',
      toolCallId: 'call-2c',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      source: 'builtin',
      timestamp: '2026-10-12T10:00:01.000Z',
    })
    recorder.flushSync()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.tool_name).toBe('Bash')
  })

  it('名册并集：新快照不撤销旧名登记，目录变更瞬间在飞调用不双行（F8）', () => {
    recorder.noteCatalogSnapshot([{ qualifiedName: 'tool_old' }])
    // 后续快照只剩 tool_new（tool_old 被禁用/卸载）
    recorder.noteCatalogSnapshot([{ qualifiedName: 'tool_new' }])
    // 持旧 bridge 定义的会话仍以旧名调用 → 包装层记账，漏斗必须仍跳过
    recorder.recordEventFunnel('session-2d', 'turn-2d', {
      type: 'tool_call',
      toolCallId: 'call-2d',
      toolName: 'tool_old',
      toolInput: {},
      source: 'builtin',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    recorder.flushSync()
    expect(rows()).toHaveLength(0)
  })

  it('classifyResult：MCP isError:true 正常 resolve 也按 error 入账（F2），错误输出不归档', async () => {
    await recorder.wrapDirectInvocation(
      { sourceKind: 'mcp', sourceId: 'srv-x', toolName: 'failing_tool', mcpServerId: 'srv-x' },
      { sessionId: 'session-f2', invocationSource: 'workflow' },
      { a: 1 },
      () =>
        Promise.resolve({
          isError: true,
          content: [{ type: 'text', text: 'boom sk-abcdef0123456789abcdef' }],
        }),
      {
        classifyResult: (result) =>
          result.isError === true
            ? { status: 'error', errorMessage: 'tool failed: token sk-abcdef0123456789abcdef' }
            : null,
      },
    )
    recorder.flushSync()
    const row = firstRow()
    expect(row.status).toBe('error')
    // 错误正文含凭据：errorMessage 列经内容级掩码（S1）后不得明文保留
    expect(row.error_message).toBe('tool failed: token ***')
  })

  it('背压：队列超限丢最旧并计数，stats 可观测', () => {
    const tiny = new ToolAuditRecorder({ db, maxQueue: 2, flushIntervalMs: 60_000 })
    for (let i = 0; i < 5; i += 1) {
      tiny.recordDirectStart(
        { sourceKind: 'mcp', sourceId: 'srv', toolName: `tool-${i}` },
        { invocationSource: 'workflow' },
        { i },
      )
    }
    const stats = tiny.stats()
    expect(stats.droppedCount).toBe(3)
    expect(stats.queued).toBe(2)
    tiny.dispose()
  })

  it('脱敏：敏感键入哈希前掩码，归档明文永不落盘', () => {
    recorder.noteTurnRuntime('session-3', 'turn-3', 'spark', testDir)
    recorder.recordEventFunnel('session-3', 'turn-3', {
      type: 'tool_call',
      toolCallId: 'call-3',
      toolName: 'WebFetch',
      toolInput: {
        url: 'https://example.com',
        api_key: 'sk-live-SECRET',
        nested: { token: 'abc' },
      },
      source: 'builtin',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    recorder.flushSync()

    const row = firstRow()
    // 归档文件是脱敏表示：明文密钥绝不出现，非敏感字段保留。
    const archivedPath = path.join(testDir, ...AUDIT_PAYLOAD_DIRECTORY, `${row.input_sha256}.json`)
    const archived = existsSync(archivedPath) ? (readFileSync(archivedPath, 'utf8') as string) : ''
    expect(archived).not.toContain('sk-live-SECRET')
    expect(archived).not.toContain('abc')
    expect(archived).toContain('https://example.com')
  })

  it('哈希链：多行串链校验通过；篡改可检', () => {
    recorder.recordDirectStart(
      { sourceKind: 'mcp', sourceId: 'srv-a', toolName: 't1' },
      { sessionId: 's-chain', turnId: 'turn-chain', invocationSource: 'workflow' },
      { a: 1 },
    )
    recorder.recordDirectStart(
      { sourceKind: 'mcp', sourceId: 'srv-a', toolName: 't2' },
      { sessionId: 's-chain', turnId: 'turn-chain', invocationSource: 'workflow' },
      { b: 2 },
    )
    recorder.flushSync()

    const ok = repo.verifyChain('s-chain')
    expect(ok.valid).toBe(true)

    db.raw
      .prepare(
        `UPDATE tool_invocations SET source_id = 'tampered' WHERE session_id = 's-chain' AND tool_name = 't1'`,
      )
      .run()
    const broken = repo.verifyChain('s-chain')
    expect(broken.valid).toBe(false)
  })

  it('直记 API：start/finish 按行 id 配对，失败态带 errorCode/errorMessage 与归档输出', () => {
    const rowId = recorder.recordDirectStart(
      { sourceKind: 'tool-package', sourceId: 'pkg-1', packageId: 'pkg-1', toolName: 'run' },
      { sessionId: 's-direct', invocationSource: 'test' },
      { x: 1 },
    )
    recorder.recordDirectFinish(
      rowId,
      { status: 'timeout', errorCode: 'E_TIMEOUT', errorMessage: 'timed out after 30s' },
      { error: 'timeout' },
      's-direct',
    )
    recorder.flushSync()

    const row = firstRow()
    expect(row.id).toBe(rowId)
    expect(row.status).toBe('timeout')
    expect(row.error_code).toBe('E_TIMEOUT')
    expect(row.error_message).toContain('timed out')
    expect(row.output_bytes).toBeGreaterThan(0)
  })

  it('目录包装：成功与异常透传，异常行记 error 且 rethrow 原错误', async () => {
    recorder.noteTurnRuntime('s-wrap', 'turn-wrap', 'codex', testDir)
    const out = await recorder.wrapCatalogInvoke(
      { sourceKind: 'connector', sourceId: 'gh', toolName: 'create_issue' },
      { sessionId: 's-wrap', turnId: 'turn-wrap', invocationSource: 'model' },
      { title: 'x' },
      async () => ({ number: 42 }),
    )
    expect(out).toEqual({ number: 42 })

    await expect(
      recorder.wrapCatalogInvoke(
        { sourceKind: 'custom-tool', sourceId: 'ct-1', toolName: 'boom' },
        { sessionId: 's-wrap', turnId: 'turn-wrap', invocationSource: 'model' },
        {},
        async () => {
          throw new Error('kaput')
        },
      ),
    ).rejects.toThrow('kaput')

    recorder.flushSync()
    const items = rows()
    expect(items).toHaveLength(2)
    expect(items.find((r) => r.tool_name === 'create_issue')?.status).toBe('ok')
    expect(items.find((r) => r.tool_name === 'create_issue')?.engine).toBe('codex')
    const failRow = items.find((r) => r.tool_name === 'boom')
    expect(failRow?.status).toBe('error')
    expect(failRow?.error_message).toContain('kaput')
  })

  it('崩溃恢复：构造时遗留 running 对账为 stale', () => {
    recorder.recordDirectStart(
      { sourceKind: 'mcp', sourceId: 'srv', toolName: 'stale-tool' },
      { sessionId: 's-stale', invocationSource: 'workflow' },
      {},
    )
    recorder.flushSync()
    expect(rows()[0]?.status).toBe('running')

    const reborn = new ToolAuditRecorder({ db, flushIntervalMs: 60_000 })
    reborn.dispose()
    expect(rows()[0]?.status).toBe('stale')
  })

  it('审计故障不冒泡：flusher 内部异常只计数告警，不抛出到调用方', () => {
    recorder.recordEventFunnel('s-x', 't-x', {
      type: 'tool_call',
      toolCallId: 'c-x',
      toolName: 'Read',
      toolInput: {},
      source: 'builtin',
      timestamp: '2026-10-12T10:00:00.000Z',
    })
    expect(() => recorder.flushSync()).not.toThrow()
  })
})
