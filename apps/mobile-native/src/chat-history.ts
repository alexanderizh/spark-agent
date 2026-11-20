import type { ChatSnapshot, HistoryAnchor } from './ChatCache'
import type { Relay } from './relay'
import { mergeEvents } from './timeline'

const MAX_CATCH_UP_PAGES = 4

type HistoryPage = Awaited<ReturnType<Relay['history']>>

export async function loadHistoryWindow(
  getPage: (beforeSeq?: number) => Promise<HistoryPage>,
  anchor: HistoryAnchor | undefined,
  isCurrent: () => boolean,
) {
  const latest = await getPage()
  let { events, nextBeforeSeq } = latest
  const overlaps = () => !!anchor && events.some((event) => event.id === anchor.id)
  // Live delivery can resume before the latest history request completes. Use a
  // previously confirmed history event as the anchor, never a new live event.
  for (
    let page = 0;
    anchor && page < MAX_CATCH_UP_PAGES && nextBeforeSeq !== null && !overlaps() && isCurrent();
    page += 1
  ) {
    const earlier = await getPage(nextBeforeSeq).catch(() => undefined)
    if (!earlier || !isCurrent()) break
    events = mergeEvents(earlier.events, events)
    nextBeforeSeq = earlier.nextBeforeSeq
  }
  return { events, nextBeforeSeq, running: latest.running, overlaps: overlaps(), anchor }
}

type HistoryWindow = Awaited<ReturnType<typeof loadHistoryWindow>>

export function reconcileHistory(
  previous: ChatSnapshot,
  window: HistoryWindow,
  liveArrived: boolean,
): ChatSnapshot {
  const { events, running } = previous.timeline
  const keepEarlier =
    window.overlaps && (events[0]?.seq ?? Infinity) < (window.events[0]?.seq ?? Infinity)
  const confirmed = window.events.at(-1)
  const tail = confirmed?.seq ?? window.anchor?.seq ?? -1
  // Without overlap only keep live events past the refreshed window. The older
  // cached window is still accessible through the server's backwards cursor.
  return {
    timeline: {
      events: window.overlaps
        ? mergeEvents(events, window.events)
        : mergeEvents(
            window.events,
            events.filter((event) => event.seq > tail),
          ),
      running: liveArrived ? running : window.running,
    },
    nextBeforeSeq: keepEarlier ? previous.nextBeforeSeq : window.nextBeforeSeq,
    historyAnchor: confirmed && { id: confirmed.id, seq: confirmed.seq },
    recentWindow: window.overlaps
      ? previous.recentWindow
      : !!window.anchor && window.nextBeforeSeq !== null,
  }
}
