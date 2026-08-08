// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveCanvasPaneContextMenuBoundary } from './canvasPaneContextMenuBoundary'

describe('resolveCanvasPaneContextMenuBoundary', () => {
  it('uses the explicit stage when a portal makes the menu a stage sibling', () => {
    const stage = document.createElement('div')
    stage.className = 'canvas-stage'
    const portalHost = document.createElement('div')
    const trigger = document.createElement('button')
    portalHost.append(trigger)

    expect(trigger.closest('.canvas-stage')).toBeNull()
    expect(resolveCanvasPaneContextMenuBoundary(stage, trigger)).toBe(stage)
  })

  it('keeps the ancestor lookup fallback for menus rendered inside the stage', () => {
    const stage = document.createElement('div')
    stage.className = 'canvas-stage'
    const trigger = document.createElement('button')
    stage.append(trigger)

    expect(resolveCanvasPaneContextMenuBoundary(null, trigger)).toBe(stage)
  })
})
