/**
 * GitCommitDetailPopover —— 提交行悬浮详情浮层。
 *
 * createPortal 到 document.body（逃逸 gp-scroll 的 overflow 裁剪），position: fixed
 * 由 computeGitCommitPopoverPosition 定位：常态在行右侧（编辑区上方），空间不足翻左侧。
 * 样式走全局 design token（html[data-theme] 已为 body 端口组件声明主题变量），
 * 不依赖 .code-viewer-panel 作用域内的 --cv-* 变量。
 *
 * 悬停接力：行 leave → 延时关闭，指针进入浮层即取消（父组件管开合，这里只回调）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceGitCommitEntry } from '@spark/protocol'
import { Icons } from '../../../Icons'
import {
  computeGitCommitPopoverPosition,
  formatGitCommitAbsoluteTime,
  formatGitRelativeTime,
  type GitCommitPopoverPosition,
} from './gitPanelViewUtils'

const COPY_FEEDBACK_MS = 1200

export interface GitCommitDetailPopoverProps {
  commit: WorkspaceGitCommitEntry
  /** 锚点提交行元素（定位基准） */
  anchorEl: HTMLElement
  /** 指针进入浮层（取消父组件的延时关闭） */
  onMouseEnter: () => void
  /** 指针离开浮层（立即关闭） */
  onMouseLeave: () => void
}

export function GitCommitDetailPopover({
  commit,
  anchorEl,
  onMouseEnter,
  onMouseLeave,
}: GitCommitDetailPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // 先隐形渲染量尺寸，layout effect 里定位后再显示，避免首帧闪现在错误位置
  const [position, setPosition] = useState<GitCommitPopoverPosition | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = popoverRef.current
    if (el == null) return
    const rect = el.getBoundingClientRect()
    const anchorRect = anchorEl.getBoundingClientRect()
    setPosition(
      computeGitCommitPopoverPosition(
        { left: anchorRect.left, right: anchorRect.right, top: anchorRect.top },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [anchorEl, commit])

  // 卸载时清理复制反馈计时器，避免 setState 打到已卸载组件
  useEffect(() => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const handleCopyHash = useCallback((): void => {
    // 剪贴板不可用时静默失败（Electron 渲染进程常态可用），不弹未处理 rejection
    void navigator.clipboard
      .writeText(commit.hash)
      .then(() => {
        setCopied(true)
        if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
      })
      .catch(() => {})
  }, [commit.hash])

  const refs = commit.refs?.split(',').map((ref) => ref.trim()).filter(Boolean) ?? []

  const renderBody = (
    <div
      ref={popoverRef}
      className="gp-cpop"
      style={position == null ? { visibility: 'hidden' } : { left: position.left, top: position.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="tooltip"
    >
      <div className="gp-cpop-head">
        <span className="gp-cpop-short">{commit.shortHash}</span>
        <span className="gp-cpop-hash" title={commit.hash}>
          {commit.hash}
        </span>
        <button
          type="button"
          className="gp-cpop-copy"
          title={copied ? '已复制' : '复制完整 hash'}
          onClick={handleCopyHash}
        >
          {copied ? <Icons.Check size={13} /> : <Icons.Copy size={13} />}
        </button>
      </div>
      {refs.length > 0 && (
        <div className="gp-cpop-refs">
          {refs.map((ref) => (
            <span key={ref} className="gp-cpop-ref">
              {ref}
            </span>
          ))}
        </div>
      )}
      <div className="gp-cpop-message">
        <div className="gp-cpop-subject">{commit.subject}</div>
        {commit.body != null && commit.body.length > 0 && (
          <div className="gp-cpop-body">{commit.body}</div>
        )}
      </div>
      <div className="gp-cpop-meta">
        <span className="gp-cpop-author">
          {commit.authorName}
          {commit.authorEmail != null && commit.authorEmail.length > 0 && (
            <span className="gp-cpop-email"> &lt;{commit.authorEmail}&gt;</span>
          )}
        </span>
        <span className="gp-cpop-time">
          {formatGitCommitAbsoluteTime(commit.date)}
          <span className="gp-cpop-reltime"> · {formatGitRelativeTime(commit.date)}</span>
          {commit.unpushed && <span className="gp-cpop-unpushed"> · 未推送</span>}
        </span>
      </div>
    </div>
  )

  return createPortal(renderBody, document.body)
}
