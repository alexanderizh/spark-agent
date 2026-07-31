import { randomUUID } from 'node:crypto'

import { ComputerUseEventSchema, type ComputerUseEvent } from '@spark/protocol'
import { createLogger } from '@spark/shared'

const log = createLogger('computer-use-timeline')

/**
 * Timeline event before the store assigns its `id` / `seq` / `timestamp`.
 * Callers (broker) only know the semantic payload + session provenance.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type ComputerUseTimelineInput = DistributiveOmit<
  ComputerUseEvent,
  'id' | 'seq' | 'timestamp'
>

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
  repository?: ComputerUseTimelineRepository
}

export interface ComputerUseTimelineRepository {
  create(input: {
    id: string
    computerSessionId: string
    sessionId: string
    turnId: string
    seq: number
    eventType: string
    event: Record<string, unknown>
    createdAt: string
  }): unknown
  listAfter(
    computerSessionId: string,
    afterSeq: number,
    limit: number,
  ): Array<{ event_json: string }>
  nextSeq(computerSessionId: string): number
}

const DEFAULT_MAX_EVENTS_PER_SESSION = 2_000

interface SessionTimeline {
  /** seq -> event, ordered ascending. */
  readonly events: Map<number, ComputerUseEvent>
  nextSeq: number
}

/**
 * Durable-first Computer Use timeline store with an in-memory live cache. Events are partitioned by
 * `computerSessionId` and ordered by a per-session monotonic `seq`, which is
 * the cursor used by the `computer-use:get-timeline` IPC contract.
 *
 * When a repository is configured, reads replay from SQLite after a main/renderer restart.
 * Persistence failures degrade to the bounded in-memory cache and are logged; timeline
 * infrastructure never turns an otherwise valid governed action into a failure.
 */
export class ComputerUseTimelineStore implements ComputerUseTimelineSink {
  private readonly timelines = new Map<string, SessionTimeline>()
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly maxEventsPerSession: number
  private readonly repository: ComputerUseTimelineRepository | null
  private readonly listeners = new Set<(event: ComputerUseEvent) => void>()

  constructor(options: ComputerUseTimelineStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxEventsPerSession = options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS_PER_SESSION
    this.repository = options.repository ?? null
  }

  record(input: ComputerUseTimelineInput): ComputerUseEvent {
    const session = this.getOrCreateSession(input.computerSessionId)
    const seq = session.nextSeq
    session.nextSeq += 1
    const event = ComputerUseEventSchema.parse({
      ...input,
      id: this.createId(),
      seq,
      timestamp: this.now().toISOString(),
    })
    try {
      this.repository?.create({
        id: event.id,
        computerSessionId: event.computerSessionId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        seq: event.seq,
        eventType: event.type,
        event: event as Record<string, unknown>,
        createdAt: event.timestamp,
      })
    } catch (error) {
      log.warn('Computer Use timeline persistence failed; retaining the live event in memory', {
        computerSessionId: event.computerSessionId,
        seq: event.seq,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    session.events.set(seq, event)
    this.evictIfNeeded(session)
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        log.warn('Computer Use timeline subscriber failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return event
  }

  read(
    computerSessionId: string,
    afterSeq?: number,
    limit?: number,
  ): { events: ComputerUseEvent[]; nextSeq: number | null } {
    if (this.repository != null) {
      try {
        const rows = this.repository.listAfter(
          computerSessionId,
          afterSeq ?? -1,
          limit ?? this.maxEventsPerSession,
        )
        const events = rows.flatMap((row) => {
          try {
            const parsed = ComputerUseEventSchema.safeParse(JSON.parse(row.event_json))
            return parsed.success ? [parsed.data] : []
          } catch {
            return []
          }
        })
        return {
          events,
          nextSeq: events.at(-1)?.seq ?? null,
        }
      } catch (error) {
        log.warn('Computer Use timeline replay failed; falling back to the live cache', {
          computerSessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const session = this.timelines.get(computerSessionId)
    if (session == null) return { events: [], nextSeq: null }

    const cursor = afterSeq ?? -1
    const results: ComputerUseEvent[] = []
    for (const [seq, event] of session.events) {
      if (seq <= cursor) continue
      results.push(event)
      if (limit != null && results.length >= limit) break
    }
    const nextSeq = results.at(-1)?.seq ?? null
    return { events: results, nextSeq }
  }

  clearSession(computerSessionId: string): void {
    this.timelines.delete(computerSessionId)
  }

  clear(): void {
    this.timelines.clear()
  }

  subscribe(listener: (event: ComputerUseEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private getOrCreateSession(computerSessionId: string): SessionTimeline {
    let session = this.timelines.get(computerSessionId)
    if (session == null) {
      let nextSeq = 0
      try {
        nextSeq = this.repository?.nextSeq(computerSessionId) ?? 0
      } catch (error) {
        log.warn('Computer Use timeline sequence lookup failed; starting a live-only timeline', {
          computerSessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      session = {
        events: new Map(),
        nextSeq,
      }
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
