/**
 * TeamMemberBubble — 群聊时间线中被调用成员（Member）的消息气泡
 *
 * 设计文档 §5.2：成员作为平级消息输出，左侧方形圆角头像，右侧名称 + 正文。
 * 消息体由调用方作为 children 传入（复用 ChatView 既有的 markdown 渲染）。
 *
 * 点击头像可触发 onOpenDetail（Phase 5 详情抽屉）。
 * 支持右键菜单：复制内容 / 复制图片。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  running?: boolean
  /** 点击头像查看该 Member 的本次 dispatch 详情 */
  onOpenDetail?: () => void
}

async function copyImageFromSrc(src: string): Promise<void> {
  const response = await fetch(src)
  const blob = await response.blob()
  const pngBlob = blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/png' })
  await navigator.clipboard.write([new ClipboardItem({ [pngBlob.type]: pngBlob })])
}

export function TeamMemberBubble({ memberAgentId, memberName, avatarSrc, children, running = false, onOpenDetail }: TeamMemberBubbleProps) {
  const avatar = deriveTeamAvatar(memberAgentId, memberName)

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    imageSrc?: string
  } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement | null
    const image = target?.closest('img') as HTMLImageElement | null
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
    })
  }, [])

  const textContent = useMemo(() => {
    const body = document.querySelector('.team-member-bubble-body')
    if (body == null) return ''
    return body.textContent?.trim() ?? ''
  }, [contextMenu])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu == null) return []
    const items: ContextMenuItem[] = []
    if (contextMenu.imageSrc != null) {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: <Icons.Image size={14} />,
        onClick: () => {
          if (contextMenu.imageSrc != null) void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
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
    return items
  }, [contextMenu, textContent])

  return (
    <div className="team-member-bubble" style={{ ['--member-accent' as string]: avatar.color }}>
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
          {running && (
            <span className="team-member-running" aria-label="正在执行任务">
              <span className="team-member-running-dot" />
              <span>执行中</span>
            </span>
          )}
        </div>
        {/* 复用 msg-content 的 markdown 排版（段落/代码/列表），与主 agent 输出一致 */}
        <div className="team-member-bubble-body msg-content" onContextMenu={handleContextMenu}>{children}</div>
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
