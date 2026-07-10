import type { UIBlock, UIMessage } from '../../services/event-mapper'
import type { TeamMemberEventContext } from '@spark/protocol'

type GetMemberContext = (block: UIBlock) => TeamMemberEventContext | undefined
type AssistantSegment = { kind: string; blocks?: UIBlock[] }
type SplitAssistantBlocks = (blocks: UIBlock[]) => AssistantSegment[]
type IsHostActivityRunning = (blocks: UIBlock[]) => boolean

export function extractRunningTeamMemberIds(
  messages: UIMessage[],
  getMemberContext: GetMemberContext,
): string[] {
  const running = new Set<string>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'team_dispatch') {
        if (block.state === 'pending' || block.state === 'working') running.add(block.memberAgentId)
        continue
      }
      if (block.kind === 'team_member_message') {
        if (block.isStreaming) running.add(block.memberAgentId)
        continue
      }
      const memberContext = getMemberContext(block)
      if (memberContext == null) continue
      if (
        block.kind === 'tool_call' &&
        (block.status === 'pending' || block.status === 'running')
      ) {
        running.add(memberContext.memberAgentId)
      }
      if (block.kind === 'terminal' && block.isStreaming) {
        running.add(memberContext.memberAgentId)
      }
    }
  }
  return Array.from(running)
}

export function extractRunningTeamAgentIds(
  messages: UIMessage[],
  hostAgentId: string | null | undefined,
  hostSessionRunning: boolean,
  getMemberContext: GetMemberContext,
  splitAssistantBlocks: SplitAssistantBlocks,
  isHostActivityRunning: IsHostActivityRunning,
): string[] {
  const running = new Set<string>(extractRunningTeamMemberIds(messages, getMemberContext))
  if (hostAgentId != null && hostSessionRunning) {
    const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (latestAssistant != null) {
      const segments = splitAssistantBlocks(latestAssistant.blocks)
      const latestSegment = [...segments].reverse().find((segment) => segment.kind !== 'team')
      if (latestSegment?.kind === 'agent' && latestSegment.blocks != null) {
        if (isHostActivityRunning(latestSegment.blocks)) running.add(hostAgentId)
      }
    }
  }
  return Array.from(running)
}
