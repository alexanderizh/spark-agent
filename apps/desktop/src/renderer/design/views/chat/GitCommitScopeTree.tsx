import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceGitFileChange } from '@spark/protocol'
import { Icons } from '../../Icons'
import {
  buildDefaultExpandedTreeDirs,
  buildGitReviewTree,
  collectGitTreeNodeFilePaths,
  formatSignedNumber,
  getGitChangeStatusBadgeClass,
  getGitChangeStatusCode,
  type GitReviewTreeNode,
} from './ChatGitUtils'

/** 原生 checkbox 的 indeterminate 只能通过 DOM 属性设置。 */
function TriStateCheckbox({
  checked,
  indeterminate,
  disabled,
  title,
  scopePath,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  disabled?: boolean
  title: string
  scopePath: string
  onChange: (next: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current != null) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      data-scope-path={scopePath}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

function pruneNodeByKeyword(node: GitReviewTreeNode, keyword: string): GitReviewTreeNode | null {
  if (node.change != null) {
    return node.path.toLowerCase().includes(keyword) ? node : null
  }
  const children = node.children
    .map((child) => pruneNodeByKeyword(child, keyword))
    .filter((child): child is GitReviewTreeNode => child != null)
  if (children.length === 0) return null
  return { ...node, children }
}

export function GitCommitScopeTree({
  files,
  selected,
  onSelectedChange,
  disabled,
}: {
  files: readonly WorkspaceGitFileChange[]
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    buildDefaultExpandedTreeDirs([...files]),
  )
  const tree = useMemo(() => buildGitReviewTree([...files]), [files])
  const keyword = search.trim().toLowerCase()
  const visibleTree = useMemo(() => {
    if (!keyword) return tree
    return {
      ...tree,
      children: tree.children
        .map((child) => pruneNodeByKeyword(child, keyword))
        .filter((child): child is GitReviewTreeNode => child != null),
    }
  }, [tree, keyword])
  const totalFiles = files.length
  const selectedCount = useMemo(
    () => files.reduce((acc, file) => acc + (selected.has(file.path) ? 1 : 0), 0),
    [files, selected],
  )

  const setNodeSelected = (node: GitReviewTreeNode, next: boolean) => {
    const nextSet = new Set(selected)
    for (const path of collectGitTreeNodeFilePaths(node)) {
      if (next) nextSet.add(path)
      else nextSet.delete(path)
    }
    onSelectedChange(nextSet)
  }

  const selectAll = () => onSelectedChange(new Set(files.map((file) => file.path)))
  const clearAll = () => onSelectedChange(new Set())

  const renderRows = (nodes: readonly GitReviewTreeNode[], depth: number) =>
    nodes.map((node) => {
      if (node.change != null) {
        const change = node.change
        const checked = selected.has(change.path)
        const code = getGitChangeStatusCode(change)
        return (
          <div
            key={node.path}
            className={`git-scope-tree-row file${checked ? ' is-selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={node.path}
            role="button"
            tabIndex={0}
            onClick={() => setNodeSelected(node, !checked)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setNodeSelected(node, !checked)
              }
            }}
          >
            <TriStateCheckbox
              checked={checked}
              indeterminate={false}
              {...(disabled === true ? { disabled: true } : {})}
              title={node.path}
              scopePath={node.path}
              onChange={(next) => setNodeSelected(node, next)}
            />
            {change.staged && <span className="git-scope-staged-dot" title="已暂存" />}
            <span className={`git-scope-status-badge ${getGitChangeStatusBadgeClass(code)}`}>
              {code}
            </span>
            <span className="git-scope-file-name" dir="auto">
              {node.name}
            </span>
            <span className="git-scope-file-delta">
              {change.additions > 0 && (
                <span className="git-add">+{formatSignedNumber(change.additions)}</span>
              )}
              {change.deletions > 0 && (
                <span className="git-del">-{formatSignedNumber(change.deletions)}</span>
              )}
            </span>
          </div>
        )
      }

      const nodePaths = collectGitTreeNodeFilePaths(node)
      const checkedCount = nodePaths.reduce((acc, path) => acc + (selected.has(path) ? 1 : 0), 0)
      const allChecked = nodePaths.length > 0 && checkedCount === nodePaths.length
      const someChecked = checkedCount > 0 && !allChecked
      // 搜索态下保持全展开，避免裁剪树与折叠状态互相打架
      const isOpen = keyword !== '' ? true : expanded[node.path] === true
      return (
        <div key={node.path || '__root__'}>
          <div
            className={`git-scope-tree-row dir${allChecked ? ' is-selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            role="button"
            tabIndex={0}
            onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }))
              }
            }}
          >
            <TriStateCheckbox
              checked={allChecked}
              indeterminate={someChecked}
              {...(disabled === true ? { disabled: true } : {})}
              scopePath={node.path}
              title={
                someChecked
                  ? '已选部分，点击全选该文件夹'
                  : allChecked
                    ? '点击取消该文件夹'
                    : '点击全选该文件夹'
              }
              onChange={(next) => setNodeSelected(node, next)}
            />
            <span className="git-scope-caret">
              {isOpen ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
            </span>
            <span className="git-scope-dir-name" dir="auto">
              {node.name || '（仓库根目录）'}
            </span>
            <span className="git-scope-dir-count">
              {checkedCount}/{nodePaths.length}
            </span>
          </div>
          {isOpen && (
            <div className="git-scope-tree-children">{renderRows(node.children, depth + 1)}</div>
          )}
        </div>
      )
    })

  return (
    <div className="git-scope-tree-panel">
      <div className="git-scope-tree-toolbar">
        <span className="git-scope-tree-search">
          <Icons.Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索文件路径"
            disabled={disabled}
          />
          {search !== '' && (
            <button
              type="button"
              className="git-scope-search-clear"
              title="清空搜索"
              onClick={() => setSearch('')}
            >
              <Icons.X size={11} />
            </button>
          )}
        </span>
        <span className="git-scope-tree-bulk">
          <button
            type="button"
            disabled={disabled || selectedCount === totalFiles}
            onClick={selectAll}
          >
            全选
          </button>
          <button type="button" disabled={disabled || selectedCount === 0} onClick={clearAll}>
            清空
          </button>
        </span>
      </div>
      <div className="git-scope-tree-body">
        {visibleTree.children.length > 0 ? (
          renderRows(visibleTree.children, 0)
        ) : (
          <div className="git-scope-tree-empty">没有匹配的文件</div>
        )}
      </div>
    </div>
  )
}
