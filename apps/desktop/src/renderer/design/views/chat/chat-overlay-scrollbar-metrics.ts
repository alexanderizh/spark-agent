export type ChatOverlayScrollMetrics = {
  visible: boolean
  thumbHeight: number
  thumbTop: number
  scrollTop: number
  maxScrollTop: number
}

const MIN_THUMB_HEIGHT = 28

export const EMPTY_CHAT_OVERLAY_SCROLL_METRICS: ChatOverlayScrollMetrics = {
  visible: false,
  thumbHeight: 0,
  thumbTop: 0,
  scrollTop: 0,
  maxScrollTop: 0,
}

export function calculateOverlayScrollbarMetrics({
  viewportHeight,
  contentHeight,
  scrollTop,
  trackHeight,
}: {
  viewportHeight: number
  contentHeight: number
  scrollTop: number
  trackHeight: number
}): ChatOverlayScrollMetrics {
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight)

  if (viewportHeight <= 0 || contentHeight <= viewportHeight + 1 || trackHeight <= 0) {
    return EMPTY_CHAT_OVERLAY_SCROLL_METRICS
  }

  const thumbHeight = Math.min(
    trackHeight,
    Math.max(MIN_THUMB_HEIGHT, (trackHeight * viewportHeight) / contentHeight),
  )
  const travel = Math.max(0, trackHeight - thumbHeight)

  return {
    visible: true,
    thumbHeight,
    thumbTop: maxScrollTop > 0 ? (scrollTop / maxScrollTop) * travel : 0,
    scrollTop,
    maxScrollTop,
  }
}
