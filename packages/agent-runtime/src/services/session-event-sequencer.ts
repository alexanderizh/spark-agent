import type { AgentEvent } from '@spark/protocol'

interface SequenceRepository {
  nextSeqBySession(sessionId: string): number
}

interface EventWriter {
  insert(params: {
    id: string
    sessionId: string
    turnId?: string
    eventType: string
    eventJson: string
  }): void
}

interface EventBatchWriter {
  insertBatch(
    events: Array<{
      id: string
      sessionId: string
      turnId?: string
      eventType: string
      eventJson: string
    }>,
  ): void
}

export class AgentEventPersistenceError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options)
    this.name = 'AgentEventPersistenceError'
  }
}

export class SessionEventSequencer {
  private readonly nextBySession = new Map<string, number>()

  peek(sessionId: string, repo: SequenceRepository): number {
    const cached = this.nextBySession.get(sessionId)
    if (cached != null) return cached
    const persisted = repo.nextSeqBySession(sessionId)
    this.nextBySession.set(sessionId, persisted)
    return persisted
  }

  reserve(sessionId: string, repo: SequenceRepository, count: number = 1): number {
    const start = this.peek(sessionId, repo)
    this.nextBySession.set(sessionId, start + Math.max(0, count))
    return start
  }

  clear(sessionId: string): void {
    this.nextBySession.delete(sessionId)
  }
}

export function persistAndPublishAgentEvent(
  repo: EventWriter,
  event: AgentEvent,
  publish: (event: AgentEvent) => void,
): void {
  if (isTransientDelta(event)) {
    publish(event)
    return
  }
  try {
    repo.insert(toInsertParams(event))
  } catch (err) {
    throw new AgentEventPersistenceError(
      `Failed to persist ${event.type} event ${event.id}: ${errorMessage(err)}`,
      { cause: err },
    )
  }
  publish(event)
}

export function persistAndPublishAgentEvents(
  repo: EventBatchWriter,
  events: AgentEvent[],
  publish: (event: AgentEvent) => void,
): void {
  const persistentEvents = events.filter((event) => !isTransientDelta(event))
  try {
    if (persistentEvents.length > 0) {
      repo.insertBatch(persistentEvents.map(toInsertParams))
    }
  } catch (err) {
    throw new AgentEventPersistenceError(
      `Failed to persist ${events.length} agent events: ${errorMessage(err)}`,
      { cause: err },
    )
  }
  for (const event of events) publish(event)
}

function isTransientDelta(event: AgentEvent): boolean {
  return (
    (event.type === 'assistant_message' ||
      event.type === 'agent_thinking' ||
      event.type === 'team_member_message' ||
      event.type === 'subagent_message') &&
    'mode' in event &&
    event.mode === 'delta'
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toInsertParams(event: AgentEvent): {
  id: string
  sessionId: string
  turnId?: string
  eventType: string
  eventJson: string
} {
  return {
    id: event.id,
    sessionId: event.sessionId,
    ...(event.turnId != null ? { turnId: event.turnId } : {}),
    eventType: event.type,
    eventJson: JSON.stringify(event),
  }
}
