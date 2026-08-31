import type { UIBlock } from '../../services/event-mapper'
import { isChatActivityBlock } from './ChatActivitySegments'
import { shouldReplaceSessionTaskBlock, type SessionTaskTimelineEntry } from './SessionTaskTimeline'

export type ChatMessageTimelineGroup =
  | { kind: 'content'; key: string; blocks: UIBlock[]; collapsibleOnly: boolean }
  | { kind: 'error'; key: string; block: Extract<UIBlock, { kind: 'error' }> }
  | {
      kind: 'runtime_signal'
      key: string
      block: Extract<UIBlock, { kind: 'runtime_signal' }>
    }

function isControlledByToolLogToggle(
  block: UIBlock,
  sessionTaskEntry?: SessionTaskTimelineEntry | null | undefined,
): boolean {
  // 会渲染为正文任务面板的块不受「思考和工具日志」开关控制：含面板的内容组
  // 不能被标记为 collapsibleOnly，否则用户收起日志时 .msg-content.is-tool-logs-only
  // 会被 CSS 整体隐藏，连任务面板一起消失。
  if (shouldReplaceSessionTaskBlock(block, sessionTaskEntry)) return false
  if (isChatActivityBlock(block)) return true
  return (
    block.kind === 'plan_proposed' ||
    block.kind === 'team_dispatch' ||
    block.kind === 'team_discussion_status'
  )
}

/**
 * Preserve the event order while keeping adjacent regular blocks grouped for
 * the existing text/tool renderer. Diagnostics stay where they first occurred.
 */
export function groupChatMessageTimeline(
  blocks: UIBlock[],
  sessionTaskEntry?: SessionTaskTimelineEntry | null | undefined,
): ChatMessageTimelineGroup[] {
  const groups: ChatMessageTimelineGroup[] = []
  let content: UIBlock[] = []
  let contentStart = 0

  const flushContent = () => {
    if (content.length === 0) return
    groups.push({
      kind: 'content',
      key: `content-${contentStart}`,
      blocks: content,
      collapsibleOnly: content.every((block) =>
        isControlledByToolLogToggle(block, sessionTaskEntry),
      ),
    })
    content = []
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'error') {
      flushContent()
      groups.push({ kind: 'error', key: `error-${index}`, block })
      return
    }
    if (block.kind === 'runtime_signal') {
      flushContent()
      groups.push({ kind: 'runtime_signal', key: `runtime_signal-${index}`, block })
      return
    }
    if (content.length === 0) contentStart = index
    content.push(block)
  })
  flushContent()
  return groups
}
