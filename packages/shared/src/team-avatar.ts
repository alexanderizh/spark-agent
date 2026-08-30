/**
 * Team Mode 成员头像 / 配色派生（跨进程共享）
 *
 * 设计文档 §5.2.2：基于 agentId hash → HSL（saturation 60%, lightness 55%）。
 * 主进程（team:list-members 构造 TeamMemberCard.avatar）与渲染进程
 * （群聊气泡 / 花名册）共用此逻辑，确保同一 agentId 得到一致配色。
 */

export interface TeamAvatar {
  type: 'initial'
  /** 1 个有意义字符（中英文均可） */
  text: string
  /** HSL 颜色字符串 */
  color: string
}

/** djb2 字符串 hash（稳定、跨进程一致） */
export function hashAgentId(id: string): number {
  let hash = 5381
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33) ^ id.charCodeAt(i)
  }
  return hash >>> 0
}

/** 由 agentId + name 派生确定性头像（首字母 + HSL 配色） */
export function deriveTeamAvatar(agentId: string, name: string): TeamAvatar {
  const trimmed = name.trim()
  const first = trimmed ? Array.from(trimmed)[0]! : '?'
  const hue = hashAgentId(agentId) % 360
  return {
    type: 'initial',
    text: first.toUpperCase(),
    color: `hsl(${hue}, 60%, 55%)`,
  }
}
