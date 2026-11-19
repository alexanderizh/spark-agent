import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'

export function mergeEvents(
  previous: MobileBridgeEvent[],
  incoming: MobileBridgeEvent[],
): MobileBridgeEvent[] {
  const events = new Map(previous.map((event) => [event.id, event]))
  for (const event of incoming) events.set(event.id, event)
  return Array.from(events.values()).sort((a, b) => a.seq - b.seq)
}

export interface Message {
  key: string
  role: 'user' | 'assistant' | 'error'
  text: string
}

export function messages(events: MobileBridgeEvent[]): Message[] {
  const rows = new Map<string, Message>()
  const finalTurns = new Set(
    events
      .filter(
        (event) =>
          event.type === 'assistant_message' &&
          event.isFinal &&
          event.segmentId == null &&
          event.mode !== 'delta',
      )
      .map((event) => event.turnId),
  )
  for (const event of events) {
    if (event.type === 'user_message') {
      rows.set(event.id, { key: event.id, role: 'user', text: event.content ?? '' })
    } else if (event.type === 'assistant_message') {
      const wholeTurn = event.isFinal && event.segmentId == null && event.mode !== 'delta'
      if (!wholeTurn && finalTurns.has(event.turnId)) continue
      const key = JSON.stringify([event.turnId, event.segmentId ?? null])
      const previous = event.mode === 'delta' ? (rows.get(key)?.text ?? '') : ''
      rows.set(key, { key, role: 'assistant', text: previous + (event.content ?? '') })
    } else if (
      event.type === 'agent_error' ||
      (event.type === 'agent_status' && event.status === 'error')
    ) {
      const key = `error:${event.turnId}`
      rows.set(key, { key, role: 'error', text: event.statusMessage ?? '回复失败' })
    }
  }
  return [...rows.values()].filter((row) => row.text.trim())
}
