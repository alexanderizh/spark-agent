/**
 * ChatInteractions — 富会话内交互卡片集合
 *
 * 包含权限请求（文件/网络/MCP）、计划卡、Hunk 级 diff 审查、检查点、错误卡、
 * 子 Agent、工具选择器、上下文警告、沙箱提示等。
 */
import { useCallback, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Icons } from './Icons'
import { useToast } from './components/Toast'
import { useI18n } from './i18n'
import {
  FileTypeIcon,
  getFileTypeBadge,
  type FileTypeBadge,
  type PreviewFileType,
} from './components/FileDisplay'
import { SessionFileOpenPicker } from './components/SessionFileOpenPicker'
import { MarkdownText } from './views/ChatView'

const TURN_SUMMARY_VISIBLE_FILE_LIMIT = 10

export function FilePermCard({
  path,
  scope,
  lines,
  onAllow,
  onDeny,
}: {
  path: string
  scope: string
  lines: { add: number; del: number }
  onAllow?: () => void
  onDeny?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="chat-card">
      <div className="chat-card-h warn">
        <span className="ico">
          <Icons.Edit />
        </span>
        <span>{t('chat.filePerm.title')}</span>
        <span className="badge" style={{ marginLeft: 'auto', fontSize: 10 }}>
          {scope}
        </span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">{t('chat.common.path')}</span>
          <span className="v">
            <code>{path}</code>
          </span>
          <span className="k">{t('chat.filePerm.change')}</span>
          <span className="v">
            {t('chat.filePerm.changeStats', { add: lines.add, del: lines.del })}
          </span>
          <span className="k">{t('chat.filePerm.inWorkspace')}</span>
          <span className="v" style={{ color: 'var(--success)' }}>
            {t('chat.filePerm.inSparkProject')}
          </span>
          <span className="k">{t('chat.filePerm.backupPolicy')}</span>
          <span className="v">{t('chat.filePerm.backupSnapshot')}</span>
        </div>
      </div>
      <div className="chat-card-foot">
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {t('chat.filePerm.nextTime')}
        </span>
        <span className="seg-control" style={{ height: 22 }}>
          <button className="active" style={{ height: 18, fontSize: 10.5 }}>
            {t('chat.permission.ask')}
          </button>
          <button style={{ height: 18, fontSize: 10.5 }}>{t('chat.permission.session')}</button>
          <button style={{ height: 18, fontSize: 10.5 }}>{t('chat.permission.project')}</button>
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>
          {t('chat.common.deny')}
        </button>
        <button className="btn sm primary" onClick={onAllow}>
          <Icons.Check size={11} /> {t('chat.filePerm.allowWrite')}
        </button>
      </div>
    </div>
  )
}

export function NetPermCard({
  url,
  method,
  reason,
  onAllow,
  onDeny,
}: {
  url: string
  method: string
  reason: string
  onAllow?: () => void
  onDeny?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="chat-card">
      <div className="chat-card-h info">
        <span className="ico">
          <Icons.Globe />
        </span>
        <span>{t('chat.netPerm.title')}</span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">URL</span>
          <span className="v">
            <code>
              {method} {url}
            </code>
          </span>
          <span className="k">{t('chat.common.purpose')}</span>
          <span className="v">{reason}</span>
          <span className="k">{t('chat.common.domain')}</span>
          <span className="v">
            <span className="badge success dot" style={{ fontSize: 10 }}>
              {t('chat.netPerm.knownNpm')}
            </span>
          </span>
          <span className="k">{t('chat.common.credentials')}</span>
          <span className="v" style={{ color: 'var(--text-muted)' }}>
            {t('chat.netPerm.publicEndpoint')}
          </span>
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>
          {t('chat.common.deny')}
        </button>
        <button className="btn sm primary" onClick={onAllow}>
          <Icons.Check size={11} /> {t('chat.netPerm.allowNpmSession')}
        </button>
      </div>
    </div>
  )
}

