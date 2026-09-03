/**
 * @module session-history
 *
 * 会话全量历史检索 Repository
 *
 * 职责：
 *   - 从 append-only 的 agent_events 表读取会话的全量历史（含工具调用输入输出）
 *   - 轮次时间线（目录）、按轮组织的全量保真分页读取、单事件定点读取、关键词检索
 *
 * 背景：
 *   - 引擎侧上下文压缩只产生新事件（context_compaction / context_summarized），
 *     原始事件永不修改或删除，因此本仓库读到的就是压缩前的最全量版本。
 *   - 超大工具结果在写入时已被外置为 spark.tool_result_envelope（预览 + artifact
 *     指针），本仓库原样透传，由 agent 侧已有的 spark_tool_results MCP 读回全文。
 *
 * 约束：
 *   - 所有方法强制以 sessionId 为查询条件，会话隔离由 SQL 保证
 *   - 输出受字符预算控制：检索工具自身不能成为新的上下文膨胀源
 *   - 时间线游标基于轮次 first_seq（完整轮窗 CTE，不切分轮次）；
 *     读取游标基于事件 seq（预算触底时可在轮中截断，下一页无缝续读，不重不漏）
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type { AgentEventRow } from './event.repository.js'
import type {
  SessionHistoryEventItem,
  SessionHistorySearchHit,
  SessionHistoryTurnDetail,
  SessionHistoryTurnOverview,
} from '@spark/protocol'

/**
 * 纳入历史检索范围的事件类型。
 *
 * 排除项及理由：
 *   - turn_prompt_snapshot：系统提示原文，体积大且 agent 每轮都能拿到自己的提示
 *   - checkpoint / runtime 控制事件：对「找回丢掉的上下文」没有价值
 *   - user_message(hidden)：运行时内部续跑提示，属于机器内部协议而非对话内容
 */
const HISTORY_EVENT_TYPES: readonly string[] = [
  'user_message',
  'assistant_message',
  'team_member_message',
  'tool_call',
  'tool_result',
  'file_change',
  'context_compaction',
  'context_summarized',
  // 仅终态（idle/completed/cancelled/error）的轮次状态，作为轮内最后的系统标记
  'agent_status',
]

const TERMINAL_AGENT_STATUSES = new Set(['idle', 'completed', 'cancelled', 'error'])

/** 读取/检索单条内容的默认上限；超长截断并标记，可 mode:'event' 定点读全文 */
const MAX_ITEM_CHARS = 8_000
/** readTurns 整页内容预算（所有 events 的 content 总和） */
const MAX_PAGE_CHARS = 24_000
/** readEvent 单事件硬上限 */
const MAX_EVENT_CHARS = 32_000
/** 时间线条目里用户消息预览长度 */
const TIMELINE_HEAD_CHARS = 160
/** 时间线条目里工具名列表上限 */
const TIMELINE_TOOL_NAME_LIMIT = 12
/** 检索关键词长度上限 */
const MAX_QUERY_CHARS = 200
/** 检索 snippet 上限 */
const SNIPPET_CHARS = 200
/** 检索批量扫描行数 */
const SEARCH_BATCH_SIZE = 512
/** 读取单页最多预取的事件行数（预算与轮数在此范围内截断） */
const READ_FETCH_ROW_LIMIT = 512
/** 预算剩余低于该值时停止追加条目，避免输出残缺条目 */
const PAGE_BUDGET_EPSILON = 64

const MAX_LIST_TURNS = 50
const MAX_READ_TURNS = 8

/** 事件类型 → 输出角色 */
function eventRole(eventType: string): SessionHistoryEventItem['role'] {
  switch (eventType) {
    case 'user_message':
      return 'user'
    case 'assistant_message':
      return 'assistant'
    case 'team_member_message':
      return 'team_member'
    case 'tool_call':
    case 'tool_result':
    case 'file_change':
      return 'tool'
    default:
      return 'system'
  }
}

/**
 * 把事件 JSON 文本化为输出内容。
 *
 * 与检索共用同一份提取逻辑，保证「搜到的」和「读到的」是同一段文本。
 */
