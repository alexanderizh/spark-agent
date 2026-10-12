import { createHash } from 'node:crypto'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export type ToolInvocationSourceKind =
  | 'sdk-builtin'
  | 'mcp'
  | 'custom-tool'
  | 'tool-package'
  | 'connector'
  | 'workflow'
  | 'hook'
  | 'test'
export type ToolInvocationSource = 'model' | 'workflow' | 'test' | 'platform' | 'nested' | 'hook'
export type ToolInvocationStatus =
  | 'running'
  | 'ok'
  | 'error'
  | 'timeout'
  | 'denied'
  | 'cancelled'
  | 'stale'

/** 哈希链分链键：会话行 = session_id；无会话的工作流调用 = 'wf:<workflowId>'；两者皆无 = 'unattributed'。 */
export const UNATTRIBUTED_CHAIN_ID = 'unattributed'
export const WORKFLOW_CHAIN_PREFIX = 'wf:'

export interface ToolInvocationRow {
  id: string
  ledger_seq: number
  correlation_id: string | null
  chain_session_id: string
  prev_hash: string | null
  record_hash: string | null
  finished_record_hash: string | null
  session_id: string | null
  turn_id: string | null
  project_id: string | null
  agent_id: string | null
  workflow_id: string | null
  member_agent_id: string | null
  dispatch_id: string | null
  hook_id: string | null
  hook_run_id: string | null
  tool_id: string | null
  tool_name: string
  source_kind: ToolInvocationSourceKind
  invocation_source: ToolInvocationSource
  mcp_server_id: string | null
  engine: string | null
  source_id: string
  package_id: string | null
  version: string | null
  adapter: string | null
  status: ToolInvocationStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  retry_count: number
  input_sha256: string | null
  input_bytes: number | null
  input_artifact_id: string | null
  output_bytes: number | null
  output_sha256: string | null
  output_artifact_id: string | null
  result_truncated: number
  result_archived: number
  created_at: string
}

export interface StartToolInvocationParams {
  id: string
  correlationId: string
  sourceKind: ToolInvocationSourceKind
  sourceId: string
  packageId?: string
  toolId?: string
  toolName: string
  version?: string
  adapter?: string
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  invocationSource: ToolInvocationSource
  /** Hook 来源调用归因（invocationSource='hook' 时提供）。 */
  hookId?: string
  hookRunId?: string
  inputSha256: string
  startedAt?: string
}

/** 审计账本追加参数：start() 的超集（P2 采集层使用）。 */
export interface AppendToolLedgerParams {
  id: string
  /** 跨表关联与去重键（tool_call 事件 id / 目录调用 id）；缺省时用 id 顶替。 */
  correlationId?: string
  /** 显式分链键；缺省按 sessionId / workflowId 推导。 */
  chainSessionId?: string
  sourceKind: ToolInvocationSourceKind
  sourceId: string
  packageId?: string
  toolId?: string
  toolName: string
  version?: string
  adapter?: string
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  memberAgentId?: string
  dispatchId?: string
  hookId?: string
  hookRunId?: string
  invocationSource: ToolInvocationSource
  mcpServerId?: string
  /** 'claude' | 'codex' | 'spark'（模型路径才有）。 */
  engine?: string
  inputSha256?: string
  inputBytes?: number
  inputArtifactId?: string
  startedAt?: string
}

export interface FinishToolInvocationParams {
  status: Exclude<ToolInvocationStatus, 'running'>
  errorCode?: string
  /** 脱敏后截断的错误正文（≤2000 字符，由采集层负责截断）。 */
  errorMessage?: string
  outputBytes?: number
  outputSha256?: string
  outputArtifactId?: string
  resultArchived?: boolean
  resultTruncated?: boolean
  retryCount?: number
  /** 事件侧有权威耗时时优先传入；缺省用 started_at→finished_at 墙钟差。 */
  durationMs?: number
  finishedAt?: string
}

