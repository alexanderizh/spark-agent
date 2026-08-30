import { describe, expect, it } from 'vitest'
import { shouldFocusCanvasInlinePanel } from './canvasInlinePanelFocus'

describe('canvas inline panel focus policy', () => {
  it('focuses only when the user explicitly requested focus for the active panel', () => {
    expect(
      shouldFocusCanvasInlinePanel({
        inlinePanelNodeId: 'operation-1',
        requestedNodeId: 'operation-1',
      }),
    ).toBe(true)
  })

  it('does not move the viewport for task status refreshes without an explicit request', () => {
    expect(
      shouldFocusCanvasInlinePanel({
        inlinePanelNodeId: 'operation-1',
        requestedNodeId: null,
      }),
    ).toBe(false)
  })
})