function extractHistoryEventText(eventType: string, parsed: Record<string, unknown>): string {
  switch (eventType) {
    case 'user_message':
    case 'assistant_message':
    case 'team_member_message':
      return typeof parsed.content === 'string' ? parsed.content : ''
    case 'tool_call':
      // 入参原样序列化；工具名由条目的 toolName 字段承载
      return `input: ${parsed.toolInput === undefined ? '{}' : safeStringify(parsed.toolInput)}`
    case 'tool_result': {
      const status = typeof parsed.status === 'string' ? parsed.status : 'success'
      if (typeof parsed.error === 'string' && parsed.error.length > 0) {
        return `error: ${parsed.error}`
      }
      // output 为 unknown：envelope 对象、结构化 JSON、纯文本都原样序列化透传
      const output =
        parsed.output === undefined
          ? '(no output)'
          : typeof parsed.output === 'string'
            ? parsed.output
            : safeStringify(parsed.output)
      return `[${status}] output: ${output}`
    }
    case 'file_change': {
      const changeType = typeof parsed.changeType === 'string' ? parsed.changeType : 'modify'
      const path = typeof parsed.path === 'string' ? parsed.path : ''
      const oldPath = typeof parsed.oldPath === 'string' ? ` (from ${parsed.oldPath})` : ''
      const diff =
        typeof parsed.diff === 'string' && parsed.diff.length > 0 ? `\n${parsed.diff}` : ''
      return `${changeType} ${path}${oldPath}${diff}`
    }
    case 'context_compaction':
    case 'context_summarized': {
      const parts: string[] = [eventType]
      if (typeof parsed.phase === 'string') parts.push(`phase=${parsed.phase}`)
      if (typeof parsed.provider === 'string') parts.push(`provider=${parsed.provider}`)
      if (typeof parsed.summary === 'string' && parsed.summary.length > 0) {
        parts.push(`summary: ${parsed.summary}`)
      } else if (typeof parsed.message === 'string' && parsed.message.length > 0) {
        parts.push(`message: ${parsed.message}`)
      }
      return parts.join(' ')
    }
    case 'agent_status': {
      const status = typeof parsed.status === 'string' ? parsed.status : ''
      const error =
        typeof parsed.error === 'string' && parsed.error.length > 0 ? ` — ${parsed.error}` : ''
      return `turn ended: ${status}${error}`
    }
    default:
      return ''
  }
}

/** JSON 序列化（BigInt 容错；循环引用等异常兜底为标记字符串） */
function safeStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, nested) => {
        if (typeof nested === 'bigint') return nested.toString()
        return nested
      }) ?? 'null'
    )
  } catch {
    return '[unserializable]'
  }
}

function trimText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function makeSnippet(body: string, query: string): string {
  const index = body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) return trimText(body, SNIPPET_CHARS)
  const start = Math.max(0, index - 60)
  const end = Math.min(body.length, index + query.length + 100)
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function parseEventJson(row: AgentEventRow): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(row.event_json) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function isTerminalAgentStatusRow(row: AgentEventRow, parsed: Record<string, unknown>): boolean {
  return (
    row.event_type === 'agent_status' &&
    typeof parsed.status === 'string' &&
    TERMINAL_AGENT_STATUSES.has(parsed.status)
  )
}

/**
 * 历史检索 SQL 的公共事件过滤片段（hidden 消息排除、delta 排除、终态状态收窄）。
 * 生成列 event_mode 优先，历史行回退 event_json 的 $.mode。
 */
const HISTORY_EVENT_FILTER = `(
  (event_type = 'user_message'
    AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden')
  OR (event_type IN ('assistant_message', 'team_member_message')
    AND COALESCE(event_mode, json_extract(event_json, '$.mode'), 'complete') = 'complete')
  OR event_type IN ('tool_call', 'tool_result', 'file_change',
    'context_compaction', 'context_summarized')
  OR (event_type = 'agent_status'
    AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error'))
)`

