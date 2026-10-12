/**
 * ToolLogDetailPanel — 工具执行日志详情展开
 *
 * 三页签：参数 / 结果 / 元信息。
 * - 参数/结果：初始经 `tool-audit:detail` 取内联载荷；归档载荷（artifactId、无
 *   inline）显示字节数 + 「加载」按钮，走 `tool-audit:read-payload` 分页读取
 *   （40k/页，按 nextOffset 续读拼接，truncated 提示）。
 * - 元信息：correlation_id、ledger_seq、record_hash（缩略+复制）、
 *   finished_record_hash、链完整性标记、重试次数、error code/message、
 *   全部归因字段（会话/轮次/项目/agent/工作流/成员/引擎/来源服务器等）。
 *
 * 载荷本身已在上游脱敏（敏感字段即 `***` 形态），这里直接 JSON 展示。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ToolAuditChainVerifyResult,
  ToolAuditLedgerRow,
  ToolAuditPayloadView,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import {
  TOOL_AUDIT_INVOCATION_SOURCE_LABEL,
  TOOL_AUDIT_SOURCE_LABEL,
  TOOL_AUDIT_STATUS_LABEL,
  formatBytes,
  formatDurationMs,
  shortHash,
} from './ToolLogTimelineRow'

/** 归档载荷分页大小（协议上限 40k）。 */
export const TOOL_AUDIT_PAYLOAD_PAGE_BYTES = 40_000
/** 分页读取的有界页数上限，防御异常 nextOffset 造成死循环。 */
const PAYLOAD_PAGE_GUARD = 256

type DetailTab = 'input' | 'output' | 'meta'

interface ToolLogDetailPanelProps {
  row: ToolAuditLedgerRow
  chain: ToolAuditChainVerifyResult | null
}

interface DetailState {
  row: ToolAuditLedgerRow
  input?: ToolAuditPayloadView
  output?: ToolAuditPayloadView
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function renderInlineValue(inline: unknown): string {
  if (typeof inline === 'string') return inline
  try {
    return JSON.stringify(inline, null, 2)
  } catch {
    return String(inline)
  }
}

/** 可复制元信息值（哈希 / correlation_id 等）。 */
function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // 剪贴板不可用时静默失败（非关键路径）
    }
  }, [value])
  return (
    <button
      type="button"
      className={`chat-toollog-copy${copied ? ' is-copied' : ''}`}
      onClick={() => void handleCopy()}
      title={copied ? '已复制' : '复制完整值'}
      aria-label={copied ? '已复制' : '复制完整值'}
    >
      {copied ? <Icons.Check size={10} /> : <Icons.Copy size={10} />}
    </button>
  )
}

interface PayloadViewProps {
  label: string
  view: ToolAuditPayloadView | undefined
  /** 行级采集截断标志（载荷超 64MB 上限时采集层置位）。 */
  rowTruncated: boolean
}

