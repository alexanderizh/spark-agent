import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import {
  isFullBleedCanvasImageNode,
  resolveCanvasImageNodePresentationSize,
} from './canvasImageNodePresentation'

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
    width: 540,
    height: 429,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { url: 'safe-file://character.png' },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('canvas image node presentation', () => {
  it('enables full-bleed presentation only for image nodes with a non-empty URL', () => {
    expect(isFullBleedCanvasImageNode(createNode())).toBe(true)
    expect(isFullBleedCanvasImageNode(createNode({ data: { url: '   ' } }))).toBe(false)
    expect(isFullBleedCanvasImageNode(createNode({ data: {} }))).toBe(false)
    expect(isFullBleedCanvasImageNode(createNode({ type: 'text' }))).toBe(false)
  })

  it('uses source dimensions to correct an existing loaded image node height', () => {
    expect(
      resolveCanvasImageNodePresentationSize(createNode(), { width: 1536, height: 1024 }),
    ).toEqual({ width: 540, height: 360 })
  })

  it('preserves the current node size when source dimensions are unavailable', () => {
    expect(resolveCanvasImageNodePresentationSize(createNode(), undefined)).toEqual({
      width: 540,
      height: 429,
    })
    expect(
      resolveCanvasImageNodePresentationSize(createNode(), { width: 0, height: 1024 }),
    ).toEqual({ width: 540, height: 429 })
  })

  it('returns null for nodes that keep the card layout', () => {
    expect(resolveCanvasImageNodePresentationSize(createNode({ data: {} }), undefined)).toBeNull()
  })
})