/** 完整轮窗 CTE：先按纳入范围聚合出每个轮次的 first/last seq，再按 first_seq 分页 */
const TURN_WINDOWS_CTE = `turn_windows AS (
  SELECT turn_id, MIN(seq) AS first_seq, MAX(seq) AS last_seq
  FROM agent_events
  WHERE session_id = ? AND turn_id IS NOT NULL AND ${HISTORY_EVENT_FILTER}
  GROUP BY turn_id
)`

interface TurnWindowRow {
  turn_id: string
  first_seq: number
  last_seq: number
}

/** 事件行 → 输出条目（不做预算截断） */
function toHistoryEventItem(row: AgentEventRow): SessionHistoryEventItem {
  const parsed = parseEventJson(row)
  const content = parsed == null ? '' : extractHistoryEventText(row.event_type, parsed)
  const item: SessionHistoryEventItem = {
    seq: row.seq ?? 0,
    eventType: row.event_type,
    role: eventRole(row.event_type),
    content,
    truncated: false,
  }
  if (parsed != null) {
    if (typeof parsed.toolName === 'string') item.toolName = parsed.toolName.slice(0, 160)
    if (typeof parsed.toolCallId === 'string') item.toolCallId = parsed.toolCallId
    if (typeof parsed.status === 'string') item.status = parsed.status.slice(0, 40)
  }
  return item
}

/**
 * Session History Repository
 *
 * 读取 agent_events 中会话的全量历史，供 session_history_* agent 工具使用。
 */
