/**
 * TeamMemberBubble — 群聊时间线中被调用成员（Member）的消息气泡
 *
 * 设计文档 §5.2：成员作为平级消息输出，左侧方形圆角头像，右侧名称 + 正文。
 * 消息体由调用方作为 children 传入（复用 ChatView 既有的 markdown 渲染）。
 *
 * 点击头像可触发 onOpenDetail（Phase 5 详情抽屉）。
 */
import type { ReactNode } from 'react'
import { deriveTeamAvatar } from '../teamAvatar'
import { AvatarImage } from './AvatarImage'

export interface TeamMemberBubbleProps {
  memberAgentId: string
  memberName: string
  avatarSrc: string
  children: ReactNode
  /** 点击头像查看该 Member 的本次 dispatch 详情 */
  onOpenDetail?: () => void
}

export function TeamMemberBubble({ memberAgentId, memberName, avatarSrc, children, onOpenDetail }: TeamMemberBubbleProps) {
  const avatar = deriveTeamAvatar(memberAgentId, memberName)

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
        </div>
        {/* 复用 msg-content 的 markdown 排版（段落/代码/列表），与主 agent 输出一致 */}
        <div className="team-member-bubble-body msg-content">{children}</div>
      </div>
    </div>
  )
}
