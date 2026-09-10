import type { AgentEvent } from '@spark/protocol'
import { MessageBuilder, type UIMessage } from '../../services/event-mapper'
import {
  buildUsageDataFromEvents,
  eventsAfterLastHistoryReset,
  getLatestInputTokens,
  getLatestRuntimeContextSnapshot,
} from './ChatViewUtils'
import type { ContextLedgerState, ContextUsageState, ProjectContextState } from './ChatUsageTypes'

export function retractAgentEvents(
  events: readonly AgentEvent[],
  eventIds: readonly string[],
): { events: AgentEvent[]; builder: MessageBuilder; messages: UIMessage[] } {
  const retracted = new Set(eventIds)
  const retainedEvents = events.filter((event) => !retracted.has(event.id))
  const builder = new MessageBuilder()
  for (const event of retainedEvents) builder.processEvent(event)
  return { events: retainedEvents, builder, messages: builder.getAllMessages() }
}

export function deriveChatHistoryState(events: AgentEvent[]): {
  inputTokens: number
  runtimeContext: ReturnType<typeof getLatestRuntimeContextSnapshot>
  usage: ReturnType<typeof buildUsageDataFromEvents>
  contextUsage: ContextUsageState | null
  contextLedger: ContextLedgerState | null
  projectContext: ProjectContextState | null
} {
  const current = eventsAfterLastHistoryReset(events)
  const contextUsageEvent = findLatestEvent(current, 'context_usage')
  const contextLedgerEvent = findLatestEvent(current, 'context_ledger')
  return {
    inputTokens: getLatestInputTokens(current),
    runtimeContext: getLatestRuntimeContextSnapshot(current),
    usage: buildUsageDataFromEvents(current),
    contextUsage:
      contextUsageEvent == null
        ? null
        : {
            estimatedTokens: contextUsageEvent.estimatedTokens,
            softLimitTokens: contextUsageEvent.softLimitTokens,
            contextWindowTokens: contextUsageEvent.contextWindowTokens,
            compactedThisTurn: contextUsageEvent.compacted,
          },
    contextLedger: contextLedgerEvent == null ? null : toContextLedgerState(contextLedgerEvent),
    projectContext: findLatestEvent(current, 'project_context_loaded'),
  }
}

export function toContextLedgerState(
  event: Extract<AgentEvent, { type: 'context_ledger' }>,
): ContextLedgerState {
  return {
    sections: event.sections,
    totalEstimatedTokens: event.totalEstimatedTokens,
    softLimitTokens: event.softLimitTokens,
    contextWindowTokens: event.contextWindowTokens,
    usagePercent: event.usagePercent,
  }
}

function findLatestEvent<T extends AgentEvent['type']>(
  events: readonly AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === type) return event as Extract<AgentEvent, { type: T }>
  }
  return null
}
