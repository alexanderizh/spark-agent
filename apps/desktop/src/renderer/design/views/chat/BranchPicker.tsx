import { useEffect, useRef, useState, type RefObject } from 'react'
import type { WorkspaceGitBranch } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { BranchState } from './ChatComposerTypes'
import { formatRelativeTime } from './ChatViewUtils'

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
    { kind: 'tag', label: '标签', branches: visible.filter((item) => item.kind === 'tag') },
  ]
  return groups.filter((group) => group.branches.length > 0)
}

function tagUpdatedAtLabel(updatedAt: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  return formatRelativeTime(new Date(updatedAt).toISOString())
}

export type TagCheckoutHandler = (tag: string) => Promise<boolean>
export type TagCreateBranchHandler = (tag: string, branch: string) => Promise<boolean>

/**
 * 标签行：点击不直接切换，而是展开两个动作——
 * 「从此标签创建分支」（安全主路径，提交归属新分支）和
 * 「检出此标签」（分离头指针，仅查看历史代码）。
 */
function GitTagRow({
  tag,
  active = false,
  disabled = false,
  expanded = false,
  onToggleExpanded,
  onCheckout,
  onCreateBranch,
}: {
  tag: WorkspaceGitBranch
  active?: boolean
  disabled?: boolean
  expanded?: boolean
  onToggleExpanded: () => void
  onCheckout: TagCheckoutHandler
  onCreateBranch: TagCreateBranchHandler
}) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const draftTrimmed = draft.trim()
  const branchError =
    draftTrimmed.length === 0
      ? ''
      : draftTrimmed.endsWith('/')
        ? '分支名不能以“/”结尾。'
        : /\s/.test(draftTrimmed)
          ? '分支名不能包含空白字符。'
          : ''

  const runCheckout = async () => {
    if (disabled || busy) return
    setBusy(true)
    try {
      // 成功时父级关闭弹窗，本组件随弹窗卸载；失败保留展开态便于重试
      await onCheckout(tag.name)
    } finally {
      setBusy(false)
    }
  }

  const runCreateBranch = async () => {
    if (disabled || busy || !draftTrimmed || branchError) return
    setBusy(true)
    try {
      await onCreateBranch(tag.name, draftTrimmed)
    } finally {
      setBusy(false)
    }
  }

  const resetCreating = () => {
    setCreating(false)
    setDraft('')
  }

  return (
    <div className={`git-tag-item${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className={`git-branch-row git-tag-row${active ? ' active' : ''}`}
        disabled={disabled || busy}
        onClick={() => {
          if (expanded) resetCreating()
          onToggleExpanded()
        }}
      >
        <Icons.Tag size={14} className="git-tag-icon" />
        <span className="git-branch-copy">
          <span className="git-branch-name truncate">{tag.name}</span>
          {active && <span className="git-branch-desc">分离头指针 · 仅查看</span>}
        </span>
        <span className="git-tag-time">{tagUpdatedAtLabel(tag.updatedAt)}</span>
        <Icons.ChevronDown size={12} className={`git-tag-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded &&
        (creating ? (
          <>
            <div className="git-create-branch-inline git-tag-create-inline">
              <input
                className="git-create-branch-inline-input"
                value={draft}
                autoFocus
                placeholder={`基于 ${tag.name} 的新分支名`}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runCreateBranch()
                  if (event.key === 'Escape') resetCreating()
                }}
              />
              <button
                type="button"
                className="git-create-branch-inline-btn"
                title="取消"
                disabled={busy}
                onClick={resetCreating}
              >
                <Icons.X size={13} />
              </button>
              <button
                type="button"
                className="git-create-branch-inline-btn confirm"
                title="创建并检出"
                disabled={busy || !draftTrimmed || !!branchError}
                onClick={() => void runCreateBranch()}
              >
                <Icons.Check size={13} />
              </button>
            </div>
            {branchError && <div className="git-create-error">{branchError}</div>}
          </>
        ) : (
          <div className="git-tag-actions">
            <button
              type="button"
              className="git-tag-action-btn primary"
              disabled={disabled || busy}
              onClick={() => setCreating(true)}
            >
              <Icons.GitBranch size={13} />
              <span>从此标签创建分支...</span>
            </button>
            <button
              type="button"
              className="git-tag-action-btn"
              disabled={disabled || busy}
              onClick={() => void runCheckout()}
            >
              <Icons.Tag size={13} />
              <span>检出 {tag.name}（分离头指针 · 仅查看）</span>
            </button>
          </div>
        ))}
    </div>
  )
}