export function MCPPermCard({
  server,
  tool,
  params,
  onAllow,
  onDeny,
}: {
  server: string
  tool: string
  params: unknown
  onAllow?: () => void
  onDeny?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="chat-card">
      <div className="chat-card-h">
        <span className="ico">
          <Icons.MCP />
        </span>
        <span>{t('chat.mcpPerm.title')}</span>
        <span
          className="mono-sm"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}
        >
          {server} · {tool}
        </span>
      </div>
      <div className="chat-card-body">
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          {t('chat.common.params')}
        </div>
        <pre
          className="mono-sm"
          style={{
            margin: 0,
            padding: '10px 12px',
            background: 'var(--code-bg)',
            borderRadius: 6,
            fontSize: 11.5,
            lineHeight: 1.5,
            overflow: 'auto',
            color: 'var(--code-fg)',
          }}
        >
          {JSON.stringify(params, null, 2)}
        </pre>
      </div>
      <div className="chat-card-foot">
        <span className="row" style={{ fontSize: 11, color: 'var(--text-muted)', gap: 6 }}>
          <Icons.Shield size={11} /> {t('chat.mcpPerm.sourceSigned')}
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>
          {t('chat.common.deny')}
        </button>
        <button className="btn sm" onClick={onAllow}>
          {t('chat.permission.once')}
        </button>
        <button className="btn sm primary" onClick={onAllow}>
          {t('chat.permission.allowRemember')}
        </button>
      </div>
    </div>
  )
}

type Hunk = {
  range: string
  note: string
  adds: number
  dels: number
  lines: { t: 'add' | 'del' | 'ctx' | 'hunk'; n: number | string; s: string }[]
}

