import type { AgentEvent } from '@spark/protocol'

type RequestFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (frameId: number) => void

export type LiveAgentEventBufferOptions = {
  onFlush: (events: AgentEvent[]) => void
  requestFrame: RequestFrame
  cancelFrame: CancelFrame
}

export class LiveAgentEventBuffer {
  private readonly pendingById = new Map<string, AgentEvent>()
  private frameId: number | null = null

  constructor(private readonly options: LiveAgentEventBufferOptions) {}

  enqueue(event: AgentEvent): void {
    this.pendingById.set(event.id, event)
    if (this.frameId != null) return
    this.frameId = this.options.requestFrame(() => {
      this.frameId = null
      const events = this.takePending()
      if (events.length > 0) this.options.onFlush(events)
    })
  }

  drainNow(): AgentEvent[] {
    if (this.frameId != null) {
      this.options.cancelFrame(this.frameId)
      this.frameId = null
    }
    return this.takePending()
  }

  clear(): void {
    if (this.frameId != null) {
      this.options.cancelFrame(this.frameId)
      this.frameId = null
    }
    this.pendingById.clear()
  }

  dispose(): void {
    this.clear()
  }

  private takePending(): AgentEvent[] {
    const events = [...this.pendingById.values()].sort(compareAgentEvents)
    this.pendingById.clear()
    return events
  }
}

export function mergeAgentEvents(
  historyEvents: AgentEvent[],
  liveEvents: AgentEvent[],
): AgentEvent[] {
  const byIdentity = new Map<string, AgentEvent>()
  for (const event of [...historyEvents, ...liveEvents]) {
    byIdentity.set(event.id, event)
  }
  return [...byIdentity.values()].sort(compareAgentEvents)
}

export function createAgentEventIdSet(events: AgentEvent[]): Set<string> {
  return new Set(events.map((event) => event.id))
}

export function compareAgentEvents(a: AgentEvent, b: AgentEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq
  const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  if (timeDiff !== 0) return timeDiff
  return a.id.localeCompare(b.id)
}