/** 参数/结果载荷视图：内联直出；归档显示字节数 + 分页加载。 */
function PayloadView({ label, view, rowTruncated }: PayloadViewProps) {
  const { invoke: invokeReadPayload } = useIpcInvoke('tool-audit:read-payload')
  const [text, setText] = useState<string | null>(null)
  const [pages, setPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 预算耗尽守卫触发（256 页 ≈ 10MB）时的本地截断提示。 */
  const [guardHit, setGuardHit] = useState(false)

  if (view == null) {
    return <div className="chat-toollog__hint">（{label}未记录）</div>
  }
  if (view.inline !== undefined) {
    const body = renderInlineValue(view.inline)
    if (body === '') return <div className="chat-toollog__hint">（{label}为空）</div>
    return <pre className="chat-toollog-json">{body}</pre>
  }

  const artifactId = view.artifactId
  if (artifactId == null) {
    return <div className="chat-toollog__hint">（{label}载荷不可用）</div>
  }

  const handleLoad = async () => {
    setLoading(true)
    setError(null)
    setGuardHit(false)
    try {
      let acc = ''
      let offset = 0
      let pageCount = 0
      let pendingOffset: number | null | undefined = null
      while (pageCount < PAYLOAD_PAGE_GUARD) {
        const res = await invokeReadPayload({
          artifactId,
          limit: TOOL_AUDIT_PAYLOAD_PAGE_BYTES,
          ...(offset > 0 ? { offset } : {}),
        })
        acc += res.chunk
        pageCount += 1
        setText(acc)
        setPages(pageCount)
        pendingOffset = res.nextOffset
        if (pendingOffset == null) break
        offset = pendingOffset
      }
      // 守卫耗尽且仍有未读偏移：静默截断不可接受（审查 D6），显式提示。
      if (pendingOffset != null) setGuardHit(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-toollog-archive">
      <div className="chat-toollog-archive__meta">
        归档载荷 {formatBytes(view.bytes)} · sha256 {shortHash(view.sha256)}
      </div>
      {text != null ? (
        <pre className="chat-toollog-json">{text}</pre>
      ) : (
        <button
          type="button"
          className="chat-toollog-archive__load"
          onClick={() => void handleLoad()}
          disabled={loading}
        >
          {loading
            ? `加载中 · 已 ${pages} 页…`
            : pages > 0
              ? `继续加载（已 ${pages} 页 · 40k/页）`
              : '加载完整内容（40k/页）'}
        </button>
      )}
      {(guardHit || rowTruncated) && (
        <div className="chat-toollog-archive__note">
          {rowTruncated
            ? '载荷超出采集上限（64MB），采集时已截断'
            : '载荷过大，预览已按安全上限截断'}
        </div>
      )}
      {error != null && (
        <div className="chat-toollog-detail__error">
          <span>载荷读取失败：{error}</span>
          <button type="button" onClick={() => void handleLoad()}>
            重试
          </button>
        </div>
      )}
    </div>
  )
}

function chainMarkText(chain: ToolAuditChainVerifyResult | null): string {
  if (chain == null) return '未校验'
  if (chain.ok) return '✓ 链完整'
  return `⚠ 链断裂于 seq ${chain.breakAt?.ledgerSeq ?? '?'}`
}

function chainTitle(chain: ToolAuditChainVerifyResult | null): string {
  if (chain == null) return '尚未执行哈希链校验'
  if (chain.ok) return `哈希链校验通过（${chain.checkedCount} 条）`
  const breakAt = chain.breakAt
  const reason =
    breakAt == null
      ? ''
      : `原因 ${breakAt.reason}` +
        (breakAt.expectedHash != null ? ` · 期望 ${breakAt.expectedHash}` : '') +
        (breakAt.actualHash != null ? ` · 实际 ${breakAt.actualHash}` : '')
  return `哈希链在第 ${breakAt?.ledgerSeq ?? '?'} 条断裂${reason ? `（${reason}）` : ''}`
}

interface MetaRowProps {
  label: string
  value: string
  /** 提供时展示复制按钮，并以完整值作为悬浮提示。 */
  copyText?: string
  tone?: 'ok' | 'err'
  title?: string
}

function MetaRow({ label, value, copyText, tone, title }: MetaRowProps) {
  const resolvedTitle = title ?? copyText ?? value
  return (
    <>
      <span className="chat-toollog-meta__k">{label}</span>
      <span
        className={`chat-toollog-meta__v${tone === 'ok' ? ' is-ok' : ''}${tone === 'err' ? ' is-err' : ''}`}
        title={resolvedTitle}
      >
        {value}
        {copyText != null && copyText !== '' && <CopyableValue value={copyText} />}
      </span>
    </>
  )
}

function payloadSummary(view: ToolAuditPayloadView | undefined): string {
  if (view == null) return '—'
  const kind = view.inline !== undefined ? '内联' : view.artifactId != null ? '归档' : '不可用'
  return `${kind} ${formatBytes(view.bytes)}（sha256 ${shortHash(view.sha256)}）`
}

function MetaView({
  row,
  chain,
  detail,
}: {
  row: ToolAuditLedgerRow
  chain: ToolAuditChainVerifyResult | null
  detail: DetailState | null
}) {
  const statusLabel = TOOL_AUDIT_STATUS_LABEL[row.status] ?? row.status
  const chainTone = chain == null ? undefined : chain.ok ? ('ok' as const) : ('err' as const)

  const sourceParts: string[] = [
    TOOL_AUDIT_SOURCE_LABEL[row.sourceKind] ?? row.sourceKind,
    TOOL_AUDIT_INVOCATION_SOURCE_LABEL[row.invocationSource] ?? row.invocationSource,
  ]
  if (row.mcpServerId != null) sourceParts.push(row.mcpServerId)
  if (row.packageId != null) sourceParts.push(row.packageId)
  if (row.adapter != null) sourceParts.push(`adapter=${row.adapter}`)
  if (row.version != null) sourceParts.push(`v${row.version}`)

  const metaRows: MetaRowProps[] = [
    { label: 'ledger_seq', value: `#${row.ledgerSeq}` },
    {
      label: 'correlation',
      value: shortHash(row.correlationId, 12),
      ...(row.correlationId != null ? { copyText: row.correlationId } : {}),
    },
    {
      label: '状态',
      value: row.errorCode != null ? `${statusLabel} · ${row.errorCode}` : statusLabel,
      ...(row.status === 'error' ? { tone: 'err' as const } : {}),
    },
    { label: '耗时', value: `${formatDurationMs(row.durationMs)} · 重试 ${row.retryCount}` },
    { label: '来源', value: sourceParts.join(' · ') },
    { label: '工具ID', value: row.toolId ?? '—' },
    { label: '载荷', value: `input ${payloadSummary(detail?.input)}` },
    { label: '输出', value: `output ${payloadSummary(detail?.output)}` },
    {
      label: '审计链',
      value: chainMarkText(chain),
      title: chainTitle(chain),
      ...(chainTone != null ? { tone: chainTone } : {}),
    },
    {
      label: 'record_hash',
      value: shortHash(row.recordHash),
      ...(row.recordHash != null ? { copyText: row.recordHash } : {}),
      ...(chain != null && !chain.ok ? { tone: 'err' as const } : { tone: 'ok' as const }),
    },
    {
      label: 'prev_hash',
      value: shortHash(row.prevHash),
      ...(row.prevHash != null ? { copyText: row.prevHash } : {}),
    },
    {
      label: 'finished_hash',
      value: shortHash(row.finishedRecordHash),
      ...(row.finishedRecordHash != null ? { copyText: row.finishedRecordHash } : {}),
    },
  ]

  const attribution: Array<[string, string | null]> = [
    ['会话', row.sessionId],
    ['轮次', row.turnId],
    ['项目', row.projectId],
    ['Agent', row.agentId],
    ['工作流', row.workflowId],
    ['派发', row.dispatchId],
    ['成员', row.memberAgentId],
    ['Hook', row.hookId],
    ['Hook 运行', row.hookRunId],
    ['引擎', row.engine],
    ['来源服务器', row.mcpServerId],
  ]
  for (const [label, value] of attribution) {
    if (value != null) metaRows.push({ label, value })
  }

  return (
    <div className="chat-toollog-meta">
      {metaRows.map((metaRow) => (
        <MetaRow key={metaRow.label} {...metaRow} />
      ))}
      {(row.errorCode != null || row.errorMessage != null) && (
        <div className="chat-toollog-detail__err">
          {[row.errorCode, row.errorMessage]
            .filter((part) => part != null && part !== '')
            .join('：')}
        </div>
      )}
    </div>
  )
}

export function ToolLogDetailPanel({ row, chain }: ToolLogDetailPanelProps) {
  const { invoke: invokeDetail } = useIpcInvoke('tool-audit:detail')
  // 错误行默认落在元信息页签（用户最关心失败原因），其余默认参数页签。
  const [tab, setTab] = useState<DetailTab>(row.status === 'error' ? 'meta' : 'input')
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await invokeDetail({ id: row.id }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [invokeDetail, row.id])

  useEffect(() => {
    // 延迟到下一个 tick，避免在 effect 体内同步 setState（cascading renders）
    const id = window.setTimeout(() => void loadDetail(), 0)
    return () => window.clearTimeout(id)
  }, [loadDetail])

  const mergedRow = detail?.row ?? row
  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: 'input', label: '参数' },
    { key: 'output', label: '结果' },
    { key: 'meta', label: '元信息' },
  ]

  return (
    <div className="chat-toollog-detail">
      <div className="chat-toollog-detail__tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`chat-toollog-detail__tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="chat-toollog-detail__body">
        {error != null ? (
          <div className="chat-toollog-detail__error">
            <span>详情加载失败：{error}</span>
            <button type="button" onClick={() => void loadDetail()}>
              重试
            </button>
          </div>
        ) : tab === 'meta' ? (
          <MetaView row={mergedRow} chain={chain} detail={detail} />
        ) : loading ? (
          <div className="chat-toollog__hint">载入中…</div>
        ) : tab === 'input' ? (
          <PayloadView
            key={`input:${detail?.input?.artifactId ?? 'inline'}`}
            label="参数"
            view={detail?.input}
            rowTruncated={mergedRow?.resultTruncated ?? false}
          />
        ) : (
          <PayloadView
            key={`output:${detail?.output?.artifactId ?? 'inline'}`}
            label="结果"
            view={detail?.output}
            rowTruncated={mergedRow?.resultTruncated ?? false}
          />
        )}
      </div>
    </div>
  )
}
