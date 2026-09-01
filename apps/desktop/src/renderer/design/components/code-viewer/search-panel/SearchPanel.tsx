/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual is intentional here; result counts require DOM virtualization. */
/**
 * SearchPanel — 代码侧栏「工作区搜索」面板（与文件树 / Git 面板互斥共用左侧栏槽位）。
 *
 * 双模式：
 *   - files：全工作区文件名模糊搜索（quick open），结果按目录树展示，↑↓ + Enter 键盘流
 *   - content：跨文件代码内容搜索，结果按「目录 → 文件 → 命中行」展示，
 *     目录与文件均可折叠，点击命中打开文件并定位到行
 *
 * 性能：结果用 @tanstack/react-virtual 虚拟滚动；content 模式分批到达增量渲染；
 * DOM 数量与结果规模解耦（上限由主进程 2000 匹配兜底）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  SessionId,
  WorkspaceSearchContentMatch,
  WorkspaceSearchFileHit,
} from '@spark/protocol'
import { Icons } from '../../../Icons'
import { FileTypeIcon } from '../../FileDisplay'
import { OPEN_CODE_SEARCH_EVENT } from '../../../hooks/useKeyboard'
import { closeSearchPanel, setSearchPanelMode, useSearchPanelMode } from './searchPanelVisibility'
import {
  buildSearchResultTree,
  flattenSearchResultTree,
  getSearchResultTreeNodeKey,
  type SearchResultTreeRow,
} from './searchResultTree'
import { useWorkspaceSearch } from './useWorkspaceSearch'
import {
  readSearchPanelWorkspaceState,
  writeSearchPanelWorkspaceState,
  type SearchPanelWorkspaceState,
  type SearchResultLayout,
} from './searchPanelWorkspaceState'
import './SearchPanel.less'

export interface SearchPanelProps {
  workspaceId: string | null
  sessionId?: SessionId | null
  onOpenFile: (relativePath: string, lineNumber?: number) => void
}

export function SearchPanel({
  workspaceId,
  sessionId = null,
  onOpenFile,
}: SearchPanelProps): React.ReactNode {
  const mode = useSearchPanelMode()
  const workspaceScopeId =
    workspaceId == null ? null : `${workspaceId}${sessionId == null ? '' : `:${sessionId}`}`
  const [workspaceState, setWorkspaceState] = useState<SearchPanelWorkspaceState>(() =>
    readSearchPanelWorkspaceState(workspaceScopeId),
  )
  const [refreshTick, setRefreshTick] = useState(0)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [selectedIdx, setSelectedIdx] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const query = workspaceState.queries[mode]
  const { caseSensitive, resultLayout } = workspaceState

  const updateWorkspaceState = useCallback(
    (updater: (prev: SearchPanelWorkspaceState) => SearchPanelWorkspaceState): void => {
      setWorkspaceState(updater)
    },
    [],
  )
  const setQuery = useCallback(
    (nextQuery: string): void => {
      updateWorkspaceState((prev) => ({
        ...prev,
        queries: { ...prev.queries, [mode]: nextQuery },
      }))
    },
    [mode, updateWorkspaceState],
  )
  const setResultLayout = useCallback(
    (nextLayout: SearchResultLayout): void => {
      updateWorkspaceState((prev) => ({ ...prev, resultLayout: nextLayout }))
    },
    [updateWorkspaceState],
  )

  useEffect(() => {
    writeSearchPanelWorkspaceState(workspaceScopeId, workspaceState)
  }, [workspaceScopeId, workspaceState])

  const search = useWorkspaceSearch({
    workspaceId,
    sessionId,
    mode,
    query,
    caseSensitive,
    refreshToken: refreshTick,
  })

  // 面板挂载 + 外部打开事件（快捷键）时聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])
  useEffect(() => {
    const onOpen = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(OPEN_CODE_SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CODE_SEARCH_EVENT, onOpen)
  }, [])

  // 查询变化重置键盘选中与树节点折叠
  useEffect(() => {
    setSelectedIdx(0)
  }, [query, mode])
  useEffect(() => {
    setCollapsedNodes(new Set())
  }, [query, mode])

  // ── files 模式：结果树 → 当前可见虚拟行 ──────────────────────────────
  const fileTree = useMemo(
    () => buildSearchResultTree(search.fileHits.map((hit, rank) => ({ path: hit.path, rank }))),
    [search.fileHits],
  )
  const fileRows = useMemo(
    () => flattenSearchResultTree(fileTree, collapsedNodes, false),
    [fileTree, collapsedNodes],
  )
  const visibleFileRows = useMemo(
    () =>
      fileRows.filter(
        (row): row is Extract<SearchResultTreeRow, { kind: 'file' }> => row.kind === 'file',
      ),
    [fileRows],
  )
  const visibleFileIndexByPath = useMemo(
    () => new Map(visibleFileRows.map((row, index) => [row.node.path, index])),
    [visibleFileRows],
  )
  const fileRowIndexByPath = useMemo(() => {
    const index = new Map<string, number>()
    fileRows.forEach((row, rowIndex) => {
      if (row.kind === 'file') index.set(row.node.path, rowIndex)
    })
    return index
  }, [fileRows])
  const fileTreeVirtualizer = useVirtualizer({
    count: fileRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
    getItemKey: (i) => fileRows[i]?.key ?? i,
  })
  const fileListVirtualizer = useVirtualizer({
    count: search.fileHits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 12,
    getItemKey: (i) => search.fileHits[i]?.path ?? i,
  })

  // ── content 模式：按文件聚合 → 目录树 → 当前可见虚拟行 ───────────────
  const contentTree = useMemo(() => {
    if (mode !== 'content') return []
    const groups = new Map<string, WorkspaceSearchContentMatch[]>()
    for (const m of search.contentMatches) {
      const list = groups.get(m.path)
      if (list != null) list.push(m)
      else groups.set(m.path, [m])
    }
    return buildSearchResultTree(
      [...groups.entries()].map(([path, matches], rank) => ({ path, rank, matches })),
    )
  }, [mode, search.contentMatches])
  const contentRows = useMemo(
    () => flattenSearchResultTree(contentTree, collapsedNodes, true),
    [contentTree, collapsedNodes],
  )

  const contentVirtualizer = useVirtualizer({
    count: contentRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
    getItemKey: (i) => {
      const row = contentRows[i]
      if (row == null) return i
      return row.key
    },
  })
  const contentListVirtualizer = useVirtualizer({
    count: search.contentMatches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
    getItemKey: (i) => {
      const match = search.contentMatches[i]
      return match == null ? i : `${match.path}:${match.line}:${match.column}:${i}`
    },
  })

  const toggleTreeNode = useCallback((kind: 'directory' | 'file', path: string): void => {
    const key = getSearchResultTreeNodeKey(kind, path)
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // ── 键盘流（files 模式：↑↓ 选择 / Enter 打开；content：Enter 立即搜） ──
  const selectableFilePaths = useMemo(
    () =>
      resultLayout === 'tree'
        ? visibleFileRows.map((row) => row.node.path)
        : search.fileHits.map((hit) => hit.path),
    [resultLayout, visibleFileRows, search.fileHits],
  )
  const selectedFileIndex = Math.min(selectedIdx, Math.max(selectableFilePaths.length - 1, 0))
  const selectedFilePath = selectableFilePaths[selectedFileIndex]

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (mode === 'files') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          if (selectableFilePaths.length === 0) return
          setSelectedIdx((prev) => {
            const current = Math.min(prev, selectableFilePaths.length - 1)
            const next =
              e.key === 'ArrowDown'
                ? Math.min(current + 1, selectableFilePaths.length - 1)
                : Math.max(current - 1, 0)
            const path = selectableFilePaths[next]
            if (resultLayout === 'tree') {
              const rowIndex = path == null ? undefined : fileRowIndexByPath.get(path)
              if (rowIndex != null) fileTreeVirtualizer.scrollToIndex(rowIndex, { align: 'auto' })
            } else {
              fileListVirtualizer.scrollToIndex(next, { align: 'auto' })
            }
            return next
          })
          return
        }
        if (e.key === 'Enter') {
          const path = selectableFilePaths[selectedFileIndex] ?? selectableFilePaths[0]
          if (path != null) {
            e.preventDefault()
            onOpenFile(path)
          }
        }
      }
    },
    [
      mode,
      selectableFilePaths,
      selectedFileIndex,
      resultLayout,
      fileRowIndexByPath,
      fileTreeVirtualizer,
      fileListVirtualizer,
      onOpenFile,
    ],
  )

  const trimmed = query.trim()
  const showMinQueryHint = mode === 'content' && trimmed.length > 0 && trimmed.length < 2
  const groupCount = useMemo(
    () => new Set(search.contentMatches.map((m) => m.path)).size,
    [search.contentMatches],
  )

  const openMatch = useCallback(
    (m: WorkspaceSearchContentMatch): void => {
      onOpenFile(m.path, m.line)
    },
    [onOpenFile],
  )

  const renderStatus = (): React.ReactNode => {
    if (search.error != null) {
      return <div className="sp-status sp-status-error">搜索失败：{search.error}</div>
    }
    if (showMinQueryHint) {
      return <div className="sp-status">输入至少 2 个字符开始内容搜索</div>
    }
    if (search.loading) {
      return (
        <div className="sp-status">
          <Icons.Spinner size={12} className="sp-spin" />
          {mode === 'content' ? '正在搜索…' : '搜索中…'}
          {mode === 'content' && search.contentMatches.length > 0
            ? ` 已找到 ${search.contentMatches.length} 处`
            : ''}
        </div>
      )
    }
    if (mode === 'files') {
      if (trimmed === '') {
        return <div className="sp-status">按名称搜索工作区文件（⌘P / Ctrl+P）</div>
      }
      return (
        <div className="sp-status">
          {search.fileHits.length === 0
            ? '无匹配文件'
            : `${search.fileHits.length} 个匹配${search.truncated ? '（已截断）' : ''} · 共索引 ${search.totalFiles} 文件`}
        </div>
      )
    }
    // content
    if (trimmed === '') {
      return <div className="sp-status">跨文件搜索代码内容（代码面板内 ⌘F / Ctrl+F）</div>
    }
    if (search.cancelled) {
      return <div className="sp-status">搜索已取消</div>
    }
    const parts: string[] = []
    if (search.stats != null) {
      parts.push(
        `${search.stats.matches} 处匹配 · ${groupCount} 个文件 · ${search.stats.filesSearched}/${search.stats.filesScanned} 文件 · ${search.stats.elapsedMs}ms`,
      )
    } else if (search.contentMatches.length > 0) {
      parts.push(`${search.contentMatches.length} 处匹配 · ${groupCount} 个文件`)
    }
    if (search.truncated) parts.push('已达上限，结果已截断')
    return <div className="sp-status">{parts.length > 0 ? parts.join(' · ') : '无匹配'}</div>
  }

  return (
    <div className="search-panel">
      <div className="sp-header">
        <span className="sp-header-title">
          <Icons.Search size={14} className="sp-header-icon" />
          <span className="sp-title">搜索</span>
        </span>
        <span className="sp-header-spacer" />
        {mode === 'files' && (
          <button
            type="button"
            className="sp-icon-btn"
            title="刷新文件索引（文件树与磁盘不一致时使用）"
            aria-label="刷新文件索引"
            onClick={() => setRefreshTick((v) => v + 1)}
          >
            <Icons.RotateCw size={13} />
          </button>
        )}
        <div className="sp-layout-switch" aria-label="搜索结果布局">
          <button
            type="button"
            className={`sp-layout-btn${resultLayout === 'tree' ? ' active' : ''}`}
            title="树形显示"
            aria-label="树形显示"
            aria-pressed={resultLayout === 'tree'}
            onClick={() => setResultLayout('tree')}
          >
            <Icons.Folder size={12} />
            <span>树形</span>
          </button>
          <button
            type="button"
            className={`sp-layout-btn${resultLayout === 'list' ? ' active' : ''}`}
            title="列表显示"
            aria-label="列表显示"
            aria-pressed={resultLayout === 'list'}
            onClick={() => setResultLayout('list')}
          >
            <Icons.ListFilter size={12} />
            <span>列表</span>
          </button>
        </div>
        <button
          type="button"
          className="sp-icon-btn"
          title="关闭搜索面板"
          aria-label="关闭搜索面板"
          onClick={closeSearchPanel}
        >
          <Icons.X size={13} />
        </button>
      </div>

      <div className="sp-mode-tabs">
        <button
          type="button"
          className={`sp-mode-tab${mode === 'files' ? ' active' : ''}`}
          aria-pressed={mode === 'files'}
          onClick={() => setSearchPanelMode('files')}
        >
          文件
        </button>
        <button
          type="button"
          className={`sp-mode-tab${mode === 'content' ? ' active' : ''}`}
          aria-pressed={mode === 'content'}
          onClick={() => setSearchPanelMode('content')}
        >
          内容
        </button>
      </div>

      <div className="sp-input-row">
        <div className="sp-search-box">
          <Icons.Search size={14} className="sp-input-icon" />
          <input
            ref={inputRef}
            className="sp-input"
            value={query}
            aria-label={mode === 'files' ? '搜索工作区文件' : '搜索工作区代码内容'}
            placeholder={mode === 'files' ? '输入文件名…' : '输入代码内容…'}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (mode === 'content' && e.key === 'Enter') {
                e.preventDefault()
                search.runContentNow()
                return
              }
              handleInputKeyDown(e)
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="sp-input-action"
              title="清空搜索"
              aria-label="清空搜索"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <Icons.X size={12} />
            </button>
          )}
          {mode === 'content' && (
            <button
              type="button"
              className={`sp-case-btn${caseSensitive ? ' on' : ''}`}
              title="区分大小写"
              aria-label="区分大小写"
              aria-pressed={caseSensitive}
              onClick={() =>
                updateWorkspaceState((prev) => ({
                  ...prev,
                  caseSensitive: !prev.caseSensitive,
                }))
              }
            >
              Aa
            </button>
          )}
        </div>
      </div>

      <div className="sp-status-shell" role="status" aria-live="polite">
        {renderStatus()}
      </div>

      <div
        className="sp-results"
        ref={scrollRef}
        role={resultLayout === 'tree' ? 'tree' : 'list'}
        aria-busy={search.loading}
        aria-label={mode === 'files' ? '文件搜索结果' : '代码内容搜索结果'}
      >
        {mode === 'files' ? (
          search.fileHits.length === 0 && !search.loading ? (
            <SearchEmpty
              title={trimmed === '' ? '快速打开文件' : '没有找到文件'}
              detail={
                trimmed === ''
                  ? '输入名称搜索完整工作区，使用方向键选择'
                  : '试试更短的名称，或刷新文件索引'
              }
            />
          ) : resultLayout === 'list' ? (
            <div
              className="sp-list"
              style={{ height: fileListVirtualizer.getTotalSize(), position: 'relative' }}
            >
              {fileListVirtualizer.getVirtualItems().map((vItem) => {
                const hit = search.fileHits[vItem.index]
                if (hit == null) return null
                return (
                  <VirtualRow key={vItem.key} start={vItem.start} size={vItem.size}>
                    <FlatFileResultRow
                      hit={hit}
                      selected={hit.path === selectedFilePath}
                      onOpen={onOpenFile}
                      onMouseEnter={(path) => {
                        const index = search.fileHits.findIndex((item) => item.path === path)
                        if (index >= 0) setSelectedIdx(index)
                      }}
                    />
                  </VirtualRow>
                )
              })}
            </div>
          ) : (
            <div
              className="sp-list"
              style={{ height: fileTreeVirtualizer.getTotalSize(), position: 'relative' }}
            >
              {fileTreeVirtualizer.getVirtualItems().map((vItem) => {
                const row = fileRows[vItem.index]
                if (row == null || row.kind === 'match') return null
                return (
                  <VirtualRow key={vItem.key} start={vItem.start} size={vItem.size}>
                    {row.kind === 'directory' ? (
                      <TreeDirectoryRow
                        row={row}
                        count={row.node.fileCount}
                        countLabel="文件"
                        onToggle={toggleTreeNode}
                      />
                    ) : (
                      <SearchFileRow
                        row={row}
                        selected={row.node.path === selectedFilePath}
                        onOpen={onOpenFile}
                        onMouseEnter={(path) => {
                          const index = visibleFileIndexByPath.get(path)
                          if (index != null) setSelectedIdx(index)
                        }}
                      />
                    )}
                  </VirtualRow>
                )
              })}
            </div>
          )
        ) : search.contentMatches.length === 0 ? (
          <SearchEmpty
            title={
              !search.loading && trimmed !== '' && search.error == null && !showMinQueryHint
                ? '没有找到内容'
                : '搜索整个工作区'
            }
            detail={
              !search.loading && trimmed !== '' && search.error == null && !showMinQueryHint
                ? '换个关键词，或检查大小写选项'
                : '输入至少 2 个字符开始代码搜索'
            }
          />
        ) : resultLayout === 'list' ? (
          <div
            className="sp-list"
            style={{ height: contentListVirtualizer.getTotalSize(), position: 'relative' }}
          >
            {contentListVirtualizer.getVirtualItems().map((vItem) => {
              const match = search.contentMatches[vItem.index]
              if (match == null) return null
              return (
                <VirtualRow key={vItem.key} start={vItem.start} size={vItem.size}>
                  <FlatMatchResultRow match={match} onOpen={openMatch} />
                </VirtualRow>
              )
            })}
          </div>
        ) : (
          <div
            className="sp-list"
            style={{ height: contentVirtualizer.getTotalSize(), position: 'relative' }}
          >
            {contentVirtualizer.getVirtualItems().map((vItem) => {
              const row = contentRows[vItem.index]
              if (row == null) return null
              return (
                <VirtualRow key={vItem.key} start={vItem.start} size={vItem.size}>
                  {row.kind === 'directory' && (
                    <TreeDirectoryRow
                      row={row}
                      count={row.node.matchCount}
                      countLabel="匹配"
                      onToggle={toggleTreeNode}
                    />
                  )}
                  {row.kind === 'file' && <ContentFileRow row={row} onToggle={toggleTreeNode} />}
                  {row.kind === 'match' && <MatchResultRow row={row} onOpen={openMatch} />}
                </VirtualRow>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

type DirectoryRow = Extract<SearchResultTreeRow, { kind: 'directory' }>
type FileRow = Extract<SearchResultTreeRow, { kind: 'file' }>
type MatchRow = Extract<SearchResultTreeRow, { kind: 'match' }>

function VirtualRow({
  start,
  size,
  children,
}: {
  start: number
  size: number
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div
      role="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
        height: `${size}px`,
      }}
    >
      {children}
    </div>
  )
}

function splitResultPath(path: string): { name: string; parent: string } {
  const normalized = path.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  return separator < 0
    ? { name: normalized, parent: '' }
    : { name: normalized.slice(separator + 1), parent: normalized.slice(0, separator) }
}

function FlatFileResultRow({
  hit,
  selected,
  onOpen,
  onMouseEnter,
}: {
  hit: WorkspaceSearchFileHit
  selected: boolean
  onOpen: (path: string) => void
  onMouseEnter: (path: string) => void
}): React.ReactNode {
  const path = splitResultPath(hit.path)
  return (
    <button
      type="button"
      role="listitem"
      className={`sp-flat-file-row${selected ? ' selected' : ''}`}
      title={hit.path}
      aria-current={selected ? true : undefined}
      onClick={() => onOpen(hit.path)}
      onMouseEnter={() => onMouseEnter(hit.path)}
    >
      <FileTypeIcon filePath={hit.path} size={14} />
      <span className="sp-flat-main">
        <span className="sp-flat-title">{path.name}</span>
        {path.parent !== '' && <span className="sp-flat-path">{path.parent}</span>}
      </span>
    </button>
  )
}

function FlatMatchResultRow({
  match,
  onOpen,
}: {
  match: WorkspaceSearchContentMatch
  onOpen: (match: WorkspaceSearchContentMatch) => void
}): React.ReactNode {
  const path = splitResultPath(match.path)
  return (
    <button
      type="button"
      role="listitem"
      className="sp-flat-match-row"
      title={`${match.path}:${match.line}`}
      onClick={() => onOpen(match)}
    >
      <span className="sp-flat-match-heading">
        <FileTypeIcon filePath={match.path} size={13} />
        <span className="sp-flat-title">{path.name}</span>
        <span className="sp-flat-path">
          {path.parent !== '' ? `${path.parent} · ` : ''}第 {match.line} 行
        </span>
      </span>
      <span className="sp-flat-match-text">
        <MatchText match={match} />
      </span>
    </button>
  )
}

const TREE_INDENT_PX = 14
const TREE_MAX_VISUAL_DEPTH = 8

function getTreeRowPadding(depth: number): number {
  return 6 + Math.min(depth, TREE_MAX_VISUAL_DEPTH) * TREE_INDENT_PX
}

function TreeDirectoryRow({
  row,
  count,
  countLabel,
  onToggle,
}: {
  row: DirectoryRow
  count: number
  countLabel: string
  onToggle: (kind: 'directory', path: string) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="treeitem"
      className="sp-tree-row sp-directory-row"
      style={{ paddingLeft: getTreeRowPadding(row.depth) }}
      title={row.node.path}
      aria-level={row.depth + 1}
      aria-expanded={!row.collapsed}
      aria-label={`${row.node.name}，${count} 个${countLabel}`}
      onClick={() => onToggle('directory', row.node.path)}
    >
      <TreeChevron collapsed={row.collapsed} />
      <Icons.Folder size={13} className="sp-tree-folder-icon" />
      <span className="sp-tree-label">{row.node.name}</span>
      <span className="sp-tree-count">{count}</span>
    </button>
  )
}

function SearchFileRow({
  row,
  selected,
  onOpen,
  onMouseEnter,
}: {
  row: FileRow
  selected: boolean
  onOpen: (path: string) => void
  onMouseEnter: (path: string) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="treeitem"
      className={`sp-tree-row sp-file-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: getTreeRowPadding(row.depth) }}
      title={row.node.path}
      aria-level={row.depth + 1}
      aria-current={selected ? true : undefined}
      onClick={() => onOpen(row.node.path)}
      onMouseEnter={() => onMouseEnter(row.node.path)}
    >
      <span className="sp-tree-chevron-placeholder" aria-hidden="true" />
      <FileTypeIcon filePath={row.node.path} size={13} />
      <span className="sp-tree-label sp-tree-file-label">{row.node.name}</span>
    </button>
  )
}

function ContentFileRow({
  row,
  onToggle,
}: {
  row: FileRow
  onToggle: (kind: 'file', path: string) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="treeitem"
      className="sp-tree-row sp-content-file-row"
      style={{ paddingLeft: getTreeRowPadding(row.depth) }}
      title={row.node.path}
      aria-level={row.depth + 1}
      aria-expanded={!row.collapsed}
      aria-label={`${row.node.name}，${row.node.matches.length} 处匹配`}
      onClick={() => onToggle('file', row.node.path)}
    >
      <TreeChevron collapsed={row.collapsed} />
      <FileTypeIcon filePath={row.node.path} size={13} />
      <span className="sp-tree-label sp-tree-file-label">{row.node.name}</span>
      <span className="sp-tree-count">{row.node.matches.length}</span>
    </button>
  )
}

function MatchResultRow({
  row,
  onOpen,
}: {
  row: MatchRow
  onOpen: (match: WorkspaceSearchContentMatch) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="treeitem"
      className="sp-match-row"
      style={{ paddingLeft: getTreeRowPadding(row.depth) }}
      title={`${row.match.path}:${row.match.line}`}
      aria-level={row.depth + 1}
      onClick={() => onOpen(row.match)}
    >
      <span className="sp-match-line">{row.match.line}</span>
      <span className="sp-match-text">
        <MatchText match={row.match} />
      </span>
    </button>
  )
}

function TreeChevron({ collapsed }: { collapsed: boolean }): React.ReactNode {
  return collapsed ? (
    <Icons.ChevronRight size={12} className="sp-tree-chevron" />
  ) : (
    <Icons.ChevronDown size={12} className="sp-tree-chevron" />
  )
}

function SearchEmpty({ title, detail }: { title: string; detail: string }): React.ReactNode {
  return (
    <div className="sp-empty">
      <Icons.Search size={22} className="sp-empty-icon" />
      <span className="sp-empty-title">{title}</span>
      <span className="sp-empty-detail">{detail}</span>
    </div>
  )
}

/** 匹配行文本：前缀 / 高亮命中段 / 后缀（column 超出截断文本时退化为纯文本） */
function MatchText({ match }: { match: WorkspaceSearchContentMatch }): React.ReactNode {
  const { text, column, length } = match
  if (column >= text.length) return <span>{text}</span>
  return (
    <>
      <span>{text.slice(0, column)}</span>
      <span className="sp-match-hit">{text.slice(column, column + length)}</span>
      <span>{text.slice(column + length)}</span>
    </>
  )
}
