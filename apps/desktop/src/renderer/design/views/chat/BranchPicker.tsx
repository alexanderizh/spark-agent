import { useEffect, useRef, useState, type RefObject } from 'react'
import type { WorkspaceGitBranch } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { BranchState } from './ChatComposerTypes'

type BranchGroup = {
  kind: WorkspaceGitBranch['kind']
  label: string
  branches: WorkspaceGitBranch[]
}

export function getBranchGroups(branchState: BranchState, search = ''): BranchGroup[] {
  const details =
    branchState.branchDetails?.length != null && branchState.branchDetails.length > 0
      ? branchState.branchDetails
      : Array.from(new Set(branchState.branches)).map((name) => ({
          name,
          kind: 'local' as const,
          updatedAt: 0,
        }))
  const query = search.trim().toLowerCase()
  const visible = details
    .filter((branch) => branch.name.length > 0 && branch.name.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  const groups: BranchGroup[] = [
    { kind: 'local', label: '本地分支', branches: visible.filter((item) => item.kind === 'local') },
    {
      kind: 'remote',
      label: '远程分支',
      branches: visible.filter((item) => item.kind === 'remote'),
    },
  ]
  return groups.filter((group) => group.branches.length > 0)
}

export function GitBranchRows({
  branchState,
  search,
  currentBranch,
  disabled = false,
  currentDescription,
  onSelect,
}: {
  branchState: BranchState
  search: string
  currentBranch: string
  disabled?: boolean
  currentDescription?: string | null
  onSelect: (branch: string) => void
}) {
  const groups = getBranchGroups(branchState, search)
  if (groups.length === 0) return <div className="git-popover-muted">没有匹配分支</div>

  return groups.map((group) => (
    <section className="git-branch-section" key={group.kind}>
      <div className="git-branch-section-title">{group.label}</div>
      {group.branches.map((branch) => {
        const active = branch.kind === 'local' && branch.name === currentBranch
        return (
          <button
            type="button"
            key={`${branch.kind}:${branch.name}`}
            className={`git-branch-row${active ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => onSelect(branch.name)}
          >
            {branch.kind === 'remote' ? (
              <Icons.CloudDownload size={14} />
            ) : (
              <Icons.GitBranch size={14} />
            )}
            <span className="git-branch-copy">
              <span className="git-branch-name truncate">{branch.name}</span>
              {active && currentDescription != null && (
                <span className="git-branch-desc">{currentDescription}</span>
              )}
            </span>
            {active && <Icons.Check size={14} />}
          </button>
        )
      })}
    </section>
  ))
}

function useCloseOnOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [active, onClose, ref])
}

export function ComposerBranchSelect({
  branchState,
  onChange,
  onCreateBranch,
  onOpen,
  onFetch,
}: {
  branchState: BranchState
  onChange: (branch: string) => void | Promise<void>
  onCreateBranch?: (branch: string) => Promise<void>
  onOpen?: () => void
  onFetch?: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  const currentBranch = branchState.currentBranch ?? ''

  const resetPanel = () => {
    setSearch('')
    setCreating(false)
    setDraft('')
  }

  const runFetch = async () => {
    if (onFetch == null || fetching) return
    setFetching(true)
    try {
      await onFetch()
    } finally {
      setFetching(false)
    }
  }

  const runCreateBranch = async () => {
    const next = draft.trim()
    if (!next || busy || onCreateBranch == null) return
    setBusy(true)
    try {
      await onCreateBranch(next)
      setOpen(false)
      resetPanel()
    } catch {
      // 上层展示错误；保留内容便于重试。
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-branch-select${open ? ' is-open' : ''}`}
      title="分支"
    >
      <span className="composer-select-icon">
        <Icons.GitBranch size={13} />
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        onClick={() =>
          setOpen((previous) => {
            const next = !previous
            if (next) {
              resetPanel()
              onOpen?.()
            }
            return next
          })
        }
      >
        <span>{currentBranch || '未配置'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu branch-menu right">
          <div className="git-branch-search">
            <Icons.Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索分支"
              autoFocus
            />
            {onFetch != null && (
              <button
                type="button"
                className="git-fetch-branches-btn"
                disabled={fetching}
                onClick={() => void runFetch()}
              >
                <Icons.Refresh size={12} className={fetching ? 'is-spinning' : ''} />
                Fetch
              </button>
            )}
          </div>
          <div className="git-branch-list">
            <GitBranchRows
              branchState={branchState}
              search={search}
              currentBranch={currentBranch}
              disabled={busy}
              onSelect={(branch) => {
                setOpen(false)
                if (branch !== currentBranch) void onChange(branch)
              }}
            />
          </div>
          {onCreateBranch != null &&
            (creating ? (
              <div className="git-create-branch-inline">
                <input
                  className="git-create-branch-inline-input"
                  value={draft}
                  autoFocus
                  placeholder="新分支名称"
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runCreateBranch()
                    if (event.key === 'Escape') {
                      setCreating(false)
                      setDraft('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="git-create-branch-inline-btn"
                  title="取消"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false)
                    setDraft('')
                  }}
                >
                  <Icons.X size={13} />
                </button>
                <button
                  type="button"
                  className="git-create-branch-inline-btn confirm"
                  title="创建并检出"
                  disabled={busy || !draft.trim()}
                  onClick={() => void runCreateBranch()}
                >
                  <Icons.Check size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="git-create-branch-btn"
                onClick={() => setCreating(true)}
              >
                <Icons.Plus size={14} />
                <span>创建并检出新分支...</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
