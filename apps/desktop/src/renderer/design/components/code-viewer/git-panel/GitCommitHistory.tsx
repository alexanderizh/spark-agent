/**
 * GitCommitHistory —— 提交板块：最近提交列表（hash + subject + 作者 + 相对时间），
 * 未推送的提交带 ↑ 标识与强调色。
 *
 * 行悬浮 250ms 弹出 GitCommitDetailPopover 展示提交详情（完整 hash / refs / 完整提交
 * 信息 / 作者邮箱 / 绝对时间）；指针移入浮层可保持（复制 hash 等），离开行或浮层后关闭；
 * 列表滚动、提交数据刷新时浮层自动收起。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { WorkspaceGitCommitEntry } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { GitCommitDetailPopover } from './GitCommitDetailPopover'
import { formatGitRelativeTime } from './gitPanelViewUtils'

/** 行悬浮到弹出详情的延时（ms），避免扫过列表时连续弹层 */
const POPOVER_OPEN_DELAY_MS = 250
/** 离开行后到关闭的延时（ms），给指针移入浮层留接力窗口 */
const POPOVER_CLOSE_DELAY_MS = 120

interface HoveredCommit {
  commit: WorkspaceGitCommitEntry
  anchorEl: HTMLDivElement
}

export function GitCommitHistory({
  commits,
  loading,
  error,
  collapsed,
  onToggle,
  onRefresh,
}: {
  commits: WorkspaceGitCommitEntry[]
  loading: boolean
  error: string | null
  collapsed: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const unpushedCount = commits.filter((c) => c.unpushed).length
  const [hovered, setHovered] = useState<HoveredCommit | null>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closePopover = useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
    setHovered(null)
  }, [clearOpenTimer, clearCloseTimer])

  // 卸载时清掉挂起的开/关计时器
  useEffect(
    () => () => {
      clearOpenTimer()
      clearCloseTimer()
    },
    [clearOpenTimer, clearCloseTimer],
  )

  // 滚动列表会让 fixed 浮层错位：任何滚动立即收起
  useEffect(() => {
    if (hovered == null) return
    window.addEventListener('scroll', closePopover, true)
    return () => window.removeEventListener('scroll', closePopover, true)
  }, [hovered, closePopover])

  // 提交数据刷新后（刷新按钮 / status 变化触发重拉）旧锚点失效，直接收起
  useEffect(() => {
    closePopover()
  }, [commits, closePopover])

  const handleRowEnter = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, commit: WorkspaceGitCommitEntry): void => {
      const anchorEl = event.currentTarget
      clearCloseTimer()
      clearOpenTimer()
      // 从一行移到另一行：先立即收起旧浮层，再排队新浮层，避免旧详情悬在不相干的行旁
      setHovered((prev) => (prev != null && prev.commit.hash !== commit.hash ? null : prev))
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null
        setHovered({ commit, anchorEl })
      }, POPOVER_OPEN_DELAY_MS)
    },
    [clearOpenTimer, clearCloseTimer],
  )

  const handleRowLeave = useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setHovered(null)
    }, POPOVER_CLOSE_DELAY_MS)
  }, [clearOpenTimer, clearCloseTimer])

  const handlePopoverEnter = useCallback((): void => {
    clearCloseTimer()
  }, [clearCloseTimer])

  return (
    <div className={`gp-group${collapsed ? ' collapsed' : ''}`}>
      <div className="gp-group-head">
        <button type="button" className="gp-group-title" onClick={onToggle}>
          <Icons.ChevronDown size={13} className="gp-chevron" />
          <span className="gp-group-dot muted" />
          <span>提交</span>
          <span className="gp-group-count">{commits.length}</span>
          {unpushedCount > 0 && (
            <span className="gp-unpushed-badge" title={`${unpushedCount} 条未推送`}>
              ↑{unpushedCount}
            </span>
          )}
        </button>
        <span className="gp-group-actions">
          <button
            type="button"
            className="gp-icon-btn"
            title="刷新提交记录"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? (
              <Icons.Spinner size={13} className="gp-spin" />
            ) : (
              <Icons.RotateCw size={13} />
            )}
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="gp-group-body">
          {error != null && <div className="gp-group-error">{error}</div>}
          {error == null && loading && commits.length === 0 && (
            <div className="gp-group-empty">
              <Icons.Spinner size={13} className="gp-spin" /> 加载中…
            </div>
          )}
          {error == null &&
            !loading &&
            commits.length === 0 &&
            (collapsed ? null : <div className="gp-group-empty">暂无提交记录</div>)}
          {commits.map((commit) => (
            <div
              key={commit.hash}
              className={`gp-commit-row${commit.unpushed ? ' unpushed' : ''}`}
              onMouseEnter={(e) => handleRowEnter(e, commit)}
              onMouseLeave={handleRowLeave}
            >
              <span className={`gp-commit-dot${commit.unpushed ? ' unpushed' : ''}`} />
              <span className="gp-commit-hash">{commit.shortHash}</span>
              <span className="gp-commit-subject">{commit.subject}</span>
              <span className="gp-commit-meta">
                {commit.unpushed && (
                  <span className="gp-commit-up" title="未推送">
                    ↑
                  </span>
                )}
                <span className="gp-commit-author">{commit.authorName}</span>
                <span className="gp-commit-time">{formatGitRelativeTime(commit.date)}</span>
              </span>
            </div>
          ))}
          {hovered != null && (
            <GitCommitDetailPopover
              commit={hovered.commit}
              anchorEl={hovered.anchorEl}
              onMouseEnter={handlePopoverEnter}
              onMouseLeave={closePopover}
            />
          )}
        </div>
      )}
    </div>
  )
}
