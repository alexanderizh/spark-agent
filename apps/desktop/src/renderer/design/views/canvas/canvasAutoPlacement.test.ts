import { describe, expect, it } from 'vitest'
import {
  AUTO_NODE_META_BAR_CLEARANCE,
  AUTO_NODE_RIGHT_GAP,
  AUTO_NODE_VERTICAL_GAP,
  placeAutoGridNode,
  placeAutoNodeToRight,
  stackAutoNodesToRight,
} from './canvasAutoPlacement'

describe('canvasAutoPlacement', () => {
  it('places a single auto-created node to the right with toolbar clearance', () => {
    expect(
      placeAutoNodeToRight({
        x: 120,
        y: 80,
        width: 520,
        height: 240,
      }),
    ).toEqual({
      x: 120 + 520 + AUTO_NODE_RIGHT_GAP,
      y: 80 + AUTO_NODE_META_BAR_CLEARANCE,
    })
  })

  it('stacks auto-created nodes vertically with enough gap for the floating meta bar', () => {
    expect(
      stackAutoNodesToRight(
        {
          x: 40,
          y: 60,
          width: 560,
          height: 230,
        },
        [
          { width: 540, height: 340 },
          { width: 540, height: 280 },
        ],
      ),
    ).toEqual([
      {
        x: 40 + 560 + AUTO_NODE_RIGHT_GAP,
        y: 60 + AUTO_NODE_META_BAR_CLEARANCE,
      },
      {
        x: 40 + 560 + AUTO_NODE_RIGHT_GAP,
        y:
          60 +
          AUTO_NODE_META_BAR_CLEARANCE +
          340 +
          AUTO_NODE_VERTICAL_GAP +
          AUTO_NODE_META_BAR_CLEARANCE,
      },
    ])
  })

  it('spaces grid-created nodes by node size plus extra clearance', () => {
    expect(placeAutoGridNode({ x: 100, y: 140 }, { width: 520, height: 240 }, 5, 4)).toEqual({
      x: 100 + (520 + AUTO_NODE_RIGHT_GAP),
      y: 140 + (240 + AUTO_NODE_VERTICAL_GAP + AUTO_NODE_META_BAR_CLEARANCE),
    })
  })
})