export function GitBranchRows({
  branchState,
  search,
  currentBranch,
  disabled = false,
  currentDescription,
  detachedHead = false,
  onSelect,
  onCheckoutTag,
  onCreateBranchFromTag,
}: {
  branchState: BranchState
  search: string
  currentBranch: string
  disabled?: boolean
  currentDescription?: string | null
  /** 当前为分离头指针时，currentBranch 是 tag 名或短 SHA，用于标记对应 tag 行。 */
  detachedHead?: boolean
  onSelect: (branch: string) => void
  onCheckoutTag?: TagCheckoutHandler
  onCreateBranchFromTag?: TagCreateBranchHandler
}) {
  const [expandedTag, setExpandedTag] = useState<string | null>(null)
  const groups = getBranchGroups(branchState, search)
  if (branchState.gitState?.kind === 'runtime_unavailable') {
    return <div className="git-popover-muted">Git 运行环境不可用，请前往设置重新检测</div>
  }
  if (branchState.gitState?.kind === 'failed') {
    return <div className="git-popover-muted">{branchState.gitState.message}</div>
  }
  if (branchState.gitState?.kind === 'not_repository') {
    return <div className="git-popover-muted">当前项目不是 Git 仓库</div>
  }
  if (branchState.gitState?.kind === 'ready' && branchState.gitState.repositoryKind === 'bare') {
    return <div className="git-popover-muted">裸仓库没有工作区，无法切换分支</div>
  }
  // 标签组需要检出回调才有可交互入口；未提供时（旧调用方）整组隐藏
  const visibleGroups = groups.filter((group) => group.kind !== 'tag' || onCheckoutTag != null)
  if (visibleGroups.length === 0) return <div className="git-popover-muted">没有匹配分支</div>

  return visibleGroups.map((group) => (
    <section className="git-branch-section" key={group.kind}>
      <div className="git-branch-section-title">{group.label}</div>
      {group.branches.map((branch) => {
        const active = branch.kind === 'local' && branch.name === currentBranch
        if (branch.kind === 'tag') {
          if (onCheckoutTag == null || onCreateBranchFromTag == null) return null
          return (
            <GitTagRow
              key={`tag:${branch.name}`}
              tag={branch}
              active={detachedHead && branch.name === currentBranch}
              disabled={disabled}
              expanded={expandedTag === branch.name}
              onToggleExpanded={() =>
                setExpandedTag((previous) => (previous === branch.name ? null : branch.name))
              }
              onCheckout={onCheckoutTag}
              onCreateBranch={onCreateBranchFromTag}
            />
          )
        }
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
  onCheckoutTag,
  onCreateBranchFromTag,
}: {
  branchState: BranchState
  onChange: (branch: string) => void | Promise<void>
  onCreateBranch?: (branch: string) => Promise<void>
  onOpen?: () => void
  onFetch?: () => Promise<void>
  onCheckoutTag?: TagCheckoutHandler
  onCreateBranchFromTag?: TagCreateBranchHandler
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
  const detached = branchState.detachedHead === true
  const canCreateBranch = !(
    branchState.gitState?.kind === 'ready' && branchState.gitState.repositoryKind === 'bare'
  )

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
        <span className="composer-branch-trigger-label">
          <span className={`truncate${detached ? ' is-detached' : ''}`}>
            {currentBranch || '未配置'}
          </span>
          {detached && <span className="composer-branch-detached-badge">分离</span>}
        </span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu branch-menu right">
          <div className="git-branch-search">
            <Icons.Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索分支或标签"
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
              detachedHead={detached}
              disabled={busy}
              onSelect={(branch) => {
                setOpen(false)
                if (branch !== currentBranch) void onChange(branch)
              }}
              {...(onCheckoutTag != null &&
                onCreateBranchFromTag != null && {
                  onCheckoutTag: async (tag: string) => {
                    const ok = await onCheckoutTag(tag)
                    if (ok) {
                      setOpen(false)
                      resetPanel()
                    }
                    return ok
                  },
                  onCreateBranchFromTag: async (tag: string, branch: string) => {
                    const ok = await onCreateBranchFromTag(tag, branch)
                    if (ok) {
                      setOpen(false)
                      resetPanel()
                    }
                    return ok
                  },
                })}
            />
          </div>
          {onCreateBranch != null &&
            canCreateBranch &&
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
