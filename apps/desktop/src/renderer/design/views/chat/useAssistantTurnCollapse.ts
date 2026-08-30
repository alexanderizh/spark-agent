import { useLayoutEffect, useRef, useState } from 'react'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { projectAssistantTurnCollapse } from './assistant-turn-collapse'

export function useAssistantTurnCollapse(
  status: UIMessage['status'] | undefined,
  blocks: readonly UIBlock[],
): {
  canCollapse: boolean
  expanded: boolean
  visibleBlocks: readonly UIBlock[]
  toggleExpanded: () => void
} {
  const projection = projectAssistantTurnCollapse(status, blocks)
  const wasCollapsibleRef = useRef(projection.canCollapse)
  const [expanded, setExpanded] = useState(() => !projection.canCollapse)

  useLayoutEffect(() => {
    if (projection.canCollapse && !wasCollapsibleRef.current) {
      // 只在整轮从非终态进入可靠 completed 时自动收起。
      setExpanded(false)
    } else if (!projection.canCollapse) {
      setExpanded(true)
    }
    wasCollapsibleRef.current = projection.canCollapse
  }, [projection.canCollapse])

  return {
    canCollapse: projection.canCollapse,
    expanded,
    visibleBlocks: projection.canCollapse && !expanded ? projection.collapsedBlocks : blocks,
    toggleExpanded: () => setExpanded((value) => !value),
  }
}
