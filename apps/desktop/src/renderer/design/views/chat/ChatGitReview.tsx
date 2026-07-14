import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceGitFileChange, WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { getFileTypeBadge } from '../../components/FileDisplay'
import { SessionFileOpenPicker } from '../../components/SessionFileOpenPicker'
import { useIpcInvoke } from '../../hooks/useIpc'
import { FileChipIcon } from './ChatFileIcon'
import { clamp } from './ChatViewUtils'
import {
  GIT_REVIEW_TREE_DEFAULT_WIDTH,
  GIT_REVIEW_TREE_KEYBOARD_STEP,
  GIT_REVIEW_TREE_MAX_WIDTH,
  GIT_REVIEW_TREE_MIN_WIDTH,
  GIT_REVIEW_TREE_WIDTH_STORAGE_KEY,
  buildDefaultExpandedTreeDirs,
  buildGitReviewTree,
  formatGitStashDate,
  formatSignedNumber,
  getGitReviewFileOpenPath,
  getGitChangeStageLabel,
  getGitTreeStageClass,
  isGitReviewFileOpenable,
  matchesGitReviewStageFilter,
  parseGitDiffViewSegments,
  splitGitFilePath,
  type GitDiffViewLine,
  type GitReviewStageFilter,
  type GitReviewTreeNode,
} from './ChatGitUtils'
import './ChatGitReview.less'

function GitFileTypeBadge({ path }: { path: string }) {
  const badge = getFileTypeBadge(path)
  return (
    <span className={`git-review-file-badge type-${badge.tone}`} title={badge.label}>
      <FileChipIcon path={path} size={15} />
    </span>
  )
}

function GitReviewDiffLine({ line }: { line: GitDiffViewLine }) {
  if (line.type === 'meta') {
    return (
      <div className="git-review-diff-meta" title={line.text}>
        {line.text}
      </div>
    )
  }
  if (line.type === 'hunk') {
    return (
      <div className="diff-line hunk">
        <span className="ln" />
        <span className="code">{line.text}</span>
      </div>
    )
  }
  return (
    <div className={`diff-line ${line.type}`}>
      <span className="ln">{line.type === 'del' ? (line.oldLn ?? '') : (line.newLn ?? '')}</span>
      <span className="code">{line.text}</span>
    </div>
  )
}

