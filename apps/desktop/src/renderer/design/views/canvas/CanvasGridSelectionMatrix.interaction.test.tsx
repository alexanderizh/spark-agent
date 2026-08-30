// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasGridSelectionMatrix } from './CanvasGridSelectionMatrix'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderMatrix() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<CanvasGridSelectionMatrix nodeCount={31} columns={6} onChange={vi.fn()} />)
  })
  return container
}

describe('CanvasGridSelectionMatrix interactions', () => {
  it('keeps the dragged rectangle highlighted after mouseup', () => {
    const view = renderMatrix()
    const cells = view.querySelectorAll<HTMLElement>('.canvas-grid-selection-cell')

    act(() => {
      cells[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    act(() => {
      cells[13]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(view.querySelectorAll('.canvas-grid-selection-cell.is-active')).toHaveLength(12)

    act(() => {
      cells[13]?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(view.querySelectorAll('.canvas-grid-selection-cell.is-active')).toHaveLength(12)
  })
})
