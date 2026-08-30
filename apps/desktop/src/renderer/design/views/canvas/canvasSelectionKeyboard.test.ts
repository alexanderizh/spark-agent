import { describe, expect, it } from 'vitest'
import { shouldClearCanvasSelectionOnEscape } from './canvasSelectionKeyboard'

describe('shouldClearCanvasSelectionOnEscape', () => {
  it('clears a node selection when Escape has no higher-priority canvas menu', () => {
    expect(
      shouldClearCanvasSelectionOnEscape({
        key: 'Escape',
        selectedNodeCount: 3,
        hasOpenContextMenu: false,
        editableTarget: false,
      }),
    ).toBe(true)
  })

  it('lets an open context menu consume Escape first', () => {
    expect(
      shouldClearCanvasSelectionOnEscape({
        key: 'Escape',
        selectedNodeCount: 3,
        hasOpenContextMenu: true,
        editableTarget: false,
      }),
    ).toBe(false)
  })

  it('does not clear selection while editing text', () => {
    expect(
      shouldClearCanvasSelectionOnEscape({
        key: 'Escape',
        selectedNodeCount: 3,
        hasOpenContextMenu: false,
        editableTarget: true,
      }),
    ).toBe(false)
  })
})
