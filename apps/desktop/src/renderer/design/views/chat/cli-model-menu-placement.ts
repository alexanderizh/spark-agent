export type CliSubmenuPlacement = 'rightTop' | 'leftTop'

type TriggerHorizontalRect = Pick<DOMRect, 'right'>

const DEFAULT_SUBMENU_WIDTH = 200
const DEFAULT_VIEWPORT_GUTTER = 12
const SUBMENU_OFFSET = 4

export function resolveCliSubmenuPlacement(
  triggerRect: TriggerHorizontalRect,
  viewportWidth: number,
  submenuWidth = DEFAULT_SUBMENU_WIDTH,
  viewportGutter = DEFAULT_VIEWPORT_GUTTER,
): CliSubmenuPlacement {
  const availableRight = viewportWidth - triggerRect.right - SUBMENU_OFFSET - viewportGutter
  return availableRight >= submenuWidth ? 'rightTop' : 'leftTop'
}
