/**
 * ToolLogTimelineRow — 工具执行日志时间线行
 *
 * 状态点 / 工具名 / 来源徽标 / 成员徽标 / 瀑布耗时条 / 耗时数字；点击行展开详情
 * （详情面板由父组件作为 children 注入，保持行组件无数据依赖）。
 *
 * 本文件同时承载时间线行与详情面板共享的领域标签映射与格式化函数
 * （状态/来源文案、耗时/字节/哈希缩略），依赖方向保持无环：
 * ChatInspectorToolLog → ToolLogTimelineRow / ToolLogDetailPanel → ToolLogTimelineRow。
 */
import type { ReactNode } from 'react'
import type {
  ToolAuditInvocationSource,
  ToolAuditLedgerRow,
  ToolAuditSourceKind,
  ToolAuditStatus,
} from '@spark/protocol'

export const TOOL_AUDIT_STATUS_LABEL: Record<ToolAuditStatus, string> = {
  ok: '成功',
  error: '失败',
  denied: '拒绝',
  timeout: '超时',
  cancelled: '取消',
  stale: '过期',
  running: '进行中',
}

/** 状态 → CSS 修饰类（配色见 ChatInspectorToolLog.less 的 s-* 系列）。 */
export const TOOL_AUDIT_STATUS_CLASS: Record<ToolAuditStatus, string> = {
  ok: 'ok',
  error: 'err',
  denied: 'denied',
  timeout: 'timeout',
  cancelled: 'cancelled',
  stale: 'stale',
  running: 'running',
}

export const TOOL_AUDIT_SOURCE_LABEL: Record<ToolAuditSourceKind, string> = {
  'sdk-builtin': 'SDK 原生',
  mcp: 'MCP',
  'custom-tool': '自定义',
  'tool-package': '工具包',
  connector: '连接器',
  workflow: '工作流',
  hook: 'Hook',
  test: '测试',
}

export const TOOL_AUDIT_INVOCATION_SOURCE_LABEL: Record<ToolAuditInvocationSource, string> = {
  model: '模型',
  workflow: '工作流',
  test: '测试',
  platform: '平台',
  nested: '嵌套',
  hook: 'Hook',
}

/** 过滤栏状态 chip 的固定展示顺序（全部 之外）。 */
export const TOOL_AUDIT_FILTERABLE_STATUSES: readonly ToolAuditStatus[] = [
  'ok',
  'error',
  'denied',
  'timeout',
  'cancelled',
  'stale',
  'running',
]

/** 耗时展示：<1s 毫秒、<1m 秒（一位小数）、以上 分秒。null/非法 → '—'。 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const seconds = ms / 1000
    return `${seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const remSeconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${remSeconds.toString().padStart(2, '0')}s`
}

/** 字节展示：B / KB / MB（一位小数）。null/非法 → '—'。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

/** 哈希/ID 缩略展示：保留前 keep 位 + 省略号。空值 → '—'。 */
export function shortHash(value: string | null | undefined, keep = 8): string {
  if (value == null || value === '') return '—'
  return value.length <= keep ? value : `${value.slice(0, keep)}…`
}

/** ISO 时间 → epoch 毫秒；非法输入返回 null。 */
export function safeEpochMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === '') return null
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

/** 慢调用阈值缺省值（超过则耗时数字按超时色高亮）。 */
export const DEFAULT_SLOW_THRESHOLD_MS = 3000

export interface ToolLogTimelineRowProps {
  row: ToolAuditLedgerRow
  /** 瀑布条左偏移（相对轮次时间轴的百分比 0-100）。 */
  barLeftPct: number
  /** 瀑布条宽度（百分比；CSS 侧另有 min-width 兜底）。 */
  barWidthPct: number
  expanded: boolean
  onToggle: () => void
  /** 当前时刻（running 行的已耗时展示用）。 */
  nowMs: number
  /** 慢调用高亮阈值；缺省 3s。 */
  slowThresholdMs?: number
  /** 展开态注入的详情面板。 */
  children?: ReactNode
}

function rowDurationText(row: ToolAuditLedgerRow, nowMs: number): string {
  if (row.status === 'running') {
    const startMs = safeEpochMs(row.startedAt)
    if (startMs == null) return '进行中'
    return `进行中 · ${formatDurationMs(Math.max(nowMs - startMs, 0))}`
  }
  return formatDurationMs(row.durationMs)
}

export function ToolLogTimelineRow({
  row,
  barLeftPct,
  barWidthPct,
  expanded,
  onToggle,
  nowMs,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  children,
}: ToolLogTimelineRowProps) {
  const statusClass = TOOL_AUDIT_STATUS_CLASS[row.status] ?? 'ok'
  const isSlow =
    row.durationMs != null && row.durationMs >= Math.max(slowThresholdMs, 1) && row.status !== 'ok'
  const durationText = rowDurationText(row, nowMs)

  return (
    <div className={`chat-toollog-row${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="chat-toollog-row__main"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? '收起详情' : '展开参数 / 结果 / 元信息'}
      >
        <span className={`chat-toollog-row__dot s-${statusClass}`} aria-hidden="true" />
        <span className="chat-toollog-row__content">
          <span className="chat-toollog-row__line1">
            <span className="chat-toollog-row__name" title={row.toolName}>
              {row.toolName}
            </span>
            <span className={`chat-toollog-badge src-${row.sourceKind}`}>
              {TOOL_AUDIT_SOURCE_LABEL[row.sourceKind] ?? row.sourceKind}
            </span>
            {row.memberAgentId != null && (
              <span className="chat-toollog-badge is-member" title={row.memberAgentId}>
                成员 · {row.memberAgentId}
              </span>
            )}
            <span className={`chat-toollog-row__dur${isSlow ? ' is-slow' : ''}`}>
              {durationText}
            </span>
          </span>
          <span className="chat-toollog-row__waterfall" aria-hidden="true">
            <span
              className={`chat-toollog-row__bar s-${statusClass}`}
              style={{ left: `${barLeftPct}%`, width: `${barWidthPct}%` }}
            />
          </span>
        </span>
      </button>
      {expanded && <div className="chat-toollog-row__detail">{children}</div>}
    </div>
  )
}
