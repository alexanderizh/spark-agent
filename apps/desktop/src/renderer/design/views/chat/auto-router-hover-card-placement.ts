/**
 * 「智能路由」悬浮卡片的定位计算（纯函数，可单测）。
 *
 * 卡片 portal 到 document.body 并用 position: fixed 定位，因此这里只做视口坐标
 * 计算：默认贴锚点（菜单里的 router 行）右侧、与行顶部对齐；右侧空间不足翻左侧；
 * 两侧都不足时取空间更大的一侧并把左边界夹在视口内；纵向始终夹在视口内。
 */

export interface AutoRouterHoverCardAnchor {
  left: number
  right: number
  top: number
}

export interface AutoRouterHoverCardSize {
  width: number
  height: number
}

export interface AutoRouterHoverCardViewport {
  width: number
  height: number
}

export interface AutoRouterHoverCardPosition {
  left: number
  top: number
  side: 'right' | 'left'
}

/** 锚点与卡片之间的水平间距。 */
export const AUTO_ROUTER_HOVER_CARD_GAP = 8
/** 卡片与视口边缘的最小留白。 */
export const AUTO_ROUTER_HOVER_CARD_GUTTER = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function computeAutoRouterHoverCardPosition(
  anchor: AutoRouterHoverCardAnchor,
  card: AutoRouterHoverCardSize,
  viewport: AutoRouterHoverCardViewport,
  gap = AUTO_ROUTER_HOVER_CARD_GAP,
  gutter = AUTO_ROUTER_HOVER_CARD_GUTTER,
): AutoRouterHoverCardPosition {
  const maxLeft = viewport.width - gutter - card.width
  const availableRight = viewport.width - anchor.right - gap - gutter
  const availableLeft = anchor.left - gap - gutter

  let side: AutoRouterHoverCardPosition['side']
  if (availableRight >= card.width) {
    side = 'right'
  } else if (availableLeft >= card.width) {
    side = 'left'
  } else {
    // 两侧都放不下：贴空间更大的一侧，再由下面的 clamp 保证不越界。
    side = availableRight >= availableLeft ? 'right' : 'left'
  }

  const preferredLeft = side === 'right' ? anchor.right + gap : anchor.left - gap - card.width
  const maxTop = viewport.height - gutter - card.height
  return {
    side,
    left: clamp(preferredLeft, gutter, maxLeft),
    top: clamp(anchor.top, gutter, maxTop),
  }
}