export interface ListToolInvocationsParams {
  sourceKind?: ToolInvocationSourceKind
  sourceId?: string
  packageId?: string
  toolName?: string
  sessionId?: string
  status?: ToolInvocationStatus
  correlationId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/** 检查器账本查询：ledger_seq 游标向下翻页（新→旧）。 */
export interface ListToolLedgerParams {
  sessionId?: string
  chainSessionId?: string
  turnId?: string
  toolName?: string
  sourceKind?: ToolInvocationSourceKind
  invocationSource?: ToolInvocationSource
  status?: ToolInvocationStatus
  memberAgentId?: string
  correlationId?: string
  /** 取 ledger_seq 严格小于该值的行（上一页最后一行的 ledger_seq）。 */
  cursor?: number
  limit?: number
}

export interface ListToolLedgerResult {
  items: ToolInvocationRow[]
  nextCursor: number | null
  total: number
}

export interface ToolLedgerStats {
  sessionId: string
  total: number
  byStatus: Partial<Record<ToolInvocationStatus, number>>
  bySourceKind: Partial<Record<ToolInvocationSourceKind, number>>
  byTool: Array<{ toolName: string; count: number }>
  durationP50Ms: number | null
  durationP95Ms: number | null
  totalInputBytes: number
  totalOutputBytes: number
  firstStartedAt: string | null
  lastFinishedAt: string | null
}

export type VerifyChainBreakReason =
  | 'hash-mismatch'
  | 'finish-hash-mismatch'
  | 'prev-mismatch'
  | 'seq-order'
  | 'missing-finish-hash'

export interface VerifyChainResult {
  chainSessionId: string
  valid: boolean
  /** 实际校验过哈希的记录数（NULL 哈希的回填行不计）。 */
  checkedCount: number
  break?: {
    ledgerSeq: number
    reason: VerifyChainBreakReason
    expectedRecordHash?: string
    actualRecordHash?: string | null
  }
}

export interface PruneToolLedgerResult {
  deletedRows: number
  /** 删除后已无任何账本行引用、可安全清理的载荷归档 id。 */
  artifactIds: string[]
}

/**
 * 主链哈希覆盖的字段子集（v2）：只含 INSERT 后不可变的身份与归因字段。
 * 设计方案 §4.4 原稿把 status/finished_at/duration_ms 等生命周期字段也纳入主链，
 * 但 finish() 是合法状态推进会改写这些列——用当前行值重算创建态哈希必然失配。
 * 修正口径：不可变身份归主链（record_hash），可变生命周期归补充哈希（finished_record_hash）。
 * 审查 P2-2：v1 字段集漏了全部归因列（session/turn/member/engine/invocation_source/
 * mcp_server_id/tool_id/id），改值不报警——v2 全部纳入。字段集不得再变更，变更即断链。
 */
interface RecordHashFields {
  ledger_seq: number
  id: string
  correlation_id: string | null
  chain_session_id: string
  session_id: string | null
  turn_id: string | null
  member_agent_id: string | null
  dispatch_id: string | null
  engine: string | null
  invocation_source: ToolInvocationSource
  mcp_server_id: string | null
  tool_id: string | null
  tool_name: string
  source_kind: ToolInvocationSourceKind
  /** 定位「哪个工具」的身份三要素之一（source_kind + source_id + tool_name），防篡改必覆盖。 */
  source_id: string
  started_at: string
  input_sha256: string | null
  input_bytes: number | null
}

/**
 * v1 主链字段集（历史行兼容验算）：v2 上线前写入的行按此口径校验。
 * v1 行的归因列篡改不可检（字段集不含），属滚动加固的已接受边界。
 */
interface RecordHashFieldsV1 {
  ledger_seq: number
  correlation_id: string | null
  chain_session_id: string
  tool_name: string
  source_kind: ToolInvocationSourceKind
  source_id: string
  started_at: string
  input_sha256: string | null
  input_bytes: number | null
}

/** 收尾态补充哈希覆盖的字段子集（finish / reconcileStale 推进时写入）。 */
interface FinishedHashFields {
  ledger_seq: number
  status: ToolInvocationStatus
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  output_bytes: number | null
  output_sha256: string | null
  retry_count: number
}

/** 稳定键序 JSON（哈希输入的规范化序列化；只处理 null/字符串/数字/数组/纯对象）。 */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (type === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return 'null'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** LIKE 通配符转义（配合 ESCAPE '\' 子句）：用户输入的 %/_/\ 失去特殊含义。 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** record_hash = sha256(prev_hash || '\n' || canonical_json(创建态字段))；链首 prev_hash 为空串。 */
function computeRecordHash<T extends object>(fields: T, prevHash: string | null): string {
  return sha256Hex(`${prevHash ?? ''}\n${canonicalJson(fields)}`)
}

function computeFinishedRecordHash(fields: FinishedHashFields): string {
  return sha256Hex(canonicalJson(fields))
}

export class ToolInvocationRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'tool_invocations')
  }

  /** 兼容入口：现有 custom-tool / tool-package 写入方零改动继续工作，行同样入链。 */
  start(params: StartToolInvocationParams): ToolInvocationRow {
    return this.appendLedger(params)
  }

  /**
   * 追加一条审计账本行（status='running'），单事务内完成：
   * 分配全局 ledger_seq（MAX+1）→ 取分链前一条 record_hash 作 prev_hash →
   * 计算创建态 record_hash → INSERT。BEGIN IMMEDIATE：多连接拓扑（维护
   * worker）下 DEFERRED 读快照升级写会撞 BUSY_SNAPSHOT，先取写锁让
   * busy_timeout 生效（审查 P2-1）。
   */
  appendLedger(params: AppendToolLedgerParams): ToolInvocationRow {
    const startedAt = params.startedAt ?? new Date().toISOString()
    const chainSessionId =
      params.chainSessionId ??
      params.sessionId ??
      (params.workflowId != null
        ? `${WORKFLOW_CHAIN_PREFIX}${params.workflowId}`
        : UNATTRIBUTED_CHAIN_ID)
    const correlationId = params.correlationId ?? params.id
    this.transactionImmediate(() => {
      const seqRow = this.raw
        .prepare('SELECT COALESCE(MAX(ledger_seq), 0) + 1 AS seq FROM tool_invocations')
        .get() as { seq: number }
      const ledgerSeq = seqRow.seq
      const prevRow = this.raw
        .prepare(
          `SELECT record_hash FROM tool_invocations
           WHERE chain_session_id = ? AND record_hash IS NOT NULL
           ORDER BY ledger_seq DESC LIMIT 1`,
        )
        .get(chainSessionId) as { record_hash: string } | undefined
      const prevHash = prevRow?.record_hash ?? null
      const recordHash = computeRecordHash(
        {
          ledger_seq: ledgerSeq,
          id: params.id,
          correlation_id: correlationId,
          chain_session_id: chainSessionId,
          session_id: params.sessionId ?? null,
          turn_id: params.turnId ?? null,
          member_agent_id: params.memberAgentId ?? null,
          dispatch_id: params.dispatchId ?? null,
          engine: params.engine ?? null,
          invocation_source: params.invocationSource,
          mcp_server_id: params.mcpServerId ?? null,
          tool_id: params.toolId ?? null,
          tool_name: params.toolName,
          source_kind: params.sourceKind,
          source_id: params.sourceId,
          started_at: startedAt,
          input_sha256: params.inputSha256 ?? null,
          input_bytes: params.inputBytes ?? null,
        },
        prevHash,
      )
      this.raw
        .prepare(
          `INSERT INTO tool_invocations (
            id, ledger_seq, correlation_id, chain_session_id, prev_hash, record_hash,
            session_id, turn_id, project_id, agent_id, workflow_id,
            member_agent_id, dispatch_id, hook_id, hook_run_id,
            tool_id, tool_name, source_kind, invocation_source, mcp_server_id, engine,
            source_id, package_id, version, adapter,
            status, started_at, input_sha256, input_bytes, input_artifact_id, created_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?,
            'running',
            ?, ?, ?, ?, ?
          )`,
        )
        .run(
          params.id,
          ledgerSeq,
          correlationId,
          chainSessionId,
          prevHash,
          recordHash,
          params.sessionId ?? null,
          params.turnId ?? null,
          params.projectId ?? null,
          params.agentId ?? null,
          params.workflowId ?? null,
          params.memberAgentId ?? null,
          params.dispatchId ?? null,
          params.hookId ?? null,
          params.hookRunId ?? null,
          params.toolId ?? null,
          params.toolName,
          params.sourceKind,
          params.invocationSource,
          params.mcpServerId ?? null,
          params.engine ?? null,
          params.sourceId,
          params.packageId ?? null,
          params.version ?? null,
          params.adapter ?? null,
          startedAt,
          params.inputSha256 ?? null,
          params.inputBytes ?? null,
          params.inputArtifactId ?? null,
          startedAt,
        )
    })
    const inserted = this.get(params.id)
    if (inserted == null) {
      throw new Error(`tool_invocations insert failed to read back row ${params.id}`)
    }
    return inserted
  }

  /**
   * running→终态的合法状态推进：不改 record_hash（主链验创建态），
   * 另记 finished_record_hash 补充哈希（验收尾态字段子集）。
   * 终态不可变（审查 P2-3）：UPDATE 带 status='running' 守卫——reconcileStale
   * 推进为 stale 的行、或任何已终态行，迟到的 finish 一律 no-op 返回 undefined，
   * 不得无痕覆写终态历史。
   */
  finish(id: string, params: FinishToolInvocationParams): ToolInvocationRow | undefined {
    const current = this.get(id)
    if (current == null || current.status !== 'running') return undefined
    const finishedAt = params.finishedAt ?? new Date().toISOString()
    const durationMs =
      params.durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(current.started_at))
    const resultArchived =
      params.resultArchived === true ||
      (params.resultArchived == null && params.outputArtifactId != null)
        ? 1
        : 0
    const finishedHash = computeFinishedRecordHash({
      ledger_seq: current.ledger_seq,
      status: params.status,
      finished_at: finishedAt,
      duration_ms: durationMs,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage ?? null,
      output_bytes: params.outputBytes ?? null,
      output_sha256: params.outputSha256 ?? null,
      retry_count: Math.max(0, params.retryCount ?? 0),
    })
    this.raw
      .prepare(
        `UPDATE tool_invocations SET
          status = ?, finished_at = ?, duration_ms = ?, error_code = ?, error_message = ?,
          output_bytes = ?, output_sha256 = ?, output_artifact_id = ?,
          result_archived = ?, result_truncated = ?, retry_count = ?, finished_record_hash = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        params.status,
        finishedAt,
        durationMs,
        params.errorCode ?? null,
        params.errorMessage ?? null,
        params.outputBytes ?? null,
        params.outputSha256 ?? null,
        params.outputArtifactId ?? null,
        resultArchived,
        params.resultTruncated === true ? 1 : 0,
        Math.max(0, params.retryCount ?? 0),
        finishedHash,
        id,
      )
    return this.get(id)
  }

  /**
   * 采集层配对收尾：按 correlation_id 找最新一条 running 行执行 finish。
   * sessionId（审查 F4）：非 uuid 引擎兜底 id（codex `mcp-{seq}`）跨会话可重复，
   * 事件漏斗 finish 携带会话键收窄，防收错他人会话的行。
   */
  finalizeByCorrelation(
    correlationId: string,
    params: FinishToolInvocationParams,
    sessionId?: string,
  ): ToolInvocationRow | undefined {
    const row = this.raw
      .prepare(
        `SELECT id FROM tool_invocations
         WHERE correlation_id = ? AND status = 'running'${
           sessionId != null ? ' AND session_id = ?' : ''
         }
         ORDER BY ledger_seq DESC LIMIT 1`,
      )
      .get(...(sessionId != null ? [correlationId, sessionId] : [correlationId])) as
      | { id: string }
      | undefined
    if (row == null) return undefined
    return this.finish(row.id, params)
  }

  get(id: string): ToolInvocationRow | undefined {
    return this.raw.prepare('SELECT * FROM tool_invocations WHERE id = ?').get(id) as
      | ToolInvocationRow
      | undefined
  }

  list(params: ListToolInvocationsParams = {}): { items: ToolInvocationRow[]; total: number } {
    const filters: string[] = []
    const values: Array<string | number> = []
    const add = (clause: string, value: string | undefined): void => {
      if (value == null) return
      filters.push(clause)
      values.push(value)
    }
    add('source_kind = ?', params.sourceKind)
    add('source_id = ?', params.sourceId)
    add('package_id = ?', params.packageId)
    add('tool_name = ?', params.toolName)
    add('session_id = ?', params.sessionId)
    add('status = ?', params.status)
    add('correlation_id = ?', params.correlationId)
    add('created_at >= ?', params.from)
    add('created_at <= ?', params.to)
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
    const total = (
      this.raw.prepare(`SELECT COUNT(*) AS count FROM tool_invocations${where}`).get(...values) as {
        count: number
      }
    ).count
    const limit = Math.min(200, Math.max(1, params.limit ?? 50))
    const offset = Math.max(0, params.offset ?? 0)
    const items = this.raw
      .prepare(`SELECT * FROM tool_invocations${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as ToolInvocationRow[]
    return { items, total }
  }

  /** 检查器账本查询：ledger_seq 降序（新→旧）+ 游标向下翻页。 */
  listLedger(params: ListToolLedgerParams = {}): ListToolLedgerResult {
    const filters: string[] = []
    const values: Array<string | number> = []
    const add = (clause: string, value: string | number | undefined): void => {
      if (value == null) return
      filters.push(clause)
      values.push(value)
    }
    const totalFilters: string[] = []
    const totalValues: Array<string | number> = []
    const addTotal = (clause: string, value: string | undefined): void => {
      if (value == null) return
      totalFilters.push(clause)
      totalValues.push(value)
    }
    add('session_id = ?', params.sessionId)
    add('chain_session_id = ?', params.chainSessionId)
    add('turn_id = ?', params.turnId)
    // 工具名按「包含」搜索（审查 U1）：检查器是自由文本搜索框，等值匹配下
    // 部分词永远 0 命中。LIKE 通配符转义，防用户输入 %/_ 改变语义。
    if (params.toolName != null) {
      filters.push("tool_name LIKE ? ESCAPE '\\'")
      values.push(`%${escapeLike(params.toolName)}%`)
    }
    add('source_kind = ?', params.sourceKind)
    add('invocation_source = ?', params.invocationSource)
    add('status = ?', params.status)
    add('member_agent_id = ?', params.memberAgentId)
    add('correlation_id = ?', params.correlationId)
    if (params.cursor != null) {
      filters.push('ledger_seq < ?')
      values.push(params.cursor)
    }
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
    // total 不含游标条件：检查器要的是「本会话总共多少条」，翻页不影响
    addTotal('session_id = ?', params.sessionId)
    addTotal('chain_session_id = ?', params.chainSessionId)
    addTotal('turn_id = ?', params.turnId)
    if (params.toolName != null) {
      totalFilters.push("tool_name LIKE ? ESCAPE '\\'")
      totalValues.push(`%${escapeLike(params.toolName)}%`)
    }
    addTotal('source_kind = ?', params.sourceKind)
    addTotal('invocation_source = ?', params.invocationSource)
    addTotal('status = ?', params.status)
    addTotal('member_agent_id = ?', params.memberAgentId)
    addTotal('correlation_id = ?', params.correlationId)
    const totalWhere = totalFilters.length > 0 ? ` WHERE ${totalFilters.join(' AND ')}` : ''
    const total = (
      this.raw
        .prepare(`SELECT COUNT(*) AS count FROM tool_invocations${totalWhere}`)
        .get(...totalValues) as { count: number }
    ).count
    const limit = Math.min(200, Math.max(1, params.limit ?? 50))
    const rows = this.raw
      .prepare(`SELECT * FROM tool_invocations${where} ORDER BY ledger_seq DESC LIMIT ?`)
      .all(...values, limit + 1) as ToolInvocationRow[]
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const lastItem = items[items.length - 1]
    // cursor 必须 > 0：095 重放段行的 ledger_seq 兜底 0（DESC 排序在最尾），
    // `ledger_seq < 0` 无结果——传 0 回去只会被协议层 zod positive 拒掉（审查 D5）。
    // 已知边界：同页 ≥2 条 seq=0 重放行时翻页提前终止（仅修复库重放场景会出现，
    // 正常账本 seq 全局唯一且 ≥1）。
    const nextCursor =
      hasMore && lastItem != null && lastItem.ledger_seq > 0 ? lastItem.ledger_seq : null
    return { items, nextCursor, total }
  }

  /** 会话级聚合：counts by status/source/tool、p50/p95 duration、总 bytes、时间范围。 */
  statsBySession(sessionId: string): ToolLedgerStats {
    const byStatus = {} as Partial<Record<ToolInvocationStatus, number>>
    for (const row of this.raw
      .prepare(
        'SELECT status, COUNT(*) AS count FROM tool_invocations WHERE session_id = ? GROUP BY status',
      )
      .all(sessionId) as Array<{ status: ToolInvocationStatus; count: number }>) {
      byStatus[row.status] = row.count
    }
    const bySourceKind = {} as Partial<Record<ToolInvocationSourceKind, number>>
    for (const row of this.raw
      .prepare(
        'SELECT source_kind, COUNT(*) AS count FROM tool_invocations WHERE session_id = ? GROUP BY source_kind',
      )
      .all(sessionId) as Array<{ source_kind: ToolInvocationSourceKind; count: number }>) {
      bySourceKind[row.source_kind] = row.count
    }
    const byTool = this.raw
      .prepare(
        `SELECT tool_name, COUNT(*) AS count FROM tool_invocations
         WHERE session_id = ? GROUP BY tool_name ORDER BY count DESC, tool_name`,
      )
      .all(sessionId) as Array<{ tool_name: string; count: number }>
    // 时长百分位排除 stale 行（审查 P3-6）：stale 的 duration 是对账时刻 −
    // started_at 的合成值（崩溃悬挂数小时会污染 p50/p95），非真实执行耗时。
    const durations = (
      this.raw
        .prepare(
          `SELECT duration_ms FROM tool_invocations
           WHERE session_id = ? AND duration_ms IS NOT NULL AND status != 'stale'`,
        )
        .all(sessionId) as Array<{ duration_ms: number }>
    )
      .map((row) => row.duration_ms)
      .sort((a, b) => a - b)
    const sums = this.raw
      .prepare(
        `SELECT
           COALESCE(SUM(input_bytes), 0) AS input_bytes,
           COALESCE(SUM(output_bytes), 0) AS output_bytes,
           MIN(started_at) AS first_started_at,
           MAX(COALESCE(finished_at, started_at)) AS last_finished_at
         FROM tool_invocations WHERE session_id = ?`,
      )
      .get(sessionId) as {
      input_bytes: number
      output_bytes: number
      first_started_at: string | null
      last_finished_at: string | null
    }
    return {
      sessionId,
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
      bySourceKind,
      byTool: byTool.map((row) => ({ toolName: row.tool_name, count: row.count })),
      durationP50Ms: percentileNearestRank(durations, 0.5),
      durationP95Ms: percentileNearestRank(durations, 0.95),
      totalInputBytes: sums.input_bytes,
      totalOutputBytes: sums.output_bytes,
      firstStartedAt: sums.first_started_at,
      lastFinishedAt: sums.last_finished_at,
    }
  }

  /**
   * 链校验：按 ledger_seq 顺序重算全链哈希。
   * 主链验不可变身份与归因字段（v2；v2 前的历史行按 v1 字段集兼容验算，审查 P2-2），
   * 终态行另验收尾态补充哈希（finished_record_hash）。
   * NULL record_hash 的行（121 迁移回填段）视为新链起点，豁免校验。
   * 返回首个断点及其原因；valid=true 表示全链一致。
   */
  verifyChain(chainSessionId: string): VerifyChainResult {
    const rows = this.raw
      .prepare(
        `SELECT ledger_seq, id, correlation_id, record_hash, prev_hash, finished_record_hash,
                session_id, turn_id, member_agent_id, dispatch_id, engine, invocation_source,
                mcp_server_id, tool_id, tool_name, source_kind, source_id, started_at,
                input_sha256, input_bytes,
                status, finished_at, duration_ms, error_code, error_message,
                output_bytes, output_sha256, retry_count
         FROM tool_invocations WHERE chain_session_id = ? ORDER BY ledger_seq ASC`,
      )
      .all(chainSessionId) as Array<
      Omit<RecordHashFields, 'chain_session_id'> &
        FinishedHashFields & {
          record_hash: string | null
          prev_hash: string | null
          finished_record_hash: string | null
        }
    >
    let expectedPrev: string | null = null
    /** 分链内是否已见过有效哈希行：首条的前驱可能在 prune 保留窗外，跳过 prev 检查（审查 D2）。 */
    let seenHashedRow = false
    // 初始化 -1（审查 P3-1）：095 重放行 ledger_seq 兜底 0，初始 0 会把首行判成 seq-order 断链。
    let lastSeq = -1
    let checkedCount = 0
    for (const row of rows) {
      if (row.ledger_seq <= lastSeq) {
        return {
          chainSessionId,
          valid: false,
          checkedCount,
          break: { ledgerSeq: row.ledger_seq, reason: 'seq-order' },
        }
      }
      lastSeq = row.ledger_seq
      // 回填段 / 段边界：无哈希即重置链头（下一条有效哈希行重新作为段首）
      if (row.record_hash == null) {
        expectedPrev = null
        seenHashedRow = false
        continue
      }
      // 段首行：前驱哈希不可验（可能指向已 prune 的保留窗外行），重算用行自身 prev_hash。
      const prevForRecompute: string | null = seenHashedRow ? expectedPrev : row.prev_hash
      if (seenHashedRow && row.prev_hash !== expectedPrev) {
        return {
          chainSessionId,
          valid: false,
          checkedCount,
          break: {
            ledgerSeq: row.ledger_seq,
            reason: 'prev-mismatch',
            actualRecordHash: row.record_hash,
          },
        }
      }
      // v2 字段集重算；历史行（v2 上线前写入）按 v1 字段集兼容验算。
      const recomputedV2 = computeRecordHash(
        {
          ledger_seq: row.ledger_seq,
          id: row.id,
          correlation_id: row.correlation_id,
          chain_session_id: chainSessionId,
          session_id: row.session_id,
          turn_id: row.turn_id,
          member_agent_id: row.member_agent_id,
          dispatch_id: row.dispatch_id,
          engine: row.engine,
          invocation_source: row.invocation_source,
          mcp_server_id: row.mcp_server_id,
          tool_id: row.tool_id,
          tool_name: row.tool_name,
          source_kind: row.source_kind,
          source_id: row.source_id,
          started_at: row.started_at,
          input_sha256: row.input_sha256,
          input_bytes: row.input_bytes,
        },
        prevForRecompute,
      )
      const recordHashMatches = recomputedV2 === row.record_hash
      if (!recordHashMatches) {
        const recomputedV1: string = computeRecordHash(
          {
            ledger_seq: row.ledger_seq,
            correlation_id: row.correlation_id,
            chain_session_id: chainSessionId,
            tool_name: row.tool_name,
            source_kind: row.source_kind,
            source_id: row.source_id,
            started_at: row.started_at,
            input_sha256: row.input_sha256,
            input_bytes: row.input_bytes,
          } satisfies RecordHashFieldsV1,
          prevForRecompute,
        )
        if (recomputedV1 !== row.record_hash) {
          return {
            chainSessionId,
            valid: false,
            checkedCount,
            break: {
              ledgerSeq: row.ledger_seq,
              reason: 'hash-mismatch',
              expectedRecordHash: recomputedV2,
              actualRecordHash: row.record_hash,
            },
          }
        }
      }
      // 终态行：验收尾态补充哈希（防篡改 finish 结果）。
      // 终态却无补充哈希 = 哈希被抹除的廉价篡改路径（审查 P3-3），视为断链。
      if (row.status !== 'running') {
        if (row.finished_at == null || row.finished_record_hash == null) {
          return {
            chainSessionId,
            valid: false,
            checkedCount,
            break: { ledgerSeq: row.ledger_seq, reason: 'missing-finish-hash' },
          }
        }
        const recomputedFinish = computeFinishedRecordHash({
          ledger_seq: row.ledger_seq,
          status: row.status,
          finished_at: row.finished_at,
          duration_ms: row.duration_ms,
          error_code: row.error_code,
          error_message: row.error_message,
          output_bytes: row.output_bytes,
          output_sha256: row.output_sha256,
          retry_count: row.retry_count,
        })
        if (recomputedFinish !== row.finished_record_hash) {
          return {
            chainSessionId,
            valid: false,
            checkedCount,
            break: {
              ledgerSeq: row.ledger_seq,
              reason: 'finish-hash-mismatch',
              expectedRecordHash: recomputedFinish,
              actualRecordHash: row.finished_record_hash,
            },
          }
        }
      }
      expectedPrev = row.record_hash
      seenHashedRow = true
      checkedCount += 1
    }
    return { chainSessionId, valid: true, checkedCount }
  }

  /**
   * 悬挂对账：running 且 started_at < cutoff 的行推进为 'stale'
   * （区别于主动 cancelled 的对账终态），并补记收尾态哈希。
   */
  reconcileStale(cutoff: string): number {
    // `<=`：cutoff 即「当下」，同毫秒写入的 running 也是遗留（构造时对账语义）。
    const candidates = this.raw
      .prepare("SELECT id FROM tool_invocations WHERE status = 'running' AND started_at <= ?")
      .all(cutoff) as Array<{ id: string }>
    if (candidates.length === 0) return 0
    let changed = 0
    this.transactionImmediate(() => {
      const update = this.raw.prepare(
        `UPDATE tool_invocations SET
           status = 'stale', finished_at = ?, duration_ms = ?, finished_record_hash = ?
         WHERE id = ? AND status = 'running'`,
      )
      for (const { id } of candidates) {
        const row = this.get(id)
        if (row == null || row.status !== 'running') continue
        const finishedAt = row.finished_at ?? cutoff
        const durationMs =
          row.duration_ms ?? Math.max(0, Date.parse(finishedAt) - Date.parse(row.started_at))
        update.run(
          finishedAt,
          durationMs,
          computeFinishedRecordHash({
            ledger_seq: row.ledger_seq,
            status: 'stale',
            finished_at: finishedAt,
            duration_ms: durationMs,
            error_code: row.error_code,
            error_message: row.error_message,
            output_bytes: row.output_bytes,
            output_sha256: row.output_sha256,
            retry_count: row.retry_count,
          }),
          id,
        )
        changed += 1
      }
    })
    return changed
  }

  /**
   * 账本保留期清理（链感知，审查 P1-1）：
   * 只删除分链的 **ledger_seq 前缀**——每条链上「幸存行（created_at ≥ cutoff）的最小
   * seq」之前的旧行才可删；整链全旧的链整链删除。ledger_seq 按到达序分配而
   * created_at 来自两个时钟域（事件时间戳 vs 本地时钟），可能出现「高 seq 但
   * started_at 更早」的乱序行——这类行虽超保留期但不在前缀内，**保留**（删除会在
   * 链中段掏空洞，verifyChain 从此永久误报 prev-mismatch，且与真实篡改不可区分）。
   * 代价是乱序链的旧行延迟到整链老化后才清理，审计完整性优先。
   *
   * 返回值携带删除后已无任何账本行引用的载荷归档 id（内容寻址共享，防误删）；
   * 引用复查为删除后单趟全表扫描（M1：原实现逐 id OR 查询无索引，m 个候选 ×
   * 全表扫在主进程同步执行会卡顿）。全程 IMMEDIATE 事务（P3-7：闭合跨连接
   * 「检查后插入」窗口）。
   */
  prune(ledgerCutoff: string): PruneToolLedgerResult {
    return this.transactionImmediate(() => {
      // 每条链幸存行的最小 seq（幸存 = created_at >= cutoff）。
      const survivorMinSeq = new Map<string, number>()
      for (const row of this.raw
        .prepare(
          `SELECT chain_session_id AS chain, MIN(ledger_seq) AS min_seq
           FROM tool_invocations WHERE created_at >= ? GROUP BY chain_session_id`,
        )
        .all(ledgerCutoff) as Array<{ chain: string; min_seq: number }>) {
        survivorMinSeq.set(row.chain, row.min_seq)
      }
      // 候选删除行：超保留期，且（整链无幸存行 或 seq 严格小于幸存最小 seq）。
      const doomedIds: string[] = []
      const collected = new Set<string>()
      for (const row of this.raw
        .prepare(
          `SELECT id, ledger_seq, chain_session_id AS chain,
                  input_artifact_id AS a, output_artifact_id AS b
           FROM tool_invocations WHERE created_at < ?`,
        )
        .all(ledgerCutoff) as Array<{
        id: string
        ledger_seq: number
        chain: string
        a: string | null
        b: string | null
      }>) {
        const minSeq = survivorMinSeq.get(row.chain)
        if (minSeq != null && row.ledger_seq >= minSeq) continue // 乱序保留行
        doomedIds.push(row.id)
        if (row.a != null) collected.add(row.a)
        if (row.b != null) collected.add(row.b)
      }
      if (doomedIds.length === 0) return { deletedRows: 0, artifactIds: [] as string[] }
      const deleteById = this.raw.prepare('DELETE FROM tool_invocations WHERE id = ?')
      let deletedRows = 0
      for (const id of doomedIds) deletedRows += deleteById.run(id).changes
      if (collected.size > 0) {
        // 单趟扫描存活行的引用（M1），候选中仍被引用的移出回收清单。
        for (const row of this.raw
          .prepare(
            `SELECT input_artifact_id AS a, output_artifact_id AS b FROM tool_invocations
             WHERE input_artifact_id IS NOT NULL OR output_artifact_id IS NOT NULL`,
          )
          .all() as Array<{ a: string | null; b: string | null }>) {
          if (row.a != null) collected.delete(row.a)
          if (row.b != null) collected.delete(row.b)
        }
      }
      return { deletedRows, artifactIds: [...collected] }
    })
  }

  pruneOlderThan(cutoff: string): number {
    return this.raw.prepare('DELETE FROM tool_invocations WHERE created_at < ?').run(cutoff).changes
  }
}

/** 最近邻秩百分位（nearest-rank）：空样本返回 null。 */
function percentileNearestRank(sortedValues: number[], quantile: number): number | null {
  if (sortedValues.length === 0) return null
  const rank = Math.min(sortedValues.length, Math.max(1, Math.ceil(quantile * sortedValues.length)))
  return sortedValues[rank - 1] ?? null
}