function GitReviewFileDiff({
  workspaceId,
  change,
  refreshToken,
}: {
  workspaceId: string
  change: WorkspaceGitFileChange
  refreshToken: WorkspaceGitStatusResponse | null
}) {
  const { invoke: getFileDiff } = useIpcInvoke('workspace:git-file-diff')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [isBinary, setIsBinary] = useState(false)
  const [expandedGaps, setExpandedGaps] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setExpandedGaps({})
    getFileDiff({ workspaceId, path: change.path, untracked: change.untracked })
      .then((res) => {
        if (cancelled) return
        setDiff(res.diff)
        setIsBinary(res.isBinary)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载 diff 失败'
        if (message.includes('No handler registered')) {
          setError('主进程尚未加载 diff 接口，请完全退出并重启应用后重试。')
          return
        }
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [change.path, change.untracked, getFileDiff, refreshToken, workspaceId])

  const segments = useMemo(() => parseGitDiffViewSegments(diff), [diff])

  if (loading && !diff.trim()) {
    return (
      <div className="git-review-diff-state">
        <Icons.Spinner size={14} />
        <span>加载 diff…</span>
      </div>
    )
  }
  if (error != null) {
    return <div className="git-review-diff-state is-error">{error}</div>
  }
  if (isBinary) {
    return <div className="git-review-diff-state">二进制文件，无法在面板内预览 diff。</div>
  }
  if (!diff.trim()) {
    return <div className="git-review-diff-state">该文件没有可展示的 diff。</div>
  }

  return (
    <div className="git-review-diff">
      <div className="diff-body git-review-diff-body scroll">
        {segments.map((segment, index) => {
          if (segment.kind === 'line') {
            return <GitReviewDiffLine key={`line-${index}`} line={segment.line} />
          }
          if (expandedGaps[index]) {
            return (
              <Fragment key={`gap-${index}`}>
                {segment.lines.map((line, lineIndex) => (
                  <GitReviewDiffLine key={`gap-line-${index}-${lineIndex}`} line={line} />
                ))}
              </Fragment>
            )
          }
          return (
            <button
              key={`gap-${index}`}
              type="button"
              className="git-review-diff-gap"
              onClick={() => setExpandedGaps((prev) => ({ ...prev, [index]: true }))}
            >
              <Icons.ChevronDown size={12} />
              <span>{segment.count} 行未修改</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GitReviewTreePanel({
  changes,
  status,
  selectedPath,
  workspaceRootPath,
  onSelectPath,
  onRefresh,
}: {
  changes: WorkspaceGitFileChange[]
  status: WorkspaceGitStatusResponse | null
  selectedPath: string | null
  workspaceRootPath: string | null
  onSelectPath: (path: string) => void
  onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<GitReviewStageFilter>('all')
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true })
  const changesSignature = changes.map((change) => `${change.status}:${change.path}`).join('\n')

  useEffect(() => {
    setExpandedDirs(buildDefaultExpandedTreeDirs(changes))
  }, [changesSignature, changes])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredChanges = useMemo(
    () =>
      changes.filter(
        (change) =>
          matchesGitReviewStageFilter(change, filter) &&
          (normalizedQuery.length === 0 || change.path.toLowerCase().includes(normalizedQuery)),
      ),
    [changes, filter, normalizedQuery],
  )
  const tree = useMemo(() => buildGitReviewTree(filteredChanges), [filteredChanges])
  const stagedCount = changes.filter((change) => change.staged).length
  const unstagedCount = changes.filter((change) => change.unstaged || change.untracked).length
  const stashEntries = status?.stashEntries ?? []

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: prev[path] !== true }))
  }

  const filterOptions: Array<{ value: GitReviewStageFilter; label: string; count: number }> = [
    { value: 'all', label: '全部', count: changes.length },
    { value: 'staged', label: '已暂存', count: stagedCount },
    { value: 'unstaged', label: '未暂存', count: unstagedCount },
  ]

  return (
    <div className="git-review-tree-panel">
      <div className="git-review-tree-head">
        <div className="git-review-tree-title">
          <Icons.FolderOpen size={13} />
          <span>文件结构</span>
          <span className="git-review-tree-count">{filteredChanges.length}</span>
        </div>
        <button type="button" className="git-review-tree-refresh" onClick={() => void onRefresh()}>
          <Icons.RotateCw size={12} />
        </button>
      </div>
      <div className="git-review-tree-search">
        <Icons.Search size={12} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="过滤路径"
        />
      </div>
      <div className="git-review-tree-filters" aria-label="过滤变更状态">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? 'active' : ''}
            onClick={() => setFilter(option.value)}
          >
            <span>{option.label}</span>
            <span>{option.count}</span>
          </button>
        ))}
      </div>
      <div className="git-review-tree-body">
        {tree.children.map((node) => (
          <GitReviewTreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            workspaceRootPath={workspaceRootPath}
            onToggleDir={toggleDir}
            onSelectPath={onSelectPath}
          />
        ))}
        {filteredChanges.length === 0 && (
          <div className="git-review-tree-empty">没有匹配的变更。</div>
        )}
      </div>
      <div className="git-review-stash-section">
        <div className="git-review-stash-head">
          <span>
            <Icons.Archive size={12} />
            Stash
          </span>
          <span>{stashEntries.length}</span>
        </div>
        <div className="git-review-stash-list">
          {stashEntries.map((entry) => (
            <div className="git-review-stash-row" key={entry.selector}>
              <span className="git-review-stash-selector">{entry.selector}</span>
              <span className="git-review-stash-message truncate" title={entry.message}>
                {entry.message || '未命名 stash'}
              </span>
              <span className="git-review-stash-date">{formatGitStashDate(entry.date)}</span>
            </div>
          ))}
          {stashEntries.length === 0 && <div className="git-review-stash-empty">暂无 stash。</div>}
        </div>
      </div>
    </div>
  )
}

