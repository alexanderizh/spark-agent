import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { resolveCanvasAgentContextNodes } from './canvasAgentMessageContext'

function node(id: string): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type: 'text',
    title: id,
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { text: id },
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }
}

describe('resolveCanvasAgentContextNodes', () => {
  it('uses the current selection when there are no explicit references', () => {
    const selected = [node('selected-1'), node('selected-2')]

    expect(resolveCanvasAgentContextNodes([], selected)).toBe(selected)
  })

  it('keeps explicit references higher priority than the current selection', () => {
    const references = [node('reference-1')]
    const selected = [node('selected-1'), node('selected-2')]

    expect(resolveCanvasAgentContextNodes(references, selected)).toBe(references)
  })
})
