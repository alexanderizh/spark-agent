/**
 * Team Mode 成员头像 / 配色派生
 *
 * 设计文档 §5.2.2：基于 agentId hash → HSL（saturation 60%, lightness 55%）。
 * Host 使用默认主题色（不走此函数）。
 *
 * 该派生是确定性的：同一 agentId 永远得到同一配色，便于群聊时间线中
 * 用稳定的色条 / 头像区分不同成员（--member-accent）。
 */

export interface TeamAvatar {
  type: 'initial'
  /** 1–2 个字符的首字母 */
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

/** 取名称首个有意义字符作为头像文字（支持中英文） */
function deriveInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // 英文/数字取首字母大写；CJK 取首字
  const first = Array.from(trimmed)[0]!
  return first.toUpperCase()
}

/** 由 agentId + name 派生确定性头像（首字母 + HSL 配色） */
export function deriveTeamAvatar(agentId: string, name: string): TeamAvatar {
  const hue = hashAgentId(agentId) % 360
  return {
    type: 'initial',
    text: deriveInitial(name),
    color: `hsl(${hue}, 60%, 55%)`,
  }
}
