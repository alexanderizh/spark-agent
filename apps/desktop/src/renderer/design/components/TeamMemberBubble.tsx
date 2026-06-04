/**
 * TeamMemberBubble — 群聊时间线中被调用成员（Member）的消息气泡
 *
 * 设计文档 §5.2：左对齐但缩进 32px，左侧 4px 色条用 --member-accent（member 配色），
 * 头像 + 名称 + 「· 被调用」徽章。消息体由调用方作为 children 传入（复用 ChatView
 * 既有的 markdown 渲染），本组件只负责群聊外观（avatar / 缩进 / 色条 / 徽章）。
 *
 * 点击头像可触发 onOpenDetail（Phase 5 详情抽屉）。
 */
import type { ReactNode } from 'react'
import { deriveTeamAvatar } from '../teamAvatar'

export interface TeamMemberBubbleProps {
  memberAgentId: string
  memberName: string
  children: ReactNode
  /** 点击头像查看该 Member 的本次 dispatch 详情 */
  onOpenDetail?: () => void
}

export function TeamMemberBubble({ memberAgentId, memberName, children, onOpenDetail }: TeamMemberBubbleProps) {
  const avatar = deriveTeamAvatar(memberAgentId, memberName)

  return (
    <div className="team-member-bubble" style={{ ['--member-accent' as string]: avatar.color }}>
      <div className="team-member-bubble-head">
        <button
          type="button"
          className="team-member-avatar"
          style={{ backgroundColor: avatar.color }}
          onClick={onOpenDetail}
          title={`查看 ${memberName} 的调用详情`}
          aria-label={`${memberName} 头像`}
        >
          {avatar.text}
        </button>
        <span className="team-member-name">{memberName}</span>
        <span className="team-member-badge">· 被调用</span>
      </div>
      <div className="team-member-bubble-body">{children}</div>
    </div>
  )
}
