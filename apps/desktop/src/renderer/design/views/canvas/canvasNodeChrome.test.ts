import { describe, expect, it } from 'vitest'
import {
  CANVAS_NODE_CONTENT_TITLE_HEIGHT,
  CANVAS_NODE_QUICK_FOOTER_HEIGHT,
  canvasNodeChromeExtraHeight,
  canvasNodeHasStandaloneActionFooter,
  resolveCanvasNodeMetaLabel,
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
  it('keeps regular text nodes on the structured card frame', () => {
    const expected = CANVAS_NODE_CONTENT_TITLE_HEIGHT + CANVAS_NODE_QUICK_FOOTER_HEIGHT
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'text' }))).toBe(expected)
  })

  it('keeps loaded and empty image/video nodes on the same flat media frame', () => {
    expect(canvasNodeChromeExtraHeight(createNode())).toBe(0)
    expect(
      canvasNodeChromeExtraHeight(createNode({ data: { url: 'safe-file://image.png' } })),
    ).toBe(0)
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'video' }))).toBe(0)
    expect(
      canvasNodeChromeExtraHeight(
        createNode({ type: 'video', data: { url: 'safe-file://clip.mp4' } }),
      ),
    ).toBe(0)
  })

  it('does not reserve the footer removed from operation nodes', () => {
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'text_to_image' }))).toBe(0)
    expect(
      canvasNodeChromeExtraHeight(
        createNode({ type: 'extract_audio', data: { operation: 'extract_audio' } }),
      ),
    ).toBe(0)
  })

  it('only includes the footer for group and shot script nodes', () => {
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

  it('does not reserve a duplicate content title for audio resources', () => {
    expect(canvasNodeChromeExtraHeight(createNode({ type: 'audio' }))).toBe(
      CANVAS_NODE_QUICK_FOOTER_HEIGHT,
    )
  })

  it('uses storyboard chrome for a split node containing one shot', () => {
    expect(
      canvasNodeChromeExtraHeight(
        createNode({ type: 'text', data: { text: SINGLE_SHOT_STORYBOARD } }),
      ),
    ).toBe(CANVAS_NODE_QUICK_FOOTER_HEIGHT)
  })
})

describe('resolveCanvasNodeMetaLabel', () => {
  it('shows an image node title in the top-left meta bar', () => {
    expect(resolveCanvasNodeMetaLabel(createNode({ title: '关键帧 01' }), '图片')).toBe('关键帧 01')
  })

  it('falls back to the type label when an image has no title', () => {
    expect(resolveCanvasNodeMetaLabel(createNode({ title: '  ' }), '图片')).toBe('图片')
  })

  it('keeps non-image nodes on their existing type label', () => {
    expect(
      resolveCanvasNodeMetaLabel(createNode({ type: 'video', title: '视频剪辑' }), '视频'),
    ).toBe('视频')
  })
})

describe('canvasNodeHasStandaloneActionFooter', () => {
  it('does not cover the controls of a loaded standalone video node', () => {
    expect(
      canvasNodeHasStandaloneActionFooter(
        createNode({ type: 'video', data: { url: 'safe-file://clip.mp4' } }),
      ),
    ).toBe(false)
  })

  it('keeps the action footer for empty video and non-video nodes', () => {
    expect(canvasNodeHasStandaloneActionFooter(createNode({ type: 'video' }))).toBe(true)
    expect(canvasNodeHasStandaloneActionFooter(createNode({ type: 'audio' }))).toBe(true)
    expect(canvasNodeHasStandaloneActionFooter(createNode({ type: 'text' }))).toBe(true)
  })

  it('keeps image and operation node behavior unchanged', () => {
    expect(canvasNodeHasStandaloneActionFooter(createNode({ type: 'image' }))).toBe(false)
    expect(canvasNodeHasStandaloneActionFooter(createNode({ type: 'text_to_image' }))).toBe(false)
  })
})
