export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1040
export const SIDEBAR_AUTO_RESTORE_WIDTH = 1120

export type SidebarAutoSyncAction = 'hide' | 'show' | 'none'

interface SidebarAutoSyncInput {
  force?: boolean
  width: number
  previousWidth: number | null
  sidebarHidden: boolean
  fitsWithSidebarVisible: boolean
  collapseWidth?: number
  restoreWidth?: number
}

export function getSidebarAutoSyncAction({
  force = false,
  width,
  previousWidth,
  sidebarHidden,
  fitsWithSidebarVisible,
  collapseWidth = SIDEBAR_AUTO_COLLAPSE_WIDTH,
  restoreWidth = SIDEBAR_AUTO_RESTORE_WIDTH,
}: SidebarAutoSyncInput): SidebarAutoSyncAction {
  if (force || previousWidth == null) {
    if (!sidebarHidden) {
      return width <= collapseWidth || !fitsWithSidebarVisible ? 'hide' : 'none'
    }
    return width >= restoreWidth && fitsWithSidebarVisible ? 'show' : 'none'
  }

  const widthDelta = width - previousWidth
  if (widthDelta === 0) return 'none'

  if (!sidebarHidden) {
    return widthDelta < 0 && (width <= collapseWidth || !fitsWithSidebarVisible) ? 'hide' : 'none'
  }

  return widthDelta > 0 && width >= restoreWidth && fitsWithSidebarVisible ? 'show' : 'none'
}
