/**
 * ChatInspectorToolLog — 会话检查器「工具执行」区块（审计级工具执行日志）
 *
 * 结构（设计方案 §7 / UI 设计稿）：
 * - 统计条：状态计数 + P95 + 总输出 + 哈希链完整性标记（`tool-audit:stats` /
 *   `tool-audit:verify-chain`）。
 * - 过滤栏：状态多选 chip + 来源下拉 + 工具名搜索（防抖 300ms，重置游标）。
 *   单状态/来源/工具名走 `tool-audit:list` 服务端过滤；多状态在客户端收口。
 * - 轮次分组时间线：组头 = 轮次 · 调用数 · 耗时合计 · 成员参与数；组内按
 *   ledger_seq 时序，顶部时钟标尺，行内瀑布耗时条（状态配色，running 脉动）。
 * - 游标分页「加载更早」；行数 > 40 启用 useVirtualizer 虚拟滚动
 *   （VirtualMessageList 先例）；静态/虚拟两种容器复用同一套扁平条目渲染。
 * - 导出：JSONL 逐行 `{...row, input, output}` → dialog:save-file → file:write-text。
 *
 * 数据加载遵循 WorktreePanel 模板：useIpcInvoke 自取数据 + 延迟一拍加载，
 * loading 骨架 / 空态 / error 重试 / 导出中状态完备。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  ToolAuditChainVerifyResult,
  ToolAuditLedgerRow,
  ToolAuditPayloadView,
  ToolAuditSourceKind,
  ToolAuditStats,
  ToolAuditStatus,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { InspectorCollapsibleSection } from './InspectorCollapsibleSection'
import { useToast } from './Toast'
import { ToolLogDetailPanel, TOOL_AUDIT_PAYLOAD_PAGE_BYTES } from './ToolLogDetailPanel'
import {
  DEFAULT_SLOW_THRESHOLD_MS,
  TOOL_AUDIT_FILTERABLE_STATUSES,
  TOOL_AUDIT_SOURCE_LABEL,
  TOOL_AUDIT_STATUS_LABEL,
  ToolLogTimelineRow,
  formatBytes,
  formatDurationMs,
  safeEpochMs,
} from './ToolLogTimelineRow'
import './ChatInspectorToolLog.less'

const PAGE_LIMIT = 100
const VIRTUALIZE_AT = 40
const SEARCH_DEBOUNCE_MS = 300
const VIRTUAL_SCROLL_MAX_HEIGHT = 440
const RULER_TICKS = 4
/** 导出时归档载荷的总预算与单载荷上限（防超大载荷拖垮导出）。 */
const EXPORT_ARCHIVED_BUDGET_BYTES = 8 * 1024 * 1024
const EXPORT_ARCHIVED_PER_PAYLOAD_CAP = 512 * 1024
const EXPORT_PAYLOAD_PAGE_GUARD = 256

type SourceKindFilter = ToolAuditSourceKind | 'all'

interface TurnGroup {
  key: string
  label: string
  title: string
  /** 组内按 ledger_seq 升序（时间线时序）。 */
  rows: ToolAuditLedgerRow[]
  totalMs: number
  memberCount: number
  startMs: number
  spanMs: number
}

