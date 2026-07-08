/**
 * TeamMemberDrawer — 点击成员气泡头像后右侧滑出的详情抽屉（设计文档 §5.5）
 *
 * 展示被调用成员的配置摘要（供应商/模型/Skills/MCP）与本次调用的简要信息，
 * 并提供跳转到 AgentsView 编辑该 Agent 的入口。纯受控组件（open + onClose）。
 */
import { Icons } from '../Icons'
import { AvatarImage } from './AvatarImage'

export interface TeamMemberDrawerInfo {
  agentId: string
  name: string
  description: string
  providerProfileId?: string | null
  modelId?: string | null
  skillCount: number
  mcpCount: number
  avatarSrc: string
}

export interface TeamMemberDrawerProps {
  member: TeamMemberDrawerInfo
  onClose: () => void
  /** 跳转编辑该 Agent（可选） */
  onEditAgent?: (agentId: string) => void
}

export function TeamMemberDrawer({ member, onClose, onEditAgent }: TeamMemberDrawerProps) {
  return (
    <div className="team-member-drawer-backdrop" onClick={onClose}>
      <aside
        className="team-member-drawer"
        role="dialog"
        aria-label={`${member.name} 详情`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="team-member-drawer-head">
          <span className="team-member-drawer-avatar">
            <AvatarImage src={member.avatarSrc} seed={member.agentId} name={member.name} />
          </span>
          <span className="team-member-drawer-title">{member.name}</span>
          <button type="button" className="team-member-drawer-close" onClick={onClose} aria-label="关闭">
            <Icons.X size={16} />
          </button>
        </header>

        {member.description && <p className="team-member-drawer-desc">{member.description}</p>}

        <dl className="team-member-drawer-config">
          <div className="team-member-drawer-row">
            <dt>模型</dt>
            <dd>{member.modelId || '会话默认'}</dd>
          </div>
          <div className="team-member-drawer-row">
            <dt>供应商</dt>
            <dd>{member.providerProfileId || '会话默认'}</dd>
          </div>
          <div className="team-member-drawer-row">
            <dt>Skills</dt>
            <dd>{member.skillCount}</dd>
          </div>
          <div className="team-member-drawer-row">
            <dt>MCP</dt>
            <dd>{member.mcpCount}</dd>
          </div>
        </dl>

        {onEditAgent != null && (
          <button type="button" className="team-member-drawer-edit" onClick={() => onEditAgent(member.agentId)}>
            <Icons.Edit size={13} /> 编辑该 Agent
          </button>
        )}
      </aside>
    </div>
  )
}