function GitReviewTreeNodeRow({
  node,
  depth,
  expandedDirs,
  selectedPath,
  workspaceRootPath,
  onToggleDir,
  onSelectPath,
}: {
  node: GitReviewTreeNode
  depth: number
  expandedDirs: Record<string, boolean>
  selectedPath: string | null
  workspaceRootPath: string | null
  onToggleDir: (path: string) => void
  onSelectPath: (path: string) => void
}) {
  const change = node.change
  const expanded = expandedDirs[node.path] === true
  const depthStyle = { '--tree-indent': `${depth * 14}px` } as React.CSSProperties

  if (change != null) {
    const selected = selectedPath === change.path
    return (
      <div className={`git-review-tree-row-wrap${selected ? ' selected' : ''}`}>
        <button
          type="button"
          className={`git-review-tree-row file${selected ? ' selected' : ''}`}
          style={depthStyle}
          title={change.path}
          onClick={() => onSelectPath(change.path)}
        >
          <span className="git-review-tree-file-icon">
            <FileChipIcon path={change.path} size={14} />
          </span>
          <span className={`git-review-tree-stage-dot ${getGitTreeStageClass(change)}`} />
          <span className="git-review-tree-name truncate">{node.name}</span>
          <span className="git-review-tree-stats">
            <span className="git-add">+{change.additions}</span>
            <span className="git-del">-{change.deletions}</span>
          </span>
        </button>
        {isGitReviewFileOpenable(change) && (
          <SessionFileOpenPicker
            filePath={getGitReviewFileOpenPath(workspaceRootPath, change.path)}
            className="git-review-tree-file-open"
            compact
          />
        )}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        className="git-review-tree-row dir"
        style={depthStyle}
        aria-expanded={expanded}
        title={node.path}
        onClick={() => onToggleDir(node.path)}
      >
        <Icons.ChevronRight size={12} className={expanded ? 'expanded' : ''} />
        {expanded ? <Icons.FolderOpen size={13} /> : <Icons.Folder size={13} />}
        <span className="git-review-tree-name truncate">{node.name}</span>
        <span className="git-review-tree-dir-count">{node.fileCount}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <GitReviewTreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            workspaceRootPath={workspaceRootPath}
            onToggleDir={onToggleDir}
            onSelectPath={onSelectPath}
          />
        ))}
    </>
  )
}

