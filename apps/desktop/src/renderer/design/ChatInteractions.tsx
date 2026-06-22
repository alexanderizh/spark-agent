/**
 * ChatInteractions — 富会话内交互卡片集合
 *
 * 包含权限请求（文件/网络/MCP）、计划卡、Hunk 级 diff 审查、检查点、错误卡、
 * 子 Agent、工具选择器、上下文警告、沙箱提示等。
 */
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from './Icons'
import { useIpcInvoke } from './hooks/useIpc'
import { useToast } from './components/Toast'
import { useI18n } from './i18n'

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
  num,
  time,
  label,
  files,
  onRestore,
}: {
  num: number
  time: string
  label?: string
  files?: string[]
  onRestore?: () => void
}) {
  const { t } = useI18n()
  const visibleFiles = files?.slice(0, 4) ?? []
  const remaining = Math.max(0, (files?.length ?? 0) - visibleFiles.length)
  return (
    <div className="checkpoint">
      <span className="line" />
      <span className="pill">
        <Icons.Branch size={11} />
        <span>{label || t('chat.checkpoint.default')}</span>
        <span className="num">
          #{num} · {time}
        </span>
        {visibleFiles.length > 0 && (
          <span className="checkpoint-files" title={files?.join('\n')}>
            {visibleFiles.map((file) => (
              <span className="checkpoint-file" key={file}>
                {file}
              </span>
            ))}
            {remaining > 0 && <span className="checkpoint-file">+{remaining}</span>}
          </span>
        )}
        <span className="actions">
          <button
            type="button"
            className="icon-btn"
            title="Restore checkpoint"
            onClick={onRestore}
            disabled={onRestore == null}
          >
            <Icons.Refresh />
          </button>
          <span className="icon-btn" title={t('chat.checkpoint.branchFromHere')}>
            <Icons.Branch />
          </span>
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

type FileTypeTone =
  | 'code'
  | 'style'
  | 'script'
  | 'json'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'config'
  | 'default'

type FileTypeBadge = {
  label: string
  tone: FileTypeTone
}

const FILE_TYPE_BY_EXTENSION: Record<string, FileTypeBadge> = {
  ts: { label: 'TS', tone: 'code' },
  tsx: { label: 'TSX', tone: 'code' },
  js: { label: 'JS', tone: 'script' },
  jsx: { label: 'JSX', tone: 'script' },
  mjs: { label: 'MJS', tone: 'script' },
  cjs: { label: 'CJS', tone: 'script' },
  css: { label: 'CSS', tone: 'style' },
  less: { label: 'LESS', tone: 'style' },
  scss: { label: 'SCSS', tone: 'style' },
  sass: { label: 'SASS', tone: 'style' },
  html: { label: 'HTML', tone: 'script' },
  vue: { label: 'VUE', tone: 'style' },
  svelte: { label: 'SVLT', tone: 'style' },
  json: { label: 'JSON', tone: 'json' },
  jsonl: { label: 'JSONL', tone: 'json' },
  yaml: { label: 'YAML', tone: 'json' },
  yml: { label: 'YML', tone: 'json' },
  toml: { label: 'TOML', tone: 'config' },
  xml: { label: 'XML', tone: 'json' },
  md: { label: 'MD', tone: 'doc' },
  mdx: { label: 'MDX', tone: 'doc' },
  txt: { label: 'TXT', tone: 'doc' },
  doc: { label: 'DOC', tone: 'doc' },
  docx: { label: 'DOCX', tone: 'doc' },
  rtf: { label: 'RTF', tone: 'doc' },
  xls: { label: 'XLS', tone: 'sheet' },
  xlsx: { label: 'XLSX', tone: 'sheet' },
  csv: { label: 'CSV', tone: 'sheet' },
  numbers: { label: 'NUM', tone: 'sheet' },
  ppt: { label: 'PPT', tone: 'slides' },
  pptx: { label: 'PPTX', tone: 'slides' },
  key: { label: 'KEY', tone: 'slides' },
  pdf: { label: 'PDF', tone: 'pdf' },
  png: { label: 'PNG', tone: 'image' },
  jpg: { label: 'JPG', tone: 'image' },
  jpeg: { label: 'JPEG', tone: 'image' },
  gif: { label: 'GIF', tone: 'image' },
  webp: { label: 'WEBP', tone: 'image' },
  svg: { label: 'SVG', tone: 'image' },
  mp4: { label: 'MP4', tone: 'video' },
  mov: { label: 'MOV', tone: 'video' },
  avi: { label: 'AVI', tone: 'video' },
  webm: { label: 'WEBM', tone: 'video' },
  mp3: { label: 'MP3', tone: 'audio' },
  wav: { label: 'WAV', tone: 'audio' },
  flac: { label: 'FLAC', tone: 'audio' },
  zip: { label: 'ZIP', tone: 'archive' },
  rar: { label: 'RAR', tone: 'archive' },
  '7z': { label: '7Z', tone: 'archive' },
  tar: { label: 'TAR', tone: 'archive' },
  gz: { label: 'GZ', tone: 'archive' },
  lock: { label: 'LOCK', tone: 'config' },
  env: { label: 'ENV', tone: 'config' },
}

const FILE_TYPE_BY_NAME: Record<string, FileTypeBadge> = {
  dockerfile: { label: 'DOCK', tone: 'config' },
  makefile: { label: 'MAKE', tone: 'config' },
  license: { label: 'LIC', tone: 'doc' },
}

function getTurnSummaryFileType(filePath: string): FileTypeBadge {
  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const exact = FILE_TYPE_BY_NAME[fileName]
  if (exact != null) return exact
  if (fileName.endsWith('.d.ts')) return { label: 'D.TS', tone: 'code' }

  const ext = fileName.includes('.') ? fileName.split('.').pop() : undefined
  if (ext == null || ext.length === 0) return { label: 'FILE', tone: 'default' }

  return FILE_TYPE_BY_EXTENSION[ext] ?? { label: ext.slice(0, 4).toUpperCase(), tone: 'default' }
}

export function TurnFileSummaryCard({
  files,
  totalAdds,
  totalDels,
  onUndo,
  onReapply,
}: {
  files: FileChangeSummaryItem[]
  totalAdds: number
  totalDels: number
  onUndo?: () => Promise<void> | void
  onReapply?: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)
  const [undoState, setUndoState] = useState<'idle' | 'undoing' | 'undone' | 'reapplying'>('idle')
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { toast } = useToast()
  const fileCount = files.length

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
    [onUndo, toast, undoState],
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
    [onReapply, toast, undoState],
  )

  const handleOpen = useCallback(
    async (e: React.MouseEvent, filePath: string) => {
      // 阻止冒泡，避免触发展开/折叠
      e.stopPropagation()
      try {
        const res = await openFile({ filePath })
        if (!res.opened) {
          toast.error(res.error ?? t('chat.summary.openFailed'))
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('chat.summary.openFileFailed'))
      }
    },
    [openFile, toast],
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
            {files.map((file, i) => {
              const canOpen = file.changeType !== 'delete'
              const fileType = getTurnSummaryFileType(file.path)
              return (
                <div key={i} className="turn-summary-file-row">
                  <span
                    className={`file-type-badge type-${fileType.tone}`}
                    title={`${fileType.label} file`}
                  >
                    {fileType.label}
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
                      <button
                        type="button"
                        className="icon-btn file-action-btn"
                        title={t('chat.summary.openDefault')}
                        onClick={(e) => handleOpen(e, file.path)}
                      >
                        <Icons.ExternalLink size={11} />
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
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

export function SubagentCard({
  name,
  role,
  task,
  status,
  tokens,
  output,
  onClick,
}: {
  name: string
  role: string
  task: string
  status: 'running' | 'done'
  tokens: string
  output?: string | undefined
  onClick?: (() => void) | undefined
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const hasOutput = output != null && output.length > 0
  const isClickable = status === 'done' && hasOutput

  const handleClick = () => {
    if (isClickable) {
      setExpanded(!expanded)
      onClick?.()
    }
  }

  return (
    <div
      className={`subagent-card${isClickable ? ' clickable' : ''}${expanded ? ' expanded' : ''}`}
      onClick={handleClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="subagent-card-header">
        <span className="ico">
          <Icons.Bot size={14} />
        </span>
        <div className="body">
          <div className="title">
            {t('chat.subagent.derived', { name })}
            {isClickable && (
              <span className="expand-hint">
                {expanded ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}
              </span>
            )}
          </div>
          <div className="meta">
            {role || task ? `${role}${role && task ? ' · ' : ''}${task}` : ''}
          </div>
        </div>
        {status === 'running' && (
          <span className="live">
            <Icons.Spinner size={11} />
            {t('chat.subagent.running')}
            {tokens ? ` ` : ''}
          </span>
        )}
        {status === 'done' && (
          <span className="live" style={{ color: 'var(--success)' }}>
            <Icons.Check size={11} />
            {t('chat.subagent.done')}
            {tokens ? ` ` : ''}
          </span>
        )}
      </div>
      {expanded && hasOutput && (
        <div className="subagent-output">
          <pre className="subagent-output-content">{output}</pre>
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