export function HunkDiff({ path, hunks }: { path: string; hunks: Hunk[] }) {
  return (
    <div className="diff hunk-mode">
      <div className="diff-head">
        <Icons.File size={12} className="faint" />
        <span className="diff-path">{path}</span>
        <span className="diff-stats">
          <span className="add">+{hunks.reduce((s, h) => s + h.adds, 0)}</span>
          <span className="del">−{hunks.reduce((s, h) => s + h.dels, 0)}</span>
        </span>
      </div>
      {hunks.map((h, i) => (
        <div key={i} className="hunk-wrap">
          <div className="hunk-bar">
            <span className="label">@@ {h.range} @@</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.note}</span>
          </div>
          <div className="diff-body" style={{ maxHeight: 200, padding: '4px 0' }}>
            {h.lines.map((l, j) => (
              <div key={j} className={`diff-line ${l.t}`}>
                <span className="ln">{l.n || ''}</span>
                <span className="code">{l.s}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

type PlanItem = { status: 'done' | 'running' | 'pending'; text: string; meta?: string }

/**
 * 计划条目文本支持轻量 markdown 渲染：
 *   - `code`  → <code>
 *   - **bold** → <strong>
 *   - *italic* → <em>
 *   - [text](url) → <a>
 * 仅用于单行场景；多行/代码块由上层 MarkdownText 处理。
 */
function renderPlanInline(text: string): ReactNode[] {
  // 1) 先按 ` 切出 code 段，避免内部再次匹配
  const out: ReactNode[] = []
  const codeParts = text.split(/(`[^`]+`)/g)
  codeParts.forEach((part, ci) => {
    if (/^`[^`]+`$/.test(part)) {
      out.push(
        <code key={`c${ci}`} className="plan-inline-code">
          {part.slice(1, -1)}
        </code>,
      )
      return
    }
    // 2) 再按链接切
    const linkParts = part.split(/(\[[^\]]+\]\([^)]+\))/g)
    linkParts.forEach((sub, li) => {
      const linkMatch = sub.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        out.push(
          <a key={`c${ci}l${li}`} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>,
        )
        return
      }
      // 3) 粗体 / 斜体
      const segs = sub.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
      segs.forEach((seg, si) => {
        if (/^\*\*[^*]+\*\*$/.test(seg)) {
          out.push(<strong key={`c${ci}l${li}b${si}`}>{seg.slice(2, -2)}</strong>)
        } else if (/^\*[^*]+\*$/.test(seg)) {
          out.push(<em key={`c${ci}l${li}i${si}`}>{seg.slice(1, -1)}</em>)
        } else if (seg.length > 0) {
          out.push(<span key={`c${ci}l${li}t${si}`}>{seg}</span>)
        }
      })
    })
  })
  return out
}

export function PlanCard({ title, items }: { title: string; items: PlanItem[] }) {
  const { t } = useI18n()
  const done = items.filter((it) => it.status === 'done').length
  return (
    <div className="plan-card">
      <div className="plan-h">
        <Icons.Beaker size={13} />
        <span>{title}</span>
        <span className="progress">{t('chat.plan.completed', { done, total: items.length })}</span>
      </div>
      <div className="plan-list">
        {items.map((it, i) => (
          <div key={i} className={`plan-item ${it.status}`}>
            <span className="check">{it.status === 'done' && <Icons.Check />}</span>
            <span className="text">{renderPlanInline(it.text)}</span>
            {it.meta && <span className="meta">{it.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export { renderPlanInline }

export function Checkpoint({
  checkpointId,
  onRestore,
}: {
  checkpointId: string
  onRestore?: () => void
}) {
  const displayId =
    checkpointId.length > 10 ? checkpointId.slice(-8) : checkpointId
  return (
    <div className="checkpoint">
      <span className="line" />
      <span className="pill">
        <Icons.Branch size={11} />
        <span>Checkpoint</span>
        <span className="num">#{displayId}</span>
        <span className="actions">
          <button
            type="button"
            className="icon-btn"
            title="应用此 checkpoint"
            onClick={onRestore}
            disabled={onRestore == null}
          >
            <Icons.RotateCcw size={14} style={{fontSize: 14}} className="checkpoint-action-icon checkpoint-action-icon-restore" />
          </button>
        </span>
      </span>
      <span className="line" />
    </div>
  )
}

export interface FileChangeSummaryItem {
  path: string
  changeType: 'create' | 'modify' | 'delete'
  adds: number
  dels: number
}

export function getTurnSummaryFileType(filePath: string): FileTypeBadge {
  return getFileTypeBadge(filePath)
}

export function TurnFileSummaryCard({
  files,
  totalAdds,
  totalDels,
  onUndo,
  onReapply,
  onFilePreview,
}: {
  files: FileChangeSummaryItem[]
  totalAdds: number
  totalDels: number
  onUndo?: () => Promise<void> | void
  onReapply?: () => Promise<void> | void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)
  const [showAllFiles, setShowAllFiles] = useState(false)
  const [undoState, setUndoState] = useState<'idle' | 'undoing' | 'undone' | 'reapplying'>('idle')
  const { toast } = useToast()
  const fileCount = files.length
  const hiddenFileCount = Math.max(0, fileCount - TURN_SUMMARY_VISIBLE_FILE_LIMIT)
  const hasHiddenFiles = hiddenFileCount > 0
  const visibleFiles =
    hasHiddenFiles && !showAllFiles ? files.slice(0, TURN_SUMMARY_VISIBLE_FILE_LIMIT) : files

  const handleUndo = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (onUndo == null || undoState !== 'idle') return
      setUndoState('undoing')
      try {
        await onUndo()
        setUndoState('undone')
        toast.success(t('chat.summary.undoSuccess'))
      } catch (err) {
        setUndoState('idle')
        toast.error(err instanceof Error ? err.message : t('chat.summary.undoFailed'))
      }
    },
    [onUndo, t, toast, undoState],
  )

  const handleReapply = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (onReapply == null || undoState !== 'undone') return
      setUndoState('reapplying')
      try {
        await onReapply()
        setUndoState('idle')
        toast.success(t('chat.summary.reapplySuccess'))
      } catch (err) {
        setUndoState('undone')
        toast.error(err instanceof Error ? err.message : t('chat.summary.reapplyFailed'))
      }
    },
    [onReapply, t, toast, undoState],
  )

  return (
    <div className="chat-card turn-summary-card">
      <div
        className="chat-card-h success"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <span className="ico">
          <Icons.CheckCircle />
        </span>
        <span>{t('chat.summary.done')}</span>
        <span className="diff-stats">
          <span className="add">+{totalAdds}</span>
          <span className="del">−{totalDels}</span>
        </span>
        <span className="badge" style={{ fontSize: 10, marginLeft: 8 }}>
          {t('chat.summary.fileCount', { count: fileCount })}
        </span>
        <span className="spacer" />
        {onUndo != null && undoState !== 'undone' && undoState !== 'reapplying' && (
          <button
            type="button"
            className="btn ghost sm"
            style={{ height: 22, padding: '0 8px', fontSize: 11, gap: 4 }}
            onClick={handleUndo}
            disabled={undoState === 'undoing'}
            title={t('chat.summary.undoTitle')}
          >
            <Icons.RotateCcw size={11} />{' '}
            {undoState === 'undoing' ? t('chat.summary.undoing') : t('chat.summary.undo')}
          </button>
        )}
        {onReapply != null && (undoState === 'undone' || undoState === 'reapplying') && (
          <button
            type="button"
            className="btn ghost sm"
            style={{ height: 22, padding: '0 8px', fontSize: 11, gap: 4 }}
            onClick={handleReapply}
            disabled={undoState === 'reapplying'}
            title={t('chat.summary.reapplyTitle')}
          >
            <Icons.RotateCw size={11} />{' '}
            {undoState === 'reapplying' ? t('chat.summary.reapplying') : t('chat.summary.reapply')}
          </button>
        )}
        <button className="btn ghost sm" style={{ height: 20, padding: '0 6px' }}>
          {expanded ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="chat-card-body">
          <div className="turn-summary-files">
            {visibleFiles.map((file, i) => {
              const canOpen = file.changeType !== 'delete'
              const fileType = getTurnSummaryFileType(file.path)
              return (
                <div key={i} className="turn-summary-file-row">
                  <span className={`file-type-badge type-${fileType.tone}`} title={fileType.label}>
                    <FileTypeIcon filePath={file.path} size={16} />
                  </span>
                  <code className="file-path" title={file.path}>
                    {file.path}
                  </code>
                  <span className="file-stats">
                    <span className="add">+{file.adds}</span>
                    <span className="del">−{file.dels}</span>
                  </span>
                  <span className="file-actions">
                    {canOpen && (
                      <SessionFileOpenPicker
                        filePath={file.path}
                        compact
                        {...(onFilePreview != null ? { onPreview: onFilePreview } : {})}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          {hasHiddenFiles && (
            <div className="turn-summary-more">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setShowAllFiles((prev) => !prev)}
              >
                {showAllFiles
                  ? t('chat.summary.showLessFiles')
                  : t('chat.summary.showMoreFiles', { count: hiddenFileCount })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function QuickActions({ actions }: { actions: { icon: ReactNode; label: string }[] }) {
  return (
    <div className="quick-actions">
      {actions.map((a, i) => (
        <button key={i} className="chip">
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  )
}

export function ErrorCard({
  message,
  detail,
  suggestions,
}: {
  message: string
  detail?: string
  suggestions?: string[]
}) {
  const { t } = useI18n()
  return (
    <div className="error-card">
      <div className="e-h">
        <Icons.XCircle size={14} /> {message}
      </div>
      {detail && <pre>{detail}</pre>}
      {suggestions && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            {t('chat.error.suggestions')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text)' }}>
            {suggestions.map((s, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="e-actions">
        <button className="btn sm">
          <Icons.Refresh size={11} /> {t('chat.error.retry')}
        </button>
        <button className="btn sm">
          <Icons.Edit size={11} /> {t('chat.error.editPrompt')}
        </button>
        <button className="btn sm">{t('chat.error.skipStep')}</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm">
          <Icons.Copy size={11} /> {t('chat.error.copyLog')}
        </button>
      </div>
    </div>
  )
}

const GENERIC_SUBAGENT_NAMES = new Set([
  'agent',
  'subagent',
  'general-purpose',
  'general purpose',
  'general_purpose',
])

function normalizeSubagentText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isGenericSubagentName(value: string): boolean {
  const normalized = normalizeSubagentText(value).toLowerCase()
  return normalized.length === 0 || GENERIC_SUBAGENT_NAMES.has(normalized)
}

function clipSubagentLabel(value: string, maxLength = 42): string {
  const normalized = normalizeSubagentText(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function firstTaskLine(task: string): string {
  const line =
    task
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? ''
  return line
    .replace(/^[-*#>\s]+/, '')
    .replace(/^任务[：:]\s*/, '')
    .trim()
}

function resolveSubagentInstanceTitle(name: string, role: string, task: string): string {
  const roleLabel = normalizeSubagentText(role)
  if (roleLabel.length > 0 && !isGenericSubagentName(roleLabel)) {
    return clipSubagentLabel(roleLabel)
  }

  const taskLabel = firstTaskLine(task)
  if (taskLabel.length > 0) return clipSubagentLabel(taskLabel)

  const nameLabel = normalizeSubagentText(name)
  if (!isGenericSubagentName(nameLabel)) return clipSubagentLabel(nameLabel)

  return ''
}

function isAsyncSubagentLaunchMetadata(output: string): boolean {
  return (
    output.includes('Async agent launched successfully') &&
    output.includes('agentId:') &&
    output.includes('output_file:')
  )
}

export function SubagentCard({
  name,
  role,
  task,
  status,
  tokens,
  output,
  progressSummary,
  lastToolName,
  toolUses,
  durationMs,
  transcript,
  onClick,
}: {
  name: string
  role: string
  task: string
  status: 'running' | 'done' | 'error' | 'stopped' | 'paused'
  tokens: string
  output?: string | undefined
  progressSummary?: string | undefined
  lastToolName?: string | undefined
  toolUses?: number | undefined
  durationMs?: number | undefined
  transcript?: Array<{
    kind: 'text' | 'thinking'
    content: string
    segmentId: string
  }> | undefined
  onClick?: (() => void) | undefined
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const taskText = task.trim()
  const rawRoleText = normalizeSubagentText(role)
  const roleText = rawRoleText.length > 0 && !isGenericSubagentName(rawRoleText) ? rawRoleText : ''
  const instanceTitle = resolveSubagentInstanceTitle(name, role, task)
  const cardTitle =
    instanceTitle.length > 0
      ? t('chat.subagent.derived', { name: instanceTitle })
      : t('chat.subagent.defaultName')
  const taskPreview = taskText.length > 0 ? clipSubagentLabel(firstTaskLine(taskText), 86) : ''
  const progressText = progressSummary?.trim() ?? ''
  const activityText = [progressText, lastToolName]
    .filter((item, index, items) => item != null && item.length > 0 && items.indexOf(item) === index)
    .join(' · ')
  const metaText = [activityText, roleText, taskPreview]
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index)
    .join(' · ')
  const outputText = output?.trim() ?? ''
  const hasInternalOutput = outputText.length > 0 && isAsyncSubagentLaunchMetadata(outputText)
  const displayOutput = hasInternalOutput ? '' : outputText
  const hasDisplayOutput = displayOutput.length > 0
  const transcriptEntries = transcript?.filter((entry) => entry.content.trim().length > 0) ?? []
  const hasTranscript = transcriptEntries.length > 0
  const isExpandable =
    taskText.length > 0 || hasDisplayOutput || hasInternalOutput || progressText.length > 0 || hasTranscript
  const statusLabel =
    status === 'done'
      ? t('chat.subagent.done')
      : status === 'error'
        ? t('chat.subagent.failed')
        : status === 'stopped'
          ? t('chat.subagent.stopped')
          : status === 'paused'
            ? t('chat.subagent.paused')
            : t('chat.subagent.running')
  const activityStats = [
    toolUses != null ? t('chat.subagent.toolUses', { count: toolUses }) : '',
    durationMs != null ? t('chat.subagent.duration', { seconds: Math.max(1, Math.round(durationMs / 1000)) }) : '',
  ].filter(Boolean).join(' · ')

  const toggleExpanded = () => {
    if (isExpandable) {
      setExpanded((value) => !value)
      onClick?.()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isExpandable) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleExpanded()
    }
  }

  return (
    <div
      className={`subagent-card${isExpandable ? ' clickable' : ''}${expanded ? ' expanded' : ''}`}
    >
      <div
        className="subagent-card-header"
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        role={isExpandable ? 'button' : undefined}
        tabIndex={isExpandable ? 0 : undefined}
        aria-expanded={isExpandable ? expanded : undefined}
      >
        <span className="ico">
          <Icons.Bot size={14} />
        </span>
        <div className="body">
          <div className="title">
            <span className="title-text">{cardTitle}</span>
            {isExpandable && (
              <span className="expand-hint">
                {expanded ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}
              </span>
            )}
          </div>
          <div className="meta" title={metaText || taskText || undefined}>
            {metaText || t('chat.subagent.expandHint')}
          </div>
        </div>
        {(status === 'running' || status === 'paused') && (
          <span className="live">
            <Icons.Spinner size={11} />
            {statusLabel}
          </span>
        )}
        {(status === 'done' || status === 'error' || status === 'stopped') && (
          <span
            className="live"
            style={{ color: status === 'done' ? 'var(--success)' : 'var(--warning)' }}
          >
            {status === 'done' ? <Icons.Check size={11} /> : <Icons.AlertTriangle size={11} />}
            {statusLabel}
            {tokens ? ` · ${t('chat.subagent.tokenUsage', { tokens })}` : ''}
          </span>
        )}
      </div>
      {expanded && (
        <div className="subagent-output">
          {taskText.length > 0 && (
            <section className="subagent-detail-section">
              <div className="subagent-detail-label">{t('chat.subagent.taskLabel')}</div>
              <div className="subagent-task-full">{taskText}</div>
            </section>
          )}
          {progressText.length > 0 && (
            <section className="subagent-detail-section">
              <div className="subagent-detail-label">{t('chat.subagent.progressLabel')}</div>
              <div className="subagent-task-full">{progressText}</div>
              {activityStats.length > 0 && <div className="subagent-status-note">{activityStats}</div>}
            </section>
          )}
          {hasTranscript && (
            <section className="subagent-detail-section">
              <div className="subagent-detail-label">{t('chat.subagent.transcriptLabel')}</div>
              {transcriptEntries.map((entry) => (
                <div
                  key={`${entry.kind}:${entry.segmentId}`}
                  className={`subagent-transcript-entry ${entry.kind}`}
                >
                  <div className="subagent-transcript-kind">
                    {entry.kind === 'thinking'
                      ? t('chat.subagent.thinkingLabel')
                      : t('chat.subagent.messageLabel')}
                  </div>
                  <div className="subagent-output-content md-surface">
                    <MarkdownText content={entry.content} />
                  </div>
                </div>
              ))}
            </section>
          )}
          {hasDisplayOutput && (
            <section className="subagent-detail-section">
              <div className="subagent-detail-label">{t('chat.subagent.resultLabel')}</div>
              <div className="subagent-output-content md-surface">
                <MarkdownText content={displayOutput} />
              </div>
            </section>
          )}
          {!hasDisplayOutput && hasInternalOutput && (
            <div className="subagent-status-note">{t('chat.subagent.internalOutputHidden')}</div>
          )}
          {!hasDisplayOutput && !hasInternalOutput && !hasTranscript && status === 'running' && (
            <div className="subagent-status-note">{t('chat.subagent.waitingForResult')}</div>
          )}
        </div>
      )}
    </div>
  )
}

type ChoiceOption = { id: string; icon: ReactNode; name: string; hint: string }
export function ToolChooser({ title, options }: { title: string; options: ChoiceOption[] }) {
  const { t } = useI18n()
  const [sel, setSel] = useState(options[0]?.id)
  return (
    <div className="chat-card">
      <div className="chat-card-h">
        <span className="ico">
          <Icons.Wrench />
        </span>
        <span>{title}</span>
      </div>
      <div className="chat-card-body" style={{ padding: 0 }}>
        <div className="tool-choose">
          {options.map((o) => (
            <div
              key={o.id}
              className={`choice ${sel === o.id ? 'selected' : ''}`}
              onClick={() => setSel(o.id)}
            >
              <span className="ico">{o.icon}</span>
              <div className="body">
                <div className="name">{o.name}</div>
                <div className="hint">{o.hint}</div>
              </div>
              <span className="radio" />
            </div>
          ))}
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="muted" style={{ fontSize: 11 }}>
          {t('chat.toolChooser.agentChoice')}{' '}
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>
            {options.find((o) => o.id === sel)?.name}
          </strong>
        </span>
        <span className="spacer" />
        <button className="btn sm">{t('chat.toolChooser.cancel')}</button>
        <button className="btn sm primary">{t('chat.toolChooser.useTool')}</button>
      </div>
    </div>
  )
}

export function ContextWarn({ used, total }: { used: number; total: number }) {
  const { t } = useI18n()
  const pct = Math.round((used / total) * 100)
  return (
    <div className="context-warn">
      <span className="ico">
        <Icons.AlertTriangle size={16} />
      </span>
      <div className="body">
        <div className="title">{t('chat.context.title', { percent: pct })}</div>
        <div className="meta">
          {t('chat.context.meta', { used: used.toLocaleString(), total: total.toLocaleString() })}
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm">{t('chat.context.compress')}</button>
        <button className="btn sm primary">{t('chat.context.autoSummary')}</button>
      </div>
    </div>
  )
}

export function SandboxNote({ children }: { children: ReactNode }) {
  return (
    <div className="sys-note">
      <Icons.Shield />
      <span>{children}</span>
    </div>
  )
}
