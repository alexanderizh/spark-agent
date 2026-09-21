import { describe, expect, it } from 'vitest'

import {
  AUTO_ROUTER_HOVER_CARD_GAP,
  AUTO_ROUTER_HOVER_CARD_GUTTER,
  computeAutoRouterHoverCardPosition,
} from './auto-router-hover-card-placement'

const card = { width: 300, height: 160 }
const viewport = { width: 1200, height: 800 }

describe('computeAutoRouterHoverCardPosition', () => {
  it('sits to the right of the anchor when there is room', () => {
    const position = computeAutoRouterHoverCardPosition(
      { left: 600, right: 820, top: 200 },
      card,
      viewport,
    )
    expect(position.side).toBe('right')
    expect(position.left).toBe(820 + AUTO_ROUTER_HOVER_CARD_GAP)
    expect(position.top).toBe(200)
  })

  it('flips to the left when the right side cannot fit the card', () => {
    const position = computeAutoRouterHoverCardPosition(
      { left: 900, right: 1100, top: 120 },
      card,
      viewport,
    )
    expect(position.side).toBe('left')
    expect(position.left).toBe(900 - AUTO_ROUTER_HOVER_CARD_GAP - card.width)
  })

  it('clamps inside the viewport when neither side fits', () => {
    const narrow = { width: 600, height: 800 }
    const position = computeAutoRouterHoverCardPosition(
      { left: 200, right: 500, top: 40 },
      card,
      narrow,
    )
    // 两侧都放不下：贴空间更大的一侧（左侧 184 > 右侧 84），左边界夹进视口
    expect(position.side).toBe('left')
    expect(position.left).toBe(AUTO_ROUTER_HOVER_CARD_GUTTER)
  })

  it('clamps the vertical position into the viewport', () => {
    const bottom = computeAutoRouterHoverCardPosition(
      { left: 300, right: 500, top: 780 },
      card,
      viewport,
    )
    expect(bottom.top).toBe(viewport.height - AUTO_ROUTER_HOVER_CARD_GUTTER - card.height)

    const top = computeAutoRouterHoverCardPosition(
      { left: 300, right: 500, top: -20 },
      card,
      viewport,
    )
    expect(top.top).toBe(AUTO_ROUTER_HOVER_CARD_GUTTER)
  })

  it('keeps the gutter when the card is taller than the viewport', () => {
    const position = computeAutoRouterHoverCardPosition(
      { left: 300, right: 500, top: 300 },
      { width: 300, height: 900 },
      viewport,
    )
    expect(position.top).toBe(AUTO_ROUTER_HOVER_CARD_GUTTER)
  })
})