export function GitReviewPanel({
  workspaceId,
  workspaceRootPath,
  status,
  width,
  onWidthChange,
  onRefresh,
  onClose,
}: {
  workspaceId: string | null
  workspaceRootPath: string | null
  status: WorkspaceGitStatusResponse | null
  width: number
  onWidthChange: (width: number) => void
  onRefresh: () => Promise<void>
  onClose: () => void
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const changes = status?.files ?? []
  const pullRequestUrl = status?.pullRequestUrl
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [treePanelOpen, setTreePanelOpen] = useState(false)
  const [treePanelWidth, setTreePanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(GIT_REVIEW_TREE_WIDTH_STORAGE_KEY))
    if (
      Number.isFinite(saved) &&
      saved >= GIT_REVIEW_TREE_MIN_WIDTH &&
      saved <= GIT_REVIEW_TREE_MAX_WIDTH
    ) {
      return saved
    }
    return GIT_REVIEW_TREE_DEFAULT_WIDTH
  })

  useEffect(() => {
    localStorage.setItem(GIT_REVIEW_TREE_WIDTH_STORAGE_KEY, String(Math.round(treePanelWidth)))
  }, [treePanelWidth])

  const clampTreeWidth = useCallback(
    (value: number) => clamp(value, GIT_REVIEW_TREE_MIN_WIDTH, GIT_REVIEW_TREE_MAX_WIDTH),
    [],
  )

  const handleTreeResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = treePanelWidth
      document.body.classList.add('git-review-tree-resizing')
      const handlePointerMove = (moveEvent: PointerEvent) => {
        setTreePanelWidth(clampTreeWidth(startWidth + startX - moveEvent.clientX))
      }
      const handlePointerUp = () => {
        document.body.classList.remove('git-review-tree-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [treePanelWidth, clampTreeWidth],
  )

  const handleTreeResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setTreePanelWidth(clampTreeWidth(treePanelWidth + GIT_REVIEW_TREE_KEYBOARD_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setTreePanelWidth(clampTreeWidth(treePanelWidth - GIT_REVIEW_TREE_KEYBOARD_STEP))
      } else if (event.key === 'Home') {
        event.preventDefault()
        setTreePanelWidth(GIT_REVIEW_TREE_MIN_WIDTH)
      } else if (event.key === 'End') {
        event.preventDefault()
        setTreePanelWidth(GIT_REVIEW_TREE_MAX_WIDTH)
      }
    },
    [treePanelWidth, clampTreeWidth],
  )

  const currentBranch = status?.currentBranch ?? '当前分支'
  const compareTarget =
    status?.remoteName != null ? `${status.remoteName}/${status.remoteBranch ?? 'HEAD'}` : 'HEAD'

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('inspector-resizing')
  }
  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(clamp(dragRef.current.startWidth + delta, 380, 760))
  }
  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('inspector-resizing')
  }

  const toggleFile = (path: string) => {
    setExpandedPath((prev) => (prev === path ? null : path))
  }

  const toggleTreePanel = () => {
    const nextOpen = !treePanelOpen
    setTreePanelOpen(nextOpen)
    if (nextOpen && width < 640) onWidthChange(640)
  }

  return (
    <div
      className="inspector-frame git-review-frame"
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="inspector-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <aside className="inspector git-review-panel">
        <div className="git-review-toolbar">
          <div className="git-review-toolbar-main">
            <div className="git-review-kicker">Git Review</div>
            <h3>审查</h3>
          </div>
          <button type="button" className="icon-btn" title="刷新" onClick={() => void onRefresh()}>
            <Icons.RotateCw size={14} />
          </button>
          <button
            type="button"
            className={`icon-btn${treePanelOpen ? ' active' : ''}`}
            title={treePanelOpen ? '隐藏文件结构' : '显示文件结构'}
            aria-pressed={treePanelOpen}
            onClick={toggleTreePanel}
          >
            <Icons.PanelRight size={14} />
          </button>
          <button type="button" className="icon-btn" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>

        <div className="git-review-compare">
          <div className="git-review-compare-branches">
            <span className="git-review-branch-chip current" title={currentBranch}>
              <Icons.GitBranch size={12} />
              <span className="truncate">{currentBranch}</span>
            </span>
            <Icons.ChevronRight size={12} className="git-review-compare-arrow" />
            <span className="git-review-branch-chip target" title={compareTarget}>
              <span className="truncate">{compareTarget}</span>
            </span>
          </div>
          <div className="git-review-compare-stats">
            <span>{changes.length} 个文件</span>
            <span className="git-add">+{formatSignedNumber(status?.additions ?? 0)}</span>
            <span className="git-del">-{formatSignedNumber(status?.deletions ?? 0)}</span>
          </div>
        </div>

        {pullRequestUrl != null && (
          <button
            type="button"
            className="git-review-pr-btn"
            onClick={() =>
              void window.spark.invoke('browser:open-external', { url: pullRequestUrl })
            }
          >
            <Icons.ExternalLink size={13} />
            查看 Pull Request
          </button>
        )}

        <div
          className={`git-review-content${treePanelOpen ? ' has-tree' : ''}`}
          style={
            treePanelOpen
              ? ({ '--tree-width': `${treePanelWidth}px` } as React.CSSProperties)
              : undefined
          }
        >
          <div className="git-review-files">
            {changes.map((change) => {
              const { dir, base } = splitGitFilePath(change.path)
              const expanded = expandedPath === change.path
              return (
                <div
                  className={`git-review-file-card${expanded ? ' is-expanded' : ''}`}
                  key={`${change.status}:${change.path}`}
                >
                  <div className="git-review-file-row-wrap">
                    <button
                      type="button"
                      className="git-review-file-row"
                      aria-expanded={expanded}
                      onClick={() => toggleFile(change.path)}
                    >
                      <GitFileTypeBadge path={change.path} />
                      <span className="git-review-file-path-wrap min-w-0" title={change.path}>
                        {dir && <span className="git-review-file-dir truncate">{dir}</span>}
                        <span className="git-review-file-name truncate">{base}</span>
                      </span>
                      <span className="git-review-file-stage">{getGitChangeStageLabel(change)}</span>
                      <span className="git-review-file-stats">
                        <span className="git-add">+{change.additions}</span>
                        <span className="git-del">-{change.deletions}</span>
                      </span>
                      <span className={`git-review-file-chevron${expanded ? ' expanded' : ''}`}>
                        <Icons.ChevronDown size={14} />
                      </span>
                    </button>
                    {isGitReviewFileOpenable(change) && (
                      <SessionFileOpenPicker
                        filePath={getGitReviewFileOpenPath(workspaceRootPath, change.path)}
                        className="git-review-file-open"
                        compact
                      />
                    )}
                  </div>
                  {expanded && workspaceId != null && (
                    <GitReviewFileDiff
                      workspaceId={workspaceId}
                      change={change}
                      refreshToken={status}
                    />
                  )}
                </div>
              )
            })}
            {changes.length === 0 && (
              <div className="git-review-empty">暂无可审查的 Git 变更。</div>
            )}
          </div>
          {treePanelOpen && (
            <>
              <div
                className="git-review-tree-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖拽调整文件结构面板宽度"
                tabIndex={0}
                aria-valuemin={GIT_REVIEW_TREE_MIN_WIDTH}
                aria-valuemax={GIT_REVIEW_TREE_MAX_WIDTH}
                aria-valuenow={Math.round(treePanelWidth)}
                onPointerDown={handleTreeResizeStart}
                onKeyDown={handleTreeResizeKeyDown}
              />
              <GitReviewTreePanel
                changes={changes}
                status={status}
                selectedPath={expandedPath}
                workspaceRootPath={workspaceRootPath}
                onSelectPath={setExpandedPath}
                onRefresh={onRefresh}
              />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
