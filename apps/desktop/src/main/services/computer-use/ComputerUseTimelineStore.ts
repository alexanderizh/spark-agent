import { randomUUID } from 'node:crypto'

import type { ComputerUseEvent } from '@spark/protocol'

/**
 * Timeline event before the store assigns its `id` / `seq` / `timestamp`.
 * Callers (broker) only know the semantic payload + session provenance.
 */
export type ComputerUseTimelineInput = Omit<ComputerUseEvent, 'id' | 'seq' | 'timestamp'>

/**
 * Sink protocol the broker depends on. Keeping it separate from the concrete
 * store lets tests inject a no-op or spy without spinning up the store.
 */
export interface ComputerUseTimelineSink {
  record(input: ComputerUseTimelineInput): void
}

export interface ComputerUseTimelineStoreOptions {
  /** Identifier factory (overridable in tests). Defaults to crypto.randomUUID. */
  createId?: () => string
  /** Clock (overridable in tests). Defaults to real time. */
  now?: () => Date
  /** Upper bound on events retained per session. Older events are evicted first. */
  maxEventsPerSession?: number
}

const DEFAULT_MAX_EVENTS_PER_SESSION = 2_000

interface SessionTimeline {
  /** seq -> event, ordered ascending. */
  readonly events: Map<number, ComputerUseEvent>
  nextSeq: number
}

/**
 * In-memory Computer Use timeline store. Events are partitioned by
 * `computerSessionId` and ordered by a per-session monotonic `seq`, which is
 * the cursor used by the `computer-use:get-timeline` IPC contract.
 *
 * Persistence is intentionally out of scope for this phase: the timeline is a
 * live operational log, not an audit trail (audit lives in the evidence store).
 * A process restart drops the timeline, which is acceptable for a live view.
 */
export class ComputerUseTimelineStore implements ComputerUseTimelineSink {
  private readonly timelines = new Map<string, SessionTimeline>()
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly maxEventsPerSession: number

  constructor(options: ComputerUseTimelineStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxEventsPerSession = options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS_PER_SESSION
  }

  record(input: ComputerUseTimelineInput): ComputerUseEvent {
    const session = this.getOrCreateSession(input.computerSessionId)
    const seq = session.nextSeq
    session.nextSeq += 1
    const event = { ...input, id: this.createId(), seq, timestamp: this.now().toISOString() } as ComputerUseEvent
    session.events.set(seq, event)
    this.evictIfNeeded(session)
    return event
  }

  read(
    computerSessionId: string,
    afterSeq?: number,
    limit?: number,
  ): { events: ComputerUseEvent[]; nextSeq: number | null } {
    const session = this.timelines.get(computerSessionId)
    if (session == null) return { events: [], nextSeq: null }

    const cursor = afterSeq ?? -1
    const results: ComputerUseEvent[] = []
    for (const [seq, event] of session.events) {
      if (seq <= cursor) continue
      results.push(event)
      if (limit != null && results.length >= limit) break
    }
    const nextSeq = results.length === 0 ? null : results[results.length - 1].seq
    return { events: results, nextSeq }
  }

  clearSession(computerSessionId: string): void {
    this.timelines.delete(computerSessionId)
  }

  clear(): void {
    this.timelines.clear()
  }

  private getOrCreateSession(computerSessionId: string): SessionTimeline {
    let session = this.timelines.get(computerSessionId)
    if (session == null) {
      session = { events: new Map(), nextSeq: 0 }
      this.timelines.set(computerSessionId, session)
    }
    return session
  }

  private evictIfNeeded(session: SessionTimeline): void {
    while (session.events.size > this.maxEventsPerSession) {
      const oldest = session.events.keys().next()
      if (oldest.done === true) break
      session.events.delete(oldest.value)
    }
  }
}
