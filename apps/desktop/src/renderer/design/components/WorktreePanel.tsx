/**
 * WorktreePanel — 右侧项目信息中的 Git Worktree 可视化面板
 *
 * 展示当前项目（主仓库）下的所有 worktree、当前会话所在 worktree、各分支是否已合并，
 * 并提供合并（向 Agent 发送指令）/ 打开 / 删除操作。
 *
 * 注意：列表数据来自 `git worktree list`，会包含所有 git 已注册的 worktree
 * （主仓库 + 各工具创建的 `.worktrees` / `.claude/worktrees` /
 * `.config/superpowers/worktrees` 等），不止 Spark 自己创建的子项。
 */
import { useCallback, useEffect, useState } from 'react'
import type { SessionId, WorktreeInfo } from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import './WorktreePanel.less'

interface WorktreePanelProps {
  workspaceId: string | null
  /** 当前会话 id；「合并」按钮通过它向 Agent 发送指令 */
  sessionId: SessionId | null
}

export function WorktreePanel({ workspaceId, sessionId }: WorktreePanelProps) {
  const { toast } = useToast()
  const { invoke: listWorktrees } = useIpcInvoke('workspace:list-worktrees')
  const { invoke: removeWorktree } = useIpcInvoke('workspace:remove-worktree')
  const { invoke: openFolder } = useIpcInvoke('workspace:open-folder')
  const { invoke: sendTurn } = useIpcInvoke('session:submit-turn')

  const [isGitRepo, setIsGitRepo] = useState(true)
  const [baseBranch, setBaseBranch] = useState<string | null>(null)
  const [baseRepoRoot, setBaseRepoRoot] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  const refresh = useCallback(() => {
    if (workspaceId == null) return
    setLoading(true)
    listWorktrees({ workspaceId })
      .then((res) => {
        setIsGitRepo(res.isGitRepo)
        setBaseBranch(res.baseBranch)
        setBaseRepoRoot(res.baseRepoRoot)
        setWorktrees(res.worktrees)
      })
      .catch(() => {
        setIsGitRepo(false)
        setWorktrees([])
      })
      .finally(() => setLoading(false))
  }, [workspaceId, listWorktrees])

  useEffect(() => {
    // 延迟到下一个 tick，避免在 effect 体内同步 setState（cascading renders）
    const id = window.setTimeout(() => refresh(), 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  const handleMerge = useCallback(
    async (wt: WorktreeInfo) => {
      if (sessionId == null || wt.branch == null || baseBranch == null || baseRepoRoot == null) return
      // 注意：base 分支已在主工作树检出，无法在当前 worktree 内 checkout，
      // 因此合并必须在主仓库目录执行（git -C <baseRepoRoot>）。
      const message =
        `请将分支 \`${wt.branch}\` 合并回主仓库的 \`${baseBranch}\` 分支。\n` +
        `主仓库位于：\`${baseRepoRoot}\`（注意：base 分支已在主仓库检出，不能在当前 worktree 内切换）。\n` +
        `请在主仓库目录执行合并，例如：\n` +
        `1. \`git -C "${baseRepoRoot}" merge ${wt.branch}\`（或先切到主仓库目录再操作）\n` +
        `2. 如有冲突，逐一解决并说明你的处理\n` +
        `3. 完成后报告合并结果`
      try {
        await sendTurn({ sessionId, message })
        toast.success('已向 Agent 发送合并指令')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '发送合并指令失败')
      }
    },
    [sessionId, baseBranch, baseRepoRoot, sendTurn, toast],
  )

  const handleRemove = useCallback(
    async (wt: WorktreeInfo) => {
      if (wt.workspaceId == null) return
      try {
        await removeWorktree({ workspaceId: wt.workspaceId, force: true })
        toast.success('已删除 worktree')
        refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除 worktree 失败')
      }
    },
    [removeWorktree, toast, refresh],
  )

  const handleReveal = useCallback(
    async (wt: WorktreeInfo) => {
      if (wt.workspaceId == null) return
      await openFolder({ workspaceId: wt.workspaceId }).catch(() => {})
    },
    [openFolder],
  )

  if (workspaceId == null) return null

  const visibleCount = worktrees.filter((w) => !w.isMain).length

  return (
    <section className="worktree-panel">
      <h4
        className="config-panel-header worktree-panel__header"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开' : '折叠'}
      >
        <Icons.GitBranch size={11} />
        Worktree
        {visibleCount > 0 && <span className="inspector-count">{visibleCount}</span>}
        <button
          className="worktree-panel__refresh"
          onClick={(e) => {
            e.stopPropagation()
            refresh()
          }}
          disabled={loading}
          title="刷新"
        >
          <Icons.Refresh size={11} />
        </button>
        <Icons.ChevronRight size={10} className={`chev ${collapsed ? '' : 'chev-open'}`} />
      </h4>
      {!collapsed &&
        (!isGitRepo ? (
          <p className="worktree-panel__empty">当前项目不是 git 仓库</p>
        ) : worktrees.length === 0 ? (
          <p className="worktree-panel__empty">暂无 worktree</p>
        ) : (
          <ul className="worktree-panel__list">
            {worktrees.map((wt) => (
              <li key={wt.path} className={`worktree-item ${wt.isCurrent ? 'is-current' : ''}`}>
                <div className="worktree-item__main">
                  <Icons.GitBranch size={11} />
                  <span className="worktree-item__branch">{wt.branch ?? '(detached)'}</span>
                  {wt.isMain && <span className="badge badge--main">main</span>}
                  {!wt.isMain && (
                    <span className={`badge ${wt.isMerged ? 'badge--merged' : 'badge--unmerged'}`}>
                      {wt.isMerged ? '已合并' : '未合并'}
                    </span>
                  )}
                  {wt.isCurrent && <span className="badge badge--current">当前</span>}
                </div>
                <div className="worktree-item__meta">
                  <code>{wt.head}</code>
                  {wt.sessionTitle && <span className="worktree-item__session">{wt.sessionTitle}</span>}
                </div>
                {!wt.isMain && (
                  <div className="worktree-item__actions">
                    {wt.isCurrent && (
                      <button onClick={() => handleMerge(wt)} disabled={sessionId == null}>
                        合并
                      </button>
                    )}
                    <button onClick={() => handleReveal(wt)}>打开</button>
                    <button className="danger" onClick={() => handleRemove(wt)} disabled={wt.workspaceId == null}>
                      删除
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
