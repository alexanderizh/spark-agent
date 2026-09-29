import type { TeamMemberEventContext } from '@spark/protocol'
import type { UIBlock } from '../../services/event-mapper'

/**
 * 助手消息时间线分段（ChatView 抽出，供单测覆盖归并行为）。
 *
 * 一条 assistant message 的 blocks 按「归属」切成有序 segment：
 *   - agent：host 自己的块（仅连续时合并，保持 host 追问在底部新开气泡）
 *   - team：dispatch 调用卡片
 *   - team_peer / team_round_divider / team_discussion_status：讨论类单块
 *   - team_member_activity：同一 (dispatchId, memberAgentId) 的成员活动
 *
 * 成员活动按 key **全局归并**：并行成员的块在时间线上交错时，同一成员的
 * 全部块收敛到首次出现处的一个气泡，不再被其他成员的块拆散（仅不同
 * dispatch、明确的新一轮输出才新开气泡）。running 态由同 key 的 dispatch
 * 卡片状态 + 块级流式状态联合推导。
 */

export type AssistantMessageSegment =
  | { kind: 'agent'; blocks: UIBlock[] }
  | { kind: 'team'; blocks: UIBlock[] }
  | { kind: 'team_peer'; block: Extract<UIBlock, { kind: 'team_peer_message' }> }
  | { kind: 'team_round_divider'; block: Extract<UIBlock, { kind: 'team_round_divider' }> }
  | { kind: 'team_discussion_status'; block: Extract<UIBlock, { kind: 'team_discussion_status' }> }
  | {
      kind: 'team_member_activity'
      memberContext: TeamMemberEventContext
      blocks: UIBlock[]
      running: boolean
    }

export function splitAssistantMessageBlocks(blocks: readonly UIBlock[]): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  const latestTeamMemberSegments = new Map<
    string,
    Extract<AssistantMessageSegment, { kind: 'team_member_activity' }>
  >()
  const runningDispatches = new Set<string>()
  const terminalDispatches = new Set<string>()
  // Preserve timeline order for host blocks: they only merge while contiguous.
  // This keeps host follow-up after member output visible as a new bubble at the bottom.
  const ensureAgentSegment = () => {
    const previous = segments.at(-1)
    if (previous?.kind === 'agent') {
      return previous
    }
    const segment: Extract<AssistantMessageSegment, { kind: 'agent' }> = {
      kind: 'agent',
      blocks: [],
    }
    segments.push(segment)
    return segment
  }

  for (const block of blocks) {
    if (isHiddenTimelineBlock(block)) continue
    if (block.kind === 'team_dispatch') {
      const key = teamMemberContextKey({
        dispatchId: block.dispatchId,
        memberAgentId: block.memberAgentId,
      })
      const isRunning = block.state === 'pending' || block.state === 'working'
      if (isRunning) {
        runningDispatches.add(key)
        terminalDispatches.delete(key)
      } else {
        runningDispatches.delete(key)
        terminalDispatches.add(key)
      }
      const segment = latestTeamMemberSegments.get(key)
      if (segment != null)
        segment.running =
          isRunning || (!terminalDispatches.has(key) && isTeamMemberActivityRunning(segment.blocks))
      segments.push({ kind: 'team', blocks: [block] })
      continue
    }
    if (block.kind === 'team_peer_message') {
      segments.push({ kind: 'team_peer', block })
      continue
    }
    if (block.kind === 'team_round_divider') {
      segments.push({ kind: 'team_round_divider', block })
      continue
    }
    if (block.kind === 'team_discussion_status') {
      segments.push({ kind: 'team_discussion_status', block })
      continue
    }
    const memberContext = getBlockTeamMemberContext(block)
    if (memberContext != null) {
      const key = teamMemberContextKey(memberContext)
      // 同 key 全局归并：并行成员交错输出时收敛到首段，不再被拆散成多个气泡。
      let segment = latestTeamMemberSegments.get(key)
      if (segment == null) {
        segment = {
          kind: 'team_member_activity',
          memberContext,
          blocks: [],
          running: runningDispatches.has(key),
        }
        segments.push(segment)
      }
      latestTeamMemberSegments.set(key, segment)
      segment.blocks.push(block)
      segment.running =
        runningDispatches.has(key) ||
        (!terminalDispatches.has(key) && isTeamMemberActivityRunning(segment.blocks))
      continue
    }
    ensureAgentSegment().blocks.push(block)
  }
  return segments
}

export function teamMemberContextKey(context: TeamMemberEventContext): string {
  return `${context.dispatchId}:${context.memberAgentId}`
}

export function isHiddenTimelineBlock(block: UIBlock): boolean {
  return (
    block.kind === 'tool_call' &&
    (block.toolName === 'mcp__spark_team__agent_dispatch' ||
      block.toolName.toLowerCase().endsWith('present_files'))
  )
}

export function getBlockTeamMemberContext(block: UIBlock): TeamMemberEventContext | undefined {
  if (block.kind === 'team_member_message') {
    return {
      dispatchId: block.dispatchId,
      memberAgentId: block.memberAgentId,
      ...(block.autoRouter != null ? { autoRouter: block.autoRouter } : {}),
    }
  }
  if (
    block.kind === 'thinking' ||
    block.kind === 'tool_call' ||
    block.kind === 'terminal' ||
    block.kind === 'file_change'
  ) {
    return block.teamMemberContext
  }
  return undefined
}

export function isHostActivityRunning(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    if (getBlockTeamMemberContext(block) != null) return false
    if (block.kind === 'text' || block.kind === 'thinking') return block.isStreaming
    if (block.kind === 'tool_call') return block.status === 'pending' || block.status === 'running'
    if (block.kind === 'terminal') return block.isStreaming
    if (block.kind === 'subagent') return block.status === 'running'
    return false
  })
}

/** 同 key 成员段是否仍有流式活动（dispatch 卡片状态之外的块级兜底）。 */
function isTeamMemberActivityRunning(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'team_member_message') return block.isStreaming
    if (block.kind === 'tool_call') return block.status === 'pending' || block.status === 'running'
    if (block.kind === 'terminal') return block.isStreaming
    return false
  })
}
