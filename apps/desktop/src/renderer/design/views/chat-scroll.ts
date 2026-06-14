export const SCROLL_TO_BOTTOM_VISIBILITY_THRESHOLD = 50

export function shouldShowScrollToBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom > SCROLL_TO_BOTTOM_VISIBILITY_THRESHOLD
}