export class SessionHistoryRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'agent_events')
  }

  /** 轮次时间线（目录）：按完整轮窗聚合的概览，不含正文 */
  listTurnTimeline(params: {
    sessionId: string
    cursor?: number
    limit?: number
    order?: 'asc' | 'desc'
  }): {
    turns: SessionHistoryTurnOverview[]
    nextCursor: number | null
    hasMore: boolean
  } {
    const sessionId = requireSessionId(params.sessionId)
    const order = params.order === 'desc' ? 'desc' : 'asc'
    // desc 的起始游标用安全整数上界表示「从最新端开始」
    const cursor = clampCursor(params.cursor, order)
    const limit = clampInt(params.limit, 1, MAX_LIST_TURNS, 20)

    const comparison = order === 'asc' ? '>' : '<'
    const windows = this.raw
      .prepare(
        `WITH ${TURN_WINDOWS_CTE}
         SELECT turn_id, first_seq, last_seq FROM turn_windows
         WHERE first_seq ${comparison} ?
         ORDER BY first_seq ${order === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ?`,
      )
      .all(sessionId, cursor, limit) as TurnWindowRow[]
    if (windows.length === 0) return { turns: [], nextCursor: null, hasMore: false }

    const overviews = this.buildTurnOverviews(sessionId, windows)
    // 分页键是 first_seq（seq 单调分配，first_seq 在轮次间唯一）：asc 取返回页中
    // 最大的 first_seq，desc 取最小的 first_seq，都落在最后一个窗口上，不重不漏。
    const boundarySeq = windows[windows.length - 1]?.first_seq ?? cursor
    const hasMore = this.hasMoreWindowsAfter(sessionId, boundarySeq, order)
    return { turns: overviews, nextCursor: hasMore ? boundarySeq : null, hasMore }
  }

  /**
   * 全量保真读取：事件窗口分页，按轮组织输出。
   *
   * 预算触底或轮数达限时，页可在轮中截断（partial 标记），nextCursor 指向
   * 分页方向上最后一个已输出事件的 seq，下一页从其下一个事件无缝续读。
   */
  readTurns(params: {
    sessionId: string
    cursor?: number
    turnLimit?: number
    order?: 'asc' | 'desc'
  }): {
    turns: SessionHistoryTurnDetail[]
    nextCursor: number | null
    hasMore: boolean
  } {
    const sessionId = requireSessionId(params.sessionId)
    const order = params.order === 'desc' ? 'desc' : 'asc'
    const cursor = clampCursor(params.cursor, order)
    const turnLimit = clampInt(params.turnLimit, 1, MAX_READ_TURNS, 4)

    const comparison = order === 'asc' ? '>' : '<'
    const rows = this.raw
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ? AND turn_id IS NOT NULL AND ${HISTORY_EVENT_FILTER}
           AND seq ${comparison} ?
         ORDER BY seq ${order === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ?`,
      )
      .all(sessionId, cursor, READ_FETCH_ROW_LIMIT) as AgentEventRow[]
    if (rows.length === 0) return { turns: [], nextCursor: null, hasMore: false }

    // 预算按分页方向（fetch 顺序）消耗，优先保留靠近游标起点的内容
    interface TurnDraft {
      turnId: string
      firstSeq: number
      lastSeq: number
      events: SessionHistoryEventItem[]
      partial: boolean
    }
    const drafts = new Map<string, TurnDraft>()
    let outputChars = 0
    let lastIncludedSeq: number | null = null
    let budgetExhausted = false
    for (const row of rows) {
      const turnId = row.turn_id
      if (turnId == null) continue
      let draft = drafts.get(turnId)
      if (draft == null) {
        if (!budgetExhausted && drafts.size >= turnLimit) break
        draft = { turnId, firstSeq: row.seq ?? 0, lastSeq: row.seq ?? 0, events: [], partial: false }
        drafts.set(turnId, draft)
      }
      draft.lastSeq = row.seq ?? draft.lastSeq
      if (budgetExhausted) {
        // 继续标记该轮后续事件的截断状态，但不再输出内容
        draft.partial = true
        continue
      }
      const parsed = parseEventJson(row)
      if (parsed != null && !isTerminalAgentStatusRow(row, parsed)) {
        const item = toHistoryEventItem(row)
        const remaining = MAX_PAGE_CHARS - outputChars
        if (remaining < PAGE_BUDGET_EPSILON && item.content.length > 0) {
          draft.partial = true
          budgetExhausted = true
          continue
        }
        const content = trimText(item.content, Math.min(MAX_ITEM_CHARS, remaining))
        draft.events.push({ ...item, content, truncated: content.length < item.content.length })
        outputChars += content.length
        lastIncludedSeq = row.seq ?? lastIncludedSeq
      } else if (parsed != null) {
        const item = toHistoryEventItem(row)
        draft.events.push(item)
        lastIncludedSeq = row.seq ?? lastIncludedSeq
      }
    }

    // 丢弃读取方向末尾因预算/轮数限制而产生的事件为空的轮（下一页会重新覆盖）
    const orderedDrafts = [...drafts.values()]
    while (orderedDrafts.length > 0 && orderedDrafts.at(-1)?.events.length === 0) {
      orderedDrafts.pop()
    }
    if (orderedDrafts.length === 0 || lastIncludedSeq == null) {
      // 理论上仅当整页事件都无法解析时出现；游标推进到本页扫描边界，保证有进展
      const scannedBoundary = rows.at(-1)?.seq ?? cursor
      return { turns: [], nextCursor: scannedBoundary, hasMore: rows.length >= READ_FETCH_ROW_LIMIT }
    }

    // 展示顺序统一为时间正序（desc 时翻转轮列表与轮内事件）
    const turns = order === 'asc' ? orderedDrafts : orderedDrafts.reverse().map(flipDraft)
    const hasMore = this.hasMoreRowsAfter(sessionId, lastIncludedSeq, order)
    return { turns, nextCursor: hasMore ? lastIncludedSeq : null, hasMore }
  }

  /** 定点读取单个事件全文（32k 硬上限） */
  readEvent(params: {
    sessionId: string
    turnId: string
    seq: number
  }): (SessionHistoryEventItem & { turnId: string }) | null {
    const sessionId = requireSessionId(params.sessionId)
    const turnId = params.turnId.trim()
    if (!turnId) throw new Error('turnId 不能为空')
    if (!Number.isInteger(params.seq) || params.seq < 0) throw new Error('seq 无效')
    const row = this.raw
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ? AND turn_id = ? AND seq = ? AND ${HISTORY_EVENT_FILTER}
         LIMIT 1`,
      )
      .get(sessionId, turnId, params.seq) as AgentEventRow | undefined
    if (row == null) return null
    const item = toHistoryEventItem(row)
    const content =
      item.content.length > MAX_EVENT_CHARS
        ? `${item.content.slice(0, MAX_EVENT_CHARS)}\n[truncated at ${MAX_EVENT_CHARS} chars]`
        : item.content
    return {
      ...item,
      content,
      truncated: content.length < item.content.length,
      turnId: row.turn_id ?? turnId,
    }
  }

  /** 关键词检索：SQL LIKE 预筛（转义通配符）+ JS 侧精确子串命中与 snippet */
  searchEvents(params: {
    sessionId: string
    query: string
    eventTypes?: string[]
    limit?: number
  }): { hits: SessionHistorySearchHit[] } {
    const sessionId = requireSessionId(params.sessionId)
    const query = params.query.trim()
    if (query.length === 0 || query.length > MAX_QUERY_CHARS)
      throw new Error(`检索关键词长度必须为 1～${MAX_QUERY_CHARS} 个字符`)
    const limit = clampInt(params.limit, 1, 50, 20)
    const allowedTypes = new Set(HISTORY_EVENT_TYPES)
    const eventTypes = (params.eventTypes ?? []).filter((type) => allowedTypes.has(type))
    const typeFilter =
      eventTypes.length > 0
        ? `AND event_type IN (${eventTypes.map(() => '?').join(', ')})`
        : ''
    const likePattern = `%${escapeLike(query)}%`
    const searchBatch = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ? AND seq > ? AND turn_id IS NOT NULL AND ${HISTORY_EVENT_FILTER}
         AND event_json LIKE ? ESCAPE '\\'
         ${typeFilter}
       ORDER BY seq ASC LIMIT ?`,
    )

    const needle = query.toLocaleLowerCase()
    const hits: SessionHistorySearchHit[] = []
    let scanCursor = -1
    while (hits.length < limit) {
      const sourceRows = searchBatch.all(
        sessionId,
        scanCursor,
        likePattern,
        ...(eventTypes.length > 0 ? eventTypes : []),
        SEARCH_BATCH_SIZE,
      ) as AgentEventRow[]
      if (sourceRows.length === 0) break
      for (const row of sourceRows) {
        const parsed = parseEventJson(row)
        if (parsed == null) continue
        const body = extractHistoryEventText(row.event_type, parsed)
        if (body.length === 0) continue
        if (!body.toLocaleLowerCase().includes(needle)) continue
        const hit: SessionHistorySearchHit = {
          turnId: row.turn_id ?? '',
          seq: row.seq ?? 0,
          eventType: row.event_type,
          role: eventRole(row.event_type),
          snippet: makeSnippet(body, query),
        }
        if (typeof parsed.toolName === 'string') hit.toolName = parsed.toolName.slice(0, 160)
        hits.push(hit)
        if (hits.length >= limit) break
      }
      const lastScannedSeq = sourceRows.at(-1)?.seq
      if (lastScannedSeq == null || lastScannedSeq <= scanCursor) break
      scanCursor = lastScannedSeq
      if (sourceRows.length < SEARCH_BATCH_SIZE) break
    }
    return { hits }
  }

  // ── 内部查询 ──

  private selectHistoryRows(sessionId: string, turnIds: string[]): AgentEventRow[] {
    if (turnIds.length === 0) return []
    const placeholders = turnIds.map(() => '?').join(', ')
    return this.raw
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ? AND turn_id IN (${placeholders}) AND ${HISTORY_EVENT_FILTER}
         ORDER BY seq ASC`,
      )
      .all(sessionId, ...turnIds) as AgentEventRow[]
  }

  private buildTurnOverviews(
    sessionId: string,
    windows: TurnWindowRow[],
  ): SessionHistoryTurnOverview[] {
    const rows = this.selectHistoryRows(sessionId, windows.map((w) => w.turn_id))
    const byTurn = new Map<string, AgentEventRow[]>()
    for (const row of rows) {
      if (row.turn_id == null) continue
      const list = byTurn.get(row.turn_id)
      if (list) list.push(row)
      else byTurn.set(row.turn_id, [row])
    }
    return windows.map((window) => {
      const turnRows = byTurn.get(window.turn_id) ?? []
      let userMessageHead = ''
      let messageCount = 0
      let toolCallCount = 0
      let hasCompaction = false
      const toolNames: string[] = []
      let lastEventAt = ''
      for (const row of turnRows) {
        const parsed = parseEventJson(row)
        if (parsed == null) continue
        if (row.event_type === 'user_message' && userMessageHead.length === 0) {
          userMessageHead =
            typeof parsed.content === 'string' ? trimText(parsed.content, TIMELINE_HEAD_CHARS) : ''
        }
        if (
          row.event_type === 'user_message' ||
          row.event_type === 'assistant_message' ||
          row.event_type === 'team_member_message'
        ) {
          messageCount += 1
        }
        if (row.event_type === 'tool_call') {
          toolCallCount += 1
          const name = typeof parsed.toolName === 'string' ? parsed.toolName : ''
          if (name && !toolNames.includes(name) && toolNames.length < TIMELINE_TOOL_NAME_LIMIT) {
            toolNames.push(name)
          }
        }
        if (row.event_type === 'context_compaction' || row.event_type === 'context_summarized') {
          hasCompaction = true
        }
        if (row.created_at > lastEventAt) lastEventAt = row.created_at
      }
      return {
        turnId: window.turn_id,
        firstSeq: window.first_seq,
        lastSeq: window.last_seq,
        userMessageHead,
        messageCount,
        toolCallCount,
        toolNames,
        hasCompaction,
        lastEventAt,
      }
    })
  }

  private hasMoreRowsAfter(sessionId: string, boundarySeq: number, order: 'asc' | 'desc'): boolean {
    const comparison = order === 'asc' ? '>' : '<'
    const row = this.raw
      .prepare(
        `SELECT 1
         FROM agent_events
         WHERE session_id = ? AND turn_id IS NOT NULL AND ${HISTORY_EVENT_FILTER}
           AND seq ${comparison} ?
         LIMIT 1`,
      )
      .get(sessionId, boundarySeq)
    return row != null
  }

  /** 时间线分页与轮窗选择同键（first_seq），避免交错轮次下出现重页/漏页/空尾页 */
  private hasMoreWindowsAfter(
    sessionId: string,
    boundaryFirstSeq: number,
    order: 'asc' | 'desc',
  ): boolean {
    const comparison = order === 'asc' ? '>' : '<'
    const row = this.raw
      .prepare(
        `WITH ${TURN_WINDOWS_CTE}
         SELECT 1 FROM turn_windows WHERE first_seq ${comparison} ? LIMIT 1`,
      )
      .get(sessionId, boundaryFirstSeq)
    return row != null
  }
}

/** desc 展示翻转：轮内事件倒回时间正序 */
function flipDraft(draft: {
  turnId: string
  firstSeq: number
  lastSeq: number
  events: SessionHistoryEventItem[]
  partial: boolean
}): SessionHistoryTurnDetail {
  const events = [...draft.events].reverse()
  return {
    turnId: draft.turnId,
    firstSeq: events[0]?.seq ?? draft.firstSeq,
    lastSeq: events[events.length - 1]?.seq ?? draft.lastSeq,
    events,
    partial: draft.partial,
  }
}

function clampCursor(cursor: number | undefined, order: 'asc' | 'desc'): number {
  if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
    return order === 'asc' ? -1 : Number.MAX_SAFE_INTEGER
  }
  return Math.trunc(cursor)
}

function requireSessionId(sessionId: string): string {
  const value = sessionId.trim()
  if (!value) throw new Error('sessionId 不能为空')
  return value
}

export { HISTORY_EVENT_TYPES }