type FlatItem =
  | { kind: 'head'; group: TurnGroup; open: boolean }
  | { kind: 'row'; row: ToolAuditLedgerRow; group: TurnGroup }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildTurnGroups(rows: ToolAuditLedgerRow[], nowMs: number): TurnGroup[] {
  // rows 为全局降序（新→旧）；分组按最新调用所在轮次置顶。
  const sorted = [...rows].sort((a, b) => b.ledgerSeq - a.ledgerSeq)
  const groups = new Map<string, TurnGroup>()
  for (const row of sorted) {
    const key = row.turnId ?? '__no-turn__'
    let group = groups.get(key)
    if (group == null) {
      group = {
        key,
        label: row.turnId == null ? '未关联轮次' : `轮次 ${row.turnId.slice(0, 8)}`,
        title: row.turnId == null ? '未关联到任何轮次的工具调用' : row.turnId,
        rows: [],
        totalMs: 0,
        memberCount: 0,
        startMs: Number.POSITIVE_INFINITY,
        spanMs: 0,
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.durationMs != null) group.totalMs += row.durationMs
    const startMs = safeEpochMs(row.startedAt)
    if (startMs != null) group.startMs = Math.min(group.startMs, startMs)
  }
  for (const group of groups.values()) {
    const members = new Set<string>()
    let endMs = Number.NEGATIVE_INFINITY
    // 组内升序 + 以最长结束时刻（含 running 的当前时刻）计算时间轴跨度
    group.rows.sort((a, b) => a.ledgerSeq - b.ledgerSeq)
    for (const row of group.rows) {
      if (row.memberAgentId != null) members.add(row.memberAgentId)
      const startMs = safeEpochMs(row.startedAt)
      if (startMs == null) continue
      const duration = row.durationMs ?? Math.max(nowMs - startMs, 0)
      endMs = Math.max(endMs, startMs + duration)
    }
    group.memberCount = members.size
    if (!Number.isFinite(group.startMs)) group.startMs = 0
    group.spanMs = Math.max(endMs - group.startMs, 1)
  }
  return [...groups.values()]
}

/** 瀑布条几何：左偏移 = (start−turnStart)/span，宽 = duration/span（客户端收口到 ≥0.5%）。 */
function barGeometry(
  row: ToolAuditLedgerRow,
  group: TurnGroup,
  nowMs: number,
): { leftPct: number; widthPct: number } {
  const startMs = safeEpochMs(row.startedAt)
  if (startMs == null) return { leftPct: 0, widthPct: 0 }
  const duration = row.durationMs ?? Math.max(nowMs - startMs, 0)
  const leftPct = clamp(((startMs - group.startMs) / group.spanMs) * 100, 0, 100)
  const widthPct = clamp((duration / group.spanMs) * 100, 0.5, 100 - leftPct)
  return { leftPct, widthPct }
}

function rulerLabels(group: TurnGroup): string[] {
  const labels: string[] = []
  for (let i = 0; i < RULER_TICKS; i += 1) {
    const at = (group.spanMs * i) / (RULER_TICKS - 1)
    labels.push(i === 0 ? '0s' : formatDurationMs(at))
  }
  return labels
}

function buildListRequest(
  filters: {
    sessionId: string
    singleStatus: ToolAuditStatus | undefined
    sourceKind: SourceKindFilter
    searchQuery: string
  },
  cursor?: number,
) {
  return {
    sessionId: filters.sessionId,
    limit: PAGE_LIMIT,
    ...(filters.singleStatus != null ? { status: filters.singleStatus } : {}),
    ...(filters.sourceKind !== 'all' ? { sourceKind: filters.sourceKind } : {}),
    ...(filters.searchQuery !== '' ? { toolName: filters.searchQuery } : {}),
    ...(cursor != null ? { cursor } : {}),
  }
}

function mergeRows(prev: ToolAuditLedgerRow[], next: ToolAuditLedgerRow[]): ToolAuditLedgerRow[] {
  const byId = new Map<string, ToolAuditLedgerRow>()
  for (const row of prev) byId.set(row.id, row)
  for (const row of next) byId.set(row.id, row) // 后取（更新）的覆盖旧态（如 running→ok）
  return [...byId.values()].sort((a, b) => b.ledgerSeq - a.ledgerSeq)
}

function flatItemKey(item: FlatItem): string {
  return item.kind === 'head' ? `head-${item.group.key}` : `row-${item.row.id}`
}

export interface ChatInspectorToolLogProps {
  sessionId: string
}

export function ChatInspectorToolLog({ sessionId }: ChatInspectorToolLogProps) {
  const { toast } = useToast()
  const { invoke: invokeList } = useIpcInvoke('tool-audit:list')
  const { invoke: invokeStats } = useIpcInvoke('tool-audit:stats')
  const { invoke: invokeVerifyChain } = useIpcInvoke('tool-audit:verify-chain')
  const { invoke: invokeDetail } = useIpcInvoke('tool-audit:detail')
  const { invoke: invokeReadPayload } = useIpcInvoke('tool-audit:read-payload')
  const { invoke: saveFileDialog } = useIpcInvoke('dialog:save-file')
  const { invoke: writeText } = useIpcInvoke('file:write-text')

  const [rows, setRows] = useState<ToolAuditLedgerRow[]>([])
  const [pageInfo, setPageInfo] = useState<{ hasMore: boolean; nextCursor: number | null }>({
    hasMore: false,
    nextCursor: null,
  })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [stats, setStats] = useState<ToolAuditStats | null>(null)
  const [chain, setChain] = useState<ToolAuditChainVerifyResult | null>(null)
  /** 链校验 IPC 抛错（与「未校验」的 chain==null 区分，审查 U11）。 */
  const [chainError, setChainError] = useState<string | null>(null)

  // 过滤状态：statusSet 多选（0 = 全部）；sourceKind 单选；搜索 300ms 防抖。
  const [statusSet, setStatusSet] = useState<ReadonlySet<ToolAuditStatus>>(new Set())
  const [sourceKind, setSourceKind] = useState<SourceKindFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [collapsedTurnKeys, setCollapsedTurnKeys] = useState<ReadonlySet<string>>(new Set())
  const [exportState, setExportState] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  })
  const [nowMs, setNowMs] = useState(() => Date.now())

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const aliveRef = useRef(true)
  /** 首屏请求序号：过滤切换时旧响应落地前被新请求作废（审查 D9）。 */
  const loadSeqRef = useRef(0)
  /** stats / verify-chain 各自的请求序号（会话切换与刷新重入时作废旧响应，审查 U3）。 */
  const statsSeqRef = useRef(0)
  const chainSeqRef = useRef(0)
  const exportBudgetRef = useRef(EXPORT_ARCHIVED_BUDGET_BYTES)
  const exportSkippedRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [searchInput])

  const singleStatus = statusSet.size === 1 ? [...statusSet][0] : undefined

  const loadFirstPage = useCallback(async () => {
    // 竞态守卫（审查 D9）：快速切换过滤时旧响应不得覆盖新响应。
    const requestId = ++loadSeqRef.current
    setLoading(true)
    setListError(null)
    try {
      const res = await invokeList(
        buildListRequest({ sessionId, singleStatus, sourceKind, searchQuery }),
      )
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      setRows(res.rows)
      setPageInfo({ hasMore: res.hasMore, nextCursor: res.nextCursor ?? null })
    } catch (err) {
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      setRows([])
      setPageInfo({ hasMore: false, nextCursor: null })
      setListError(errorMessage(err))
    } finally {
      if (aliveRef.current && requestId === loadSeqRef.current) setLoading(false)
    }
  }, [invokeList, sessionId, singleStatus, sourceKind, searchQuery])

  const loadStats = useCallback(async () => {
    // 序号守卫（审查 U3）：会话切换 / 刷新重入时旧响应不得落地。
    const requestId = ++statsSeqRef.current
    try {
      const res = await invokeStats({ sessionId })
      if (!aliveRef.current || requestId !== statsSeqRef.current) return
      setStats(res)
    } catch {
      // 统计失败不阻塞时间线；保持 null（统计条隐藏）
    }
  }, [invokeStats, sessionId])

  const loadChain = useCallback(async () => {
    // 序号守卫同 stats（审查 U3）；IPC 抛错落 chainError 与「未校验」区分（审查 U11）。
    const requestId = ++chainSeqRef.current
    try {
      const res = await invokeVerifyChain({ sessionId })
      if (!aliveRef.current || requestId !== chainSeqRef.current) return
      setChain(res)
      setChainError(null)
    } catch (err) {
      if (!aliveRef.current || requestId !== chainSeqRef.current) return
      setChain(null)
      setChainError(errorMessage(err))
    }
  }, [invokeVerifyChain, sessionId])

  // 挂载与过滤变化统一走「重置游标」的首页加载（搜索防抖已在上游完成）。
  useEffect(() => {
    const id = window.setTimeout(() => void loadFirstPage(), 0)
    return () => window.clearTimeout(id)
  }, [loadFirstPage])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadStats()
      void loadChain()
    }, 0)
    return () => window.clearTimeout(id)
  }, [loadStats, loadChain])

  // 刷新三者口径一致：每个加载器自带序号守卫，并发重入时旧响应统一作废（审查 U3）。
  const handleRefresh = useCallback(() => {
    void loadFirstPage()
    void loadStats()
    void loadChain()
  }, [loadFirstPage, loadStats, loadChain])

  const loadOlder = useCallback(async () => {
    const { hasMore, nextCursor } = pageInfo
    if (!hasMore || nextCursor == null || loadingMore) return
    // 竞态守卫（审查 U2）：翻页不递增序号（它是「被继续」方），任何
    // loadFirstPage（递增 loadSeqRef）都会作废在途的翻页响应。
    const requestId = loadSeqRef.current
    setLoadingMore(true)
    try {
      const res = await invokeList(
        buildListRequest({ sessionId, singleStatus, sourceKind, searchQuery }, nextCursor),
      )
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      setRows((prev) => mergeRows(prev, res.rows))
      setPageInfo({ hasMore: res.hasMore, nextCursor: res.nextCursor ?? null })
    } catch (err) {
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      toast.error(`加载更早的工具日志失败：${errorMessage(err)}`)
    } finally {
      if (aliveRef.current) setLoadingMore(false)
    }
  }, [invokeList, loadingMore, pageInfo, searchQuery, sessionId, singleStatus, sourceKind, toast])

  // running 行的耗时/瀑布条需要周期性刷新（1s 足够视觉更新）。
  const hasRunning = rows.some((row) => row.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasRunning])

  // 多状态过滤在客户端收口（wire 仅支持单状态；单状态已走服务端）。
  const visibleRows = useMemo(
    () => (statusSet.size > 1 ? rows.filter((row) => statusSet.has(row.status)) : rows),
    [rows, statusSet],
  )
  const groups = useMemo(() => buildTurnGroups(visibleRows, nowMs), [visibleRows, nowMs])

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = []
    for (const group of groups) {
      const open = !collapsedTurnKeys.has(group.key)
      items.push({ kind: 'head', group, open })
      if (open) {
        for (const row of group.rows) items.push({ kind: 'row', row, group })
      }
    }
    return items
  }, [groups, collapsedTurnKeys])

  const virtualized = flatItems.length > VIRTUALIZE_AT
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (flatItems[index]?.kind === 'head' ? 52 : 58),
    getItemKey: (index) => {
      const item = flatItems[index]
      return item == null ? index : flatItemKey(item)
    },
    overscan: 8,
  })

  const toggleStatusChip = useCallback((status: ToolAuditStatus) => {
    setStatusSet((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }, [])

  const clearStatusChips = useCallback(() => {
    setStatusSet(new Set<ToolAuditStatus>())
  }, [])

  const toggleTurnGroup = useCallback((key: string) => {
    setCollapsedTurnKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  /** 导出用载荷解析：内联直取；归档载荷在预算内分页读全，超预算导出引用（行内含 artifactId/sha256）。 */
  const resolvePayloadForExport = useCallback(
    async (view: ToolAuditPayloadView | undefined): Promise<unknown> => {
      if (view == null) return null
      if (view.inline !== undefined) return view.inline
      const artifactId = view.artifactId
      if (artifactId == null) return null
      const bytes = view.bytes ?? Number.POSITIVE_INFINITY
      if (bytes > EXPORT_ARCHIVED_PER_PAYLOAD_CAP || bytes > exportBudgetRef.current) {
        exportSkippedRef.current = true
        return null
      }
      let acc = ''
      let offset = 0
      let pageCount = 0
      while (pageCount < EXPORT_PAYLOAD_PAGE_GUARD) {
        const res = await invokeReadPayload({
          artifactId,
          limit: TOOL_AUDIT_PAYLOAD_PAGE_BYTES,
          ...(offset > 0 ? { offset } : {}),
        })
        acc += res.chunk
        pageCount += 1
        if (res.nextOffset == null) break
        offset = res.nextOffset
      }
      exportBudgetRef.current -= acc.length
      return acc
    },
    [invokeReadPayload],
  )

  const handleExport = useCallback(async () => {
    if (exportState.active || visibleRows.length === 0) return
    const exportRows = [...visibleRows].sort((a, b) => a.ledgerSeq - b.ledgerSeq)
    exportBudgetRef.current = EXPORT_ARCHIVED_BUDGET_BYTES
    exportSkippedRef.current = false
    setExportState({ active: true, done: 0, total: exportRows.length })
    try {
      const lines: string[] = []
      for (let i = 0; i < exportRows.length; i += 1) {
        const row = exportRows[i]
        if (row == null) continue
        let input: unknown = null
        let output: unknown = null
        try {
          const detail = await invokeDetail({ id: row.id })
          input = await resolvePayloadForExport(detail.input)
          output = await resolvePayloadForExport(detail.output)
        } catch {
          // 单行详情失败不中断整体导出；载荷置 null（行本身仍含哈希与 artifact 引用）
        }
        lines.push(JSON.stringify({ ...row, input, output }))
        if (aliveRef.current) {
          setExportState({ active: true, done: i + 1, total: exportRows.length })
        }
      }
      const dialog = await saveFileDialog({
        title: '导出工具执行日志',
        defaultPath: `tool-audit-${sessionId}.jsonl`,
        filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
      })
      if (dialog.canceled || dialog.filePath == null) return
      await writeText({ path: dialog.filePath, content: `${lines.join('\n')}\n` })
      if (!aliveRef.current) return
      // 完整性提示（审查 U4）：还有未加载页时明示导出的只是已加载部分。
      if (pageInfo.hasMore) {
        toast.success(
          stats != null
            ? `已导出 ${lines.length} 条（仅已加载部分，共 ${stats.total} 条，可加载更多后再导出）：${dialog.filePath}`
            : `已导出 ${lines.length} 条（仅已加载部分，可加载更多后再导出）：${dialog.filePath}`,
        )
      } else {
        toast.success(`已导出 ${lines.length} 条工具日志：${dialog.filePath}`)
      }
      if (exportSkippedRef.current) {
        toast.warning('部分归档载荷因超出导出预算未内联，行内保留 artifactId 与 sha256 引用')
      }
    } catch (err) {
      if (aliveRef.current) toast.error(`导出失败：${errorMessage(err)}`)
    } finally {
      if (aliveRef.current) setExportState({ active: false, done: 0, total: 0 })
    }
  }, [
    exportState.active,
    invokeDetail,
    pageInfo.hasMore,
    resolvePayloadForExport,
    saveFileDialog,
    sessionId,
    stats,
    toast,
    visibleRows,
    writeText,
  ])

  const renderGroupHead = useCallback(
    (group: TurnGroup, open: boolean) => (
      <button
        type="button"
        className={`chat-toollog__group-head${open ? ' is-open' : ''}`}
        onClick={() => toggleTurnGroup(group.key)}
        aria-expanded={open}
        title={group.title}
      >
        <span className="chat-toollog__group-name">{group.label}</span>
        <span className="chat-toollog__group-meta">
          {group.rows.length} 次调用 · 合计 {formatDurationMs(group.totalMs)}
          {group.memberCount > 0 ? ` · ${group.memberCount} 个成员参与` : ''}
        </span>
        <Icons.ChevronRight
          aria-hidden="true"
          size={10}
          className={`chat-toollog__chev${open ? ' is-open' : ''}`}
        />
      </button>
    ),
    [toggleTurnGroup],
  )

  const renderRow = useCallback(
    (row: ToolAuditLedgerRow, group: TurnGroup) => {
      const { leftPct, widthPct } = barGeometry(row, group, nowMs)
      const expanded = expandedId === row.id
      return (
        <ToolLogTimelineRow
          key={row.id}
          row={row}
          barLeftPct={leftPct}
          barWidthPct={widthPct}
          expanded={expanded}
          onToggle={() => toggleExpanded(row.id)}
          nowMs={nowMs}
          slowThresholdMs={stats?.p95Ms ?? DEFAULT_SLOW_THRESHOLD_MS}
        >
          <ToolLogDetailPanel row={row} chain={chain} />
        </ToolLogTimelineRow>
      )
    },
    [chain, expandedId, nowMs, stats?.p95Ms, toggleExpanded],
  )

  // 虚拟滚动模式用扁平条目（组头+标尺合并为一张小卡，行独立成条）；
  // 静态模式（≤40 行的常见场景）按设计稿渲染完整的轮次分组卡片。
  const renderFlatItem = useCallback(
    (item: FlatItem): ReactNode =>
      item.kind === 'head' ? (
        <div className={`chat-toollog__group${item.open ? ' is-open is-flat' : ''}`}>
          {renderGroupHead(item.group, item.open)}
          {item.open && (
            <div className="chat-toollog__group-rows">
              <div className="chat-toollog__ruler" aria-hidden="true">
                {rulerLabels(item.group).map((label, idx) => (
                  <span key={idx}>{label}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        renderRow(item.row, item.group)
      ),
    [renderGroupHead, renderRow],
  )

  const filtersActive = statusSet.size > 0 || sourceKind !== 'all' || searchQuery !== ''

  return (
    <InspectorCollapsibleSection
      className="chat-toollog"
      title="工具执行"
      defaultExpanded
      summary={
        stats != null && stats.total > 0 ? (
          <span className="inspector-count">{stats.total} 次调用</span>
        ) : undefined
      }
      headerAction={
        <>
          <button
            type="button"
            className="chat-toollog__icon-btn"
            onClick={() => void handleExport()}
            disabled={exportState.active || visibleRows.length === 0}
            title="导出 JSONL（含脱敏载荷与哈希链）"
            aria-label="导出工具执行日志"
          >
            {exportState.active ? (
              <Icons.Spinner size={11} className="chat-toollog__spin" />
            ) : (
              <Icons.Download size={11} />
            )}
          </button>
          <button
            type="button"
            className="chat-toollog__icon-btn"
            onClick={handleRefresh}
            disabled={loading}
            title="刷新"
            aria-label="刷新工具执行日志"
          >
            <Icons.Refresh size={11} />
          </button>
        </>
      }
    >
      <div className="chat-toollog__body">
        {stats != null && stats.total > 0 && (
          <div className="chat-toollog__stats">
            <span className="chat-toollog__stat">
              <span className="chat-toollog__dot s-ok" />
              <b>{stats.byStatus.ok}</b> 成功
            </span>
            <span className="chat-toollog__stat">
              <span className="chat-toollog__dot s-err" />
              <b>{stats.byStatus.error}</b> 失败
            </span>
            <span className="chat-toollog__stat">
              <span className="chat-toollog__dot s-denied" />
              <b>{stats.byStatus.denied}</b> 拒绝
            </span>
            <span className="chat-toollog__stat">
              <span className="chat-toollog__dot s-timeout" />
              <b>{stats.byStatus.timeout}</b> 超时
            </span>
            {stats.byStatus.running > 0 && (
              <span className="chat-toollog__stat">
                <span className="chat-toollog__dot s-running" />
                <b>{stats.byStatus.running}</b> 进行中
              </span>
            )}
            {stats.byStatus.cancelled > 0 && (
              <span className="chat-toollog__stat">
                <span className="chat-toollog__dot s-cancelled" />
                <b>{stats.byStatus.cancelled}</b> 取消
              </span>
            )}
            {stats.byStatus.stale > 0 && (
              <span className="chat-toollog__stat">
                <span className="chat-toollog__dot s-stale" />
                <b>{stats.byStatus.stale}</b> 过期
              </span>
            )}
            <span className="chat-toollog__stat">
              P95 <b>{formatDurationMs(stats.p95Ms)}</b>
            </span>
            <span className="chat-toollog__stat">
              载荷 <b>{formatBytes(stats.totalBytes)}</b>
            </span>
            {chainError != null ? (
              <button
                type="button"
                className="chat-toollog__chain is-error"
                title={`哈希链校验失败：${chainError}（点击重试）`}
                onClick={() => void loadChain()}
              >
                ⛓ 链校验失败 ↻
              </button>
            ) : (
              chain != null &&
              chain.checkedCount > 0 && (
                <span
                  className={`chat-toollog__chain${chain.ok ? ' is-ok' : ' is-bad'}`}
                  title={
                    chain.ok
                      ? `哈希链校验通过（${chain.checkedCount} 条）`
                      : `哈希链断裂于 seq ${chain.breakAt?.ledgerSeq ?? '?'}`
                  }
                >
                  {chain.ok ? '⛓ 链完整 ✓' : `⛓ 链断裂 ⚠ seq ${chain.breakAt?.ledgerSeq ?? '?'}`}
                </span>
              )
            )}
          </div>
        )}

        <div className="chat-toollog__filters">
          <button
            type="button"
            className={`chat-toollog__chip${statusSet.size === 0 ? ' is-active' : ''}`}
            onClick={clearStatusChips}
            aria-pressed={statusSet.size === 0}
          >
            全部
          </button>
          {TOOL_AUDIT_FILTERABLE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`chat-toollog__chip${statusSet.has(status) ? ' is-active' : ''}`}
              onClick={() => toggleStatusChip(status)}
              aria-pressed={statusSet.has(status)}
            >
              {TOOL_AUDIT_STATUS_LABEL[status]}
            </button>
          ))}
          <span className="chat-toollog__filters-right">
            <select
              className="chat-toollog__select"
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value as SourceKindFilter)}
              aria-label="按来源过滤"
            >
              <option value="all">全部来源</option>
              {(Object.keys(TOOL_AUDIT_SOURCE_LABEL) as ToolAuditSourceKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {TOOL_AUDIT_SOURCE_LABEL[kind]}
                </option>
              ))}
            </select>
            <input
              className="chat-toollog__search"
              placeholder="搜索工具名…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="搜索工具名"
            />
          </span>
        </div>

        {listError != null ? (
          <div className="chat-toollog__error">
            <span>工具日志加载失败：{listError}</span>
            <button type="button" onClick={() => void loadFirstPage()}>
              重试
            </button>
          </div>
        ) : loading ? (
          <div className="chat-toollog__skeleton" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="chat-toollog__skeleton-row"
                style={{ width: i % 2 === 0 ? '64%' : '86%' }}
              />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="chat-toollog__empty">
            {filtersActive ? (
              <p>没有符合过滤条件的工具调用。</p>
            ) : (
              <>
                <p>本轮尚无工具调用。</p>
                <p className="chat-toollog__empty-hint">
                  Agent 调用 Bash / Read / MCP 等工具后，每次执行的参数、结果与审计链会记录在这里。
                </p>
              </>
            )}
          </div>
        ) : virtualized ? (
          <div
            className="chat-toollog__scroll"
            ref={scrollRef}
            style={{ maxHeight: VIRTUAL_SCROLL_MAX_HEIGHT }}
          >
            <div className="chat-toollog__virtual" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = flatItems[virtualRow.index]
                if (item == null) return null
                return (
                  <div
                    key={virtualRow.key}
                    ref={(node) => virtualizer.measureElement(node)}
                    data-index={virtualRow.index}
                    className="chat-toollog__vrow"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {renderFlatItem(item)}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="chat-toollog__timeline">
            {groups.map((group) => {
              const open = !collapsedTurnKeys.has(group.key)
              return (
                <div key={group.key} className={`chat-toollog__group${open ? ' is-open' : ''}`}>
                  {renderGroupHead(group, open)}
                  {open && (
                    <div className="chat-toollog__group-rows">
                      <div className="chat-toollog__ruler" aria-hidden="true">
                        {rulerLabels(group).map((label, idx) => (
                          <span key={idx}>{label}</span>
                        ))}
                      </div>
                      {group.rows.map((row) => renderRow(row, group))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {(visibleRows.length > 0 || pageInfo.hasMore) && (
          <div className="chat-toollog__foot">
            {exportState.active
              ? `正在导出 ${exportState.done}/${exportState.total} …`
              : filtersActive
                ? `已匹配 ${visibleRows.length} 条`
                : `游标分页 · 已加载 ${visibleRows.length}${stats != null ? `/${stats.total}` : ''} 条`}
            {pageInfo.hasMore && !loading && (
              <button
                type="button"
                className="chat-toollog__more"
                onClick={() => void loadOlder()}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中…' : '加载更早'}
              </button>
            )}
          </div>
        )}
      </div>
    </InspectorCollapsibleSection>
  )
}
