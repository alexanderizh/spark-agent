import type { UIBlock } from '../services/event-mapper'

export function hasVisibleTeamMemberActivityBlocks(
  blocks: UIBlock[],
  showActivityLogs = false,
): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case 'team_member_message':
        return block.content.trim().length > 0
      case 'tool_call':
      case 'terminal':
      case 'file_change':
      case 'thinking':
        return showActivityLogs
      default:
        return true
    }
  })
}

// 团队模式关闭「显示思考与执行日志」时，CSS（.team-mode-active:not(.team-logs-visible) 规则组）
// 会隐藏 host 气泡内的思考与工具活动。此函数在 React 侧按同一口径判断：剔除这些会被隐藏
// （或本就不在主时间轴渲染）的块后，host 的 agent 段是否仍有可见内容；没有则整段不渲染，
// 避免气泡内内容全被 CSS 藏掉后只剩下头像+名称的空壳。
// - terminal / 无 diff 的 file_change 在主时间轴本就不渲染，视为不可见；
// - 带 diff 的 file_change、checkpoint、plan_proposed 由 .diff.hunk-mode / .tool-logs-collapsible 隐藏；
// - error / cancelled / 各类结果卡片（subagent、验证建议等）不受日志开关影响，保持可见。
export function hasVisibleAgentBlocks(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case 'thinking':
      case 'tool_call':
      case 'terminal':
      case 'file_change':
      case 'checkpoint':
      case 'plan_proposed':
        return false
      case 'text':
        return block.content.trim().length > 0
      default:
        return true
    }
  })
}
