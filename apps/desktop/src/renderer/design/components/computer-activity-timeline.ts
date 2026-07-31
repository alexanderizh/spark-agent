import type { ComputerUseEvent } from '@spark/protocol'

export interface ComputerActivityTimeline {
  computerSessionId: string
  events: ComputerUseEvent[]
}

export function mergeComputerActivityEvents(
  current: ComputerUseEvent[],
  incoming: ComputerUseEvent[],
): ComputerUseEvent[] {
  const merged = new Map<string, ComputerUseEvent>()
  for (const event of [...current, ...incoming]) {
    merged.set(`${event.computerSessionId}:${event.seq}`, event)
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.computerSessionId.localeCompare(right.computerSessionId) || left.seq - right.seq,
  )
}

export function groupComputerActivityEvents(
  events: ComputerUseEvent[],
): ComputerActivityTimeline[] {
  const grouped = new Map<string, ComputerUseEvent[]>()
  for (const event of events) {
    const timeline = grouped.get(event.computerSessionId) ?? []
    timeline.push(event)
    grouped.set(event.computerSessionId, timeline)
  }
  return [...grouped.entries()]
    .map(([computerSessionId, timeline]) => ({
      computerSessionId,
      events: timeline.sort((left, right) => left.seq - right.seq),
    }))
    .sort((left, right) => {
      const leftTime = left.events[0]?.timestamp ?? ''
      const rightTime = right.events[0]?.timestamp ?? ''
      return leftTime.localeCompare(rightTime) || left.computerSessionId.localeCompare(right.computerSessionId)
    })
}

export function isTerminalComputerActivityEvent(event: ComputerUseEvent | undefined): boolean {
  return (
    event?.type === 'computer_session_completed' ||
    event?.type === 'computer_session_failed' ||
    event?.type === 'computer_session_canceled'
  )
}
