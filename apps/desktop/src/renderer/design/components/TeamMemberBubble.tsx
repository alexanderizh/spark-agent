/**
 * TeamMemberBubble — 群聊时间线中被调用成员（Member）的消息气泡
 *
 * 设计文档 §5.2：成员作为平级消息输出，左侧方形圆角头像，右侧名称 + 正文。
 * 消息体由调用方作为 children 传入（复用 ChatView 既有的 markdown 渲染）。
 *
 * 点击头像可触发 onOpenDetail（Phase 5 详情抽屉）。
 * 支持右键菜单（与主 agent 气泡对齐）：引用对话 / 复制图片 / 复制内容 / 回复 / 删除。
 */
import {
  Fragment,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Icons } from '../Icons'
import { deriveTeamAvatar } from '../teamAvatar'
import { AvatarImage } from './AvatarImage'

type ContextMenuItem = {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}

function InlineContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`action-menu-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            onClose()
            item.onClick?.()
          }}
        >
          {item.icon ?? <span className="action-menu-item-spacer" />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

export interface TeamMemberBubbleProps {
  memberAgentId: string
  memberName: string
  avatarSrc: string
  children: ReactNode
  origin?: 'host' | 'peer'
  metaLabel?: string
  running?: boolean
  /** 气泡纯文本（用于「复制内容」）；不传则不显示该项。由调用方从 block.content 派生。 */
  textContent?: string
  /** 触发引用 / 回复：带参 = 引用所选文本，不带参 = 回复整条。 */
  onReply?: (selectedText?: string) => void
  /** 删除这条成员消息气泡。 */
  onDelete?: () => void
  /** 点击头像查看该 Member 的本次 dispatch 详情 */
  onOpenDetail?: () => void
}

async function copyImageFromSrc(src: string): Promise<void> {
  const response = await fetch(src)
  const blob = await response.blob()
  const pngBlob = blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/png' })
  await navigator.clipboard.write([new ClipboardItem({ [pngBlob.type]: pngBlob })])
}

/** 判断当前选区是否完整落在 root 内，是则返回选中文本（用于「引用对话」）。
 *  要求 anchor 与 focus 都在 root 内：跨气泡拖选（起点在 A、终点在 B）不应误判为某一气泡内选中。 */
function readSelectedTextWithin(root: HTMLElement): string {
  const selection = window.getSelection?.()
  if (selection == null || selection.isCollapsed) return ''
  const text = selection.toString().trim()
  if (text.length === 0) return ''
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  const contains = (node: Node | null) =>
    node != null && root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode)
  return contains(anchor) && contains(focus) ? text : ''
}

function hasPotentialBodyContent(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node.trim().length > 0
  if (typeof node === 'number') return true
  if (Array.isArray(node)) return node.some((child) => hasPotentialBodyContent(child))
  if (!isValidElement(node)) return false
  if (node.type === Fragment) {
    return hasPotentialBodyContent((node.props as { children?: ReactNode }).children)
  }
  const props = node.props as { children?: ReactNode }
  return props.children === undefined ? true : hasPotentialBodyContent(props.children)
}

export function TeamMemberBubble({
  memberAgentId,
  memberName,
  avatarSrc,
  children,
  origin = 'host',
  metaLabel,
  running = false,
  textContent = '',
  onReply,
  onDelete,
  onOpenDetail,
}: TeamMemberBubbleProps) {
  const avatar = deriveTeamAvatar(memberAgentId, memberName)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [showBody, setShowBody] = useState(() =>
    running || textContent.trim().length > 0 || hasPotentialBodyContent(children),
  )

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    imageSrc?: string
    selectedText?: string
  } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement | null
    const image = target?.closest('img') as HTMLImageElement | null
    const selectedText = readSelectedTextWithin(event.currentTarget)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
      ...(selectedText.length > 0 ? { selectedText } : {}),
    })
  }, [])

  useEffect(() => {
    if (running) {
      setShowBody(true)
      return
    }
    if (textContent.trim().length > 0) {
      setShowBody(true)
      return
    }
    if (bodyRef.current == null) {
      setShowBody(hasPotentialBodyContent(children))
      return
    }
    const renderedText = bodyRef.current.textContent?.replace(/\u200B/g, '').trim() ?? ''
    const hasStructuredContent =
      bodyRef.current.querySelector(
        [
          'img',
          'video',
          'canvas',
          'svg',
          'pre',
          'code',
          'table',
          'ul',
          'ol',
          'blockquote',
          '.document-output-card',
          '.document-output-card-list',
          '.validation-suggestion-card',
          '.workflow-progress',
          '.context-summarized-card',
          '.retry-trail-card',
          '.team-dispatch-card',
        ].join(','),
      ) != null
    setShowBody(renderedText.length > 0 || hasStructuredContent)
  }, [children, running, textContent])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu == null) return []
    const items: ContextMenuItem[] = []
    if (contextMenu.selectedText != null && onReply != null) {
      items.push({
        key: 'quote-selection',
        label: '引用对话',
        icon: <Icons.CornerUpLeft size={14} />,
        onClick: () => onReply(contextMenu.selectedText),
      })
    }
    if (contextMenu.imageSrc != null) {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: <Icons.Image size={14} />,
        onClick: () => {
          if (contextMenu.imageSrc != null)
            void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
        },
      })
    } else if (textContent.length > 0) {
      items.push({
        key: 'copy-text',
        label: '复制内容',
        icon: <Icons.Copy size={14} />,
        onClick: () => {
          void navigator.clipboard.writeText(textContent)
        },
      })
    }
    if (onReply != null) {
      items.push({
        key: 'reply',
        label: '回复',
        icon: <Icons.CornerUpLeft size={14} />,
        onClick: () => onReply(),
      })
    }
    if (onDelete != null) {
      items.push({
        key: 'delete',
        label: '删除',
        icon: <Icons.Trash size={14} />,
        danger: true,
        onClick: onDelete,
      })
    }
    return items
  }, [contextMenu, onDelete, onReply, textContent])

  return (
    <div
      className={`team-member-bubble${origin === 'peer' ? ' is-peer-origin' : ''}`}
      data-origin={origin}
      style={{ ['--member-accent' as string]: avatar.color }}
    >
      <button
        type="button"
        className="team-member-avatar"
        onClick={onOpenDetail}
        title={`查看 ${memberName} 的调用详情`}
        aria-label={`${memberName} 头像`}
      >
        <AvatarImage src={avatarSrc} seed={memberAgentId} name={memberName} />
      </button>
      <div className="team-member-message-main">
        <div className="team-member-bubble-head">
          <span className="team-member-name">{memberName}</span>
          {metaLabel != null && metaLabel.trim().length > 0 && (
            <span className={`team-member-origin-pill ${origin}`}>{metaLabel}</span>
          )}
          {running && (
            <span className="team-member-running" aria-label="正在执行任务">
              <span className="team-member-running-dot" />
              <span>执行中</span>
            </span>
          )}
        </div>
        {/* 复用 msg-content 的 markdown 排版（段落/代码/列表），与主 agent 输出一致 */}
        {showBody && (
          <div
            ref={bodyRef}
            className="team-member-bubble-body msg-content"
            onContextMenu={handleContextMenu}
          >
            {children}
          </div>
        )}
      </div>
      {contextMenu != null && contextMenuItems.length > 0 && (
        <InlineContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      )}
    </div>
  )
}
