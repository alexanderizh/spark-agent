/**
 * Team Mode 成员头像 / 配色派生（renderer 侧）
 *
 * 实际逻辑下沉到 @spark/shared，供主进程与渲染进程共用，确保同一 agentId
 * 在「群聊气泡 / 花名册」与「team:list-members 的 TeamMemberCard.avatar」
 * 之间得到完全一致的配色。此处仅 re-export。
 */
export { hashAgentId, deriveTeamAvatar, type TeamAvatar } from '@spark/shared'
