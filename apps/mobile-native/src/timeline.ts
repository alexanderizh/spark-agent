import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import { sortEvents } from '../../mobile/src/utils/chat-order'
import { applyEvents, emptyTimeline, withServerRunning } from '../../mobile/src/utils/chat-reducer'
import {
  assignTimelineGaps,
  buildTimelineItems,
  collapseFinishedTurns,
  filterExecutionDetails,
} from '../../mobile/src/utils/chat-view'

export type { TimelineItem } from '../../mobile/src/utils/chat-view'

export function mergeEvents(
  previous: MobileBridgeEvent[],
  incoming: MobileBridgeEvent[],
): MobileBridgeEvent[] {
  const byId = new Map(previous.map((event) => [event.id, event]))
  for (const event of incoming) byId.set(event.id, event)
  return sortEvents([...byId.values()])
}

export function reduceTimeline(events: MobileBridgeEvent[], running?: boolean) {
  const timeline = applyEvents(emptyTimeline(), events)
  return running == null ? timeline : withServerRunning(timeline, running)
}

export function timelineRows(
  timeline: ReturnType<typeof reduceTimeline>,
  expandedKeys: Set<string>,
  hideExecution = false,
) {
  return assignTimelineGaps(
    filterExecutionDetails(
      collapseFinishedTurns(buildTimelineItems(timeline.messages), {
        running: timeline.running,
        expandedKeys,
      }),
      hideExecution,
      expandedKeys,
    ),
  )
}
