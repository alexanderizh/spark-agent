/**
 * TeamInspectorSection — Inspector 中的「团队成员」区块
 *
 * 设计文档 §5.3：仅在 Session 处于 Team Mode 时显示，位于 Skills 区块上方。
 * - Host 行：不可关闭（灰色 disabled），带 [Host] 徽章。
 * - 成员行：toggle 表示是否允许在当前 Session 被 dispatch。
 * - 「邀请成员」：展开候选 Agent 列表加入。
 * - 高级：允许嵌套调用 + 最大深度。
 *
 * 本组件纯受控（props + 回调）。Phase 1 由 ChatView 本地 state 驱动；
 * Phase 2 起回调改为走 team:update IPC。
 */
import { useState } from 'react'
import { Icons } from '../Icons'
import { deriveTeamAvatar } from '../teamAvatar'
import type { TeamModeConfig } from '@spark/protocol'

export interface TeamInspectorAgent {
  id: string
  name: string
  description: string
  builtIn: boolean
  /** 只读详情（点击成员行展开）：供应商/模型/技能数/MCP 数 */
  providerProfileId?: string | null
  modelId?: string | null
  skillCount?: number
  mcpCount?: number
}

export interface TeamInspectorSectionProps {
  config: TeamModeConfig
  /** 所有可选 Agent（含 Host；本组件内部会把 Host 单列） */
  agents: TeamInspectorAgent[]
  onToggleMember: (agentId: string, enabled: boolean) => void
  onChangeConfig: (patch: Partial<TeamModeConfig>) => void
}

function AgentAvatar({ id, name, builtIn }: { id: string; name: string; builtIn: boolean }) {
  const avatar = deriveTeamAvatar(id, name)
  return (
    <span className="team-roster-avatar" style={{ backgroundColor: avatar.color }}>
      {builtIn ? <Icons.Code size={12} /> : avatar.text}
    </span>
  )
}

export function TeamInspectorSection({ config, agents, onToggleMember, onChangeConfig }: TeamInspectorSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const host = agents.find((a) => a.id === config.hostAgentId)
  const memberSet = new Set(config.memberAgentIds)
  const members = agents.filter((a) => a.id !== config.hostAgentId && memberSet.has(a.id))
  const candidates = agents.filter((a) => a.id !== config.hostAgentId && !memberSet.has(a.id))

  return (
    <div className="inspector-section team-inspector-section">
      <h4 className="config-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="team-inspector-title">
          <Icons.Team size={14} /> 团队成员
          <span className="team-inspector-count">{members.length}</span>
        </span>
        {collapsed ? <Icons.ChevronRight size={14} /> : <Icons.ChevronDown size={14} />}
      </h4>

      {!collapsed && (
        <div className="team-roster">
          {/* Host 行：不可关 */}
          {host != null && (
            <div className="team-roster-row team-roster-row-host">
              <AgentAvatar id={host.id} name={host.name} builtIn={host.builtIn} />
              <span className="team-roster-info">
                <span className="team-roster-name">{host.name}</span>
                {host.description && <span className="team-roster-desc">{host.description.slice(0, 40)}</span>}
              </span>
              <span className="team-roster-host-badge">Host</span>
            </div>
          )}

          {/* 成员行：点击行展开只读详情；toggle 控制是否允许被调 */}
          {members.map((agent) => (
            <div key={agent.id}>
              <div
                className="team-roster-row team-roster-row-clickable"
                onClick={() => setExpandedId((prev) => (prev === agent.id ? null : agent.id))}
              >
                <AgentAvatar id={agent.id} name={agent.name} builtIn={agent.builtIn} />
                <span className="team-roster-info">
                  <span className="team-roster-name">{agent.name}</span>
                  {agent.description && <span className="team-roster-desc">{agent.description.slice(0, 40)}</span>}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={true}
                  className="team-roster-toggle on"
                  title="允许在本会话被调用"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleMember(agent.id, false)
                  }}
                >
                  <span className="team-roster-toggle-knob" />
                </button>
              </div>
              {expandedId === agent.id && (
                <div className="team-roster-detail">
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">模型</span>
                    <span className="team-roster-detail-v">{agent.modelId || '会话默认'}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">供应商</span>
                    <span className="team-roster-detail-v">{agent.providerProfileId || '会话默认'}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">Skills</span>
                    <span className="team-roster-detail-v">{agent.skillCount ?? 0}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">MCP</span>
                    <span className="team-roster-detail-v">{agent.mcpCount ?? 0}</span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {members.length === 0 && <div className="team-roster-empty">尚未邀请成员</div>}

          {/* 邀请成员 */}
          {candidates.length > 0 && (
            <button type="button" className="team-roster-invite" onClick={() => setInviteOpen(!inviteOpen)}>
              <Icons.Plus size={13} /> 邀请成员…
            </button>
          )}
          {inviteOpen && (
            <div className="team-roster-candidates">
              {candidates.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="team-roster-candidate"
                  onClick={() => {
                    onToggleMember(agent.id, true)
                    if (candidates.length === 1) setInviteOpen(false)
                  }}
                >
                  <AgentAvatar id={agent.id} name={agent.name} builtIn={agent.builtIn} />
                  <span className="team-roster-name">{agent.name}</span>
                  <Icons.Plus size={13} className="team-roster-candidate-add" />
                </button>
              ))}
            </div>
          )}

          {/* 高级设置 */}
          <button type="button" className="team-roster-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
            高级 {advancedOpen ? <Icons.ChevronUp size={12} /> : <Icons.ChevronDown size={12} />}
          </button>
          {advancedOpen && (
            <div className="team-roster-advanced">
              <label className="team-roster-advanced-row">
                <input
                  type="checkbox"
                  checked={config.allowNesting}
                  onChange={(e) => onChangeConfig({ allowNesting: e.target.checked })}
                />
                <span>允许 Member 嵌套调用</span>
              </label>
              <label className="team-roster-advanced-row">
                <span>最大深度</span>
                <select
                  value={config.maxDepth}
                  disabled={!config.allowNesting}
                  onChange={(e) => onChangeConfig({ maxDepth: Number(e.target.value) })}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
