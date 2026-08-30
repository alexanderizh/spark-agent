/**
 * MentionPopover — Composer @ Agent 补全弹窗
 *
 * 团队模式下，用户在输入框中键入 `@` 时弹出，列出 Host + 启用的 Members。
 * - 键盘：↑/↓ 移光标；Enter / Tab 选中；Esc 关闭。
 * - 鼠标：点击选中；hover 同步高亮。
 * - 过滤：query 匹配 name / description / agentId（case-insensitive includes）。
 */
import { useEffect, useMemo, useRef } from 'react'
import { AvatarImage } from './AvatarImage'
import { deriveTeamAvatar } from '../teamAvatar'
import './MentionPopover.less'

export interface MentionCandidate {
  agentId: string
  name: string
  description: string
  isHost: boolean
  avatarSrc: string
  builtIn: boolean
}

export interface MentionPopoverProps {
  open: boolean
  /** 浮层定位锚点（相对 viewport，由 caret 坐标计算） */
  anchor: { left: number; top: number } | null
  query: string
  candidates: MentionCandidate[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (candidate: MentionCandidate) => void
}

const POPOVER_MIN_WIDTH = 280
const POPOVER_MAX_WIDTH = 360
const POPOVER_MAX_HEIGHT = 320

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return candidates
  return candidates.filter((c) => {
    return (
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.agentId.toLowerCase().includes(q)
    )
  })
}

export function MentionPopover({
  open,
  anchor,
  query,
  candidates,
  activeIndex,
  onHover,
  onSelect,
}: MentionPopoverProps) {
  const filtered = useMemo(() => filterMentionCandidates(candidates, query), [candidates, query])
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // 选中项滚到可视区
  useEffect(() => {
    if (!open) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  if (!open || anchor == null) return null

  // 视口边界保护：避免浮层溢出
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - POPOVER_MAX_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.top, viewportHeight - POPOVER_MAX_HEIGHT - 8))

  return (
    <div
      className="mention-popover"
      role="listbox"
      aria-label="选择 Agent"
      style={{
        position: 'fixed',
        left,
        top,
        minWidth: POPOVER_MIN_WIDTH,
        maxWidth: POPOVER_MAX_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
      }}
      onMouseDown={(e) => {
        // 阻止 textarea 失焦
        e.preventDefault()
      }}
    >
      {filtered.length === 0 ? (
        <div className="mention-popover-empty">没有匹配的 Agent</div>
      ) : (
        filtered.map((c, index) => {
          const avatar = deriveTeamAvatar(c.agentId, c.name)
          const isActive = index === activeIndex
          return (
            <button
              key={c.agentId}
              type="button"
              ref={isActive ? activeRef : null}
              className={`mention-popover-item${isActive ? ' is-active' : ''}`}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(c)}
              style={{ ['--member-accent' as string]: avatar.color }}
              title={c.description || c.name}
            >
              <span className="mention-popover-avatar">
                <AvatarImage src={c.avatarSrc} seed={c.agentId} name={c.name} />
              </span>
              <span className="mention-popover-text">
                <span className="mention-popover-name">{c.name}</span>
                {c.description.trim().length > 0 && (
                  <span className="mention-popover-desc">{c.description.trim()}</span>
                )}
              </span>
              {c.isHost && <span className="mention-popover-badge">主持</span>}
            </button>
          )
        })
      )}
    </div>
  )
}
