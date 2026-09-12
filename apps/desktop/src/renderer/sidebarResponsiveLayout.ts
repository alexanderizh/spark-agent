export const SIDEBAR_INLINE_CONTENT_MIN_WIDTH = 500

export function shouldOverlaySidebar({
  viewportWidth,
  sidebarWidth,
  sidebarGutter,
  contentMinWidth = SIDEBAR_INLINE_CONTENT_MIN_WIDTH,
}: {
  viewportWidth: number
  sidebarWidth: number
  sidebarGutter: number
  contentMinWidth?: number
}): boolean {
  return viewportWidth - sidebarWidth - sidebarGutter < contentMinWidth
}
