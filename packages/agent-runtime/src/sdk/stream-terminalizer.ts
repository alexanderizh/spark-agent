import type { AgentEvent } from '@spark/protocol'

type EventBase = Pick<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'>
type TerminalizableEvent =
  | Extract<AgentEvent, { type: 'assistant_message' }>
  | Extract<AgentEvent, { type: 'agent_thinking' }>
  | Extract<AgentEvent, { type: 'team_member_message' }>
  | Extract<AgentEvent, { type: 'subagent_message' }>

type ActiveSegment = {
  event: TerminalizableEvent
  content: string
}

export class StreamTerminalizer {
  private readonly active = new Map<string, ActiveSegment>()
  private readonly order: string[] = []
  private readonly completed = new Set<string>()

  observe(event: AgentEvent): void {
    if (!isTerminalizableEvent(event)) return
    if (
      event.mode === 'complete' &&
      (event.type === 'assistant_message' || event.type === 'team_member_message') &&
      event.isFinal
    ) {
      this.completeActiveScope(event)
    }
    if (event.segmentId == null) return
    const key = segmentKey(event)
    if (event.mode === 'complete') {
      this.active.delete(key)
      this.completed.add(key)
      return
    }
    if (event.content.length === 0 || this.completed.has(key)) return

    const segment = this.active.get(key)
    if (segment == null) {
      this.active.set(key, { event, content: event.content })
      this.order.push(key)
      return
    }
    segment.event = event
    segment.content += event.content
  }

  finalize(makeBase: () => EventBase): AgentEvent[] {
    const events: AgentEvent[] = []
    for (const key of this.order) {
      const segment = this.active.get(key)
      if (segment == null || segment.content.length === 0) continue
      events.push(toCompleteEvent(segment, makeBase()))
      this.completed.add(key)
    }
    this.active.clear()
    this.order.length = 0
    return events
  }

  private completeActiveScope(
    event: Extract<TerminalizableEvent, { type: 'assistant_message' | 'team_member_message' }>,
  ): void {
    for (const [key, segment] of this.active) {
      if (!hasSameCompletionScope(segment.event, event)) continue
      this.active.delete(key)
      this.completed.add(key)
    }
  }
}

function isTerminalizableEvent(event: AgentEvent): event is TerminalizableEvent {
  return (
    event.type === 'assistant_message' ||
    event.type === 'agent_thinking' ||
    event.type === 'team_member_message' ||
    event.type === 'subagent_message'
  )
}

function segmentKey(event: TerminalizableEvent): string {
  if (event.type === 'team_member_message') {
    return JSON.stringify([event.type, event.dispatchId, event.memberAgentId, event.segmentId])
  }
  if (event.type === 'subagent_message') {
    return JSON.stringify([
      event.type,
      event.toolCallId,
      event.contentKind,
      event.segmentId,
    ])
  }
  return JSON.stringify([event.type, event.segmentId])
}

function hasSameCompletionScope(
  active: TerminalizableEvent,
  completed: Extract<TerminalizableEvent, { type: 'assistant_message' | 'team_member_message' }>,
): boolean {
  if (active.type === 'assistant_message') return completed.type === 'assistant_message'
  if (active.type !== 'team_member_message' || completed.type !== 'team_member_message') {
    return false
  }
  return (
    active.dispatchId === completed.dispatchId && active.memberAgentId === completed.memberAgentId
  )
}

function toCompleteEvent(segment: ActiveSegment, base: EventBase): AgentEvent {
  if (segment.event.type === 'agent_thinking') {
    return {
      ...segment.event,
      ...base,
      type: 'agent_thinking',
      mode: 'complete',
      content: segment.content,
    }
  }
  if (segment.event.type === 'assistant_message') {
    return {
      ...segment.event,
      ...base,
      type: 'assistant_message',
      mode: 'complete',
      content: segment.content,
      isFinal: false,
    }
  }
  if (segment.event.type === 'subagent_message') {
    return {
      ...segment.event,
      ...base,
      type: 'subagent_message',
      mode: 'complete',
      content: segment.content,
    }
  }
  return {
    ...segment.event,
    ...base,
    type: 'team_member_message',
    mode: 'complete',
    content: segment.content,
    isFinal: false,
  }
}
