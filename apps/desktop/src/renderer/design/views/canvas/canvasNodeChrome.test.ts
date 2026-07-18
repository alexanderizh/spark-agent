import { describe, expect, it } from 'vitest'
import {
  CANVAS_NODE_CONTENT_TITLE_HEIGHT,
  CANVAS_NODE_QUICK_FOOTER_HEIGHT,
  canvasNodeChromeExtraHeight,
} from './canvasNodeChrome'
import type { CanvasNode } from './canvas.types'

const SINGLE_SHOT_STORYBOARD = [
  '| 镜号 | 景别 | 画面/动作 |',
  '| --- | --- | --- |',
  '| 1 | 远景 | 城市夜景 |',
].join('\n')

function createNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    title: 'Image',
    x: 0,
    y: 0,
    width: 460,
    height: 300,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('canvasNodeChromeExtraHeight', () => {
  it('includes the content title and footer for media and regular text nodes', () => {
    const expected = CANVAS_NODE_CONTENT_TITLE_HEIGHT + CANVAS_NODE_QUICK_FOOTER_HEIGHT
    expect(canvasNodeChromeExtraHeight(createNode())).toBe(expected)
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'text' }))).toBe(expected)
  })

  it('does not add layout chrome to an image node with loaded content', () => {
    expect(
      canvasNodeChromeExtraHeight(
        createNode({ type: 'image', data: { url: 'safe-file://character.png' } }),
      ),
    ).toBe(0)
  })

  it('only includes the footer for operation, group, and shot script nodes', () => {
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'text_to_image' }))).toBe(
      CANVAS_NODE_QUICK_FOOTER_HEIGHT,
    )
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'group' }))).toBe(
      CANVAS_NODE_QUICK_FOOTER_HEIGHT,
    )
    expect(
      canvasNodeChromeExtraHeight(
        createNode({
          type: 'text',
          data: {
            text: JSON.stringify({
              segments: [
                { shot: '1', description: '远景' },
                { shot: '2', description: '近景' },
              ],
            }),
          },
        }),
      ),
    ).toBe(CANVAS_NODE_QUICK_FOOTER_HEIGHT)
  })

  it('uses storyboard chrome for a split node containing one shot', () => {
    expect(
      canvasNodeChromeExtraHeight(
        createNode({ type: 'text', data: { text: SINGLE_SHOT_STORYBOARD } }),
      ),
    ).toBe(CANVAS_NODE_QUICK_FOOTER_HEIGHT)
  })
})
