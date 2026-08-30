// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasPresetNodeOverrides } from './CanvasPresetNodeOverrides'
import { CANVAS_PRESET_TARGETS } from './canvasOperationPresets'
import { buildCanvasPresetTargetGroups } from './canvasPresetCenterModel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CanvasPresetNodeOverrides', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('groups node functions and makes inheritance status explicit', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <CanvasPresetNodeOverrides
          groups={buildCanvasPresetTargetGroups(CANVAS_PRESET_TARGETS)}
          activeTargetId="text_generate"
          hasOverride={(targetId) => targetId === 'storyboard_grid'}
          labelForTarget={(target) => target.label}
          summaryForTarget={(target) =>
            target.id === 'storyboard_grid' ? 'Nano Banana Pro' : '继承对应任务默认'
          }
          onSelect={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('文本节点')
    expect(container.textContent).toContain('图片节点')
    expect(container.textContent).toContain('视频节点')
    expect(container.textContent).toContain('音频节点')
    expect(container.textContent).toContain('继承默认')
    expect(container.textContent).toContain('已单独设置')
  })

  it('selects a node row without creating an override', () => {
    const onSelect = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <CanvasPresetNodeOverrides
          groups={buildCanvasPresetTargetGroups(CANVAS_PRESET_TARGETS)}
          activeTargetId="text_generate"
          hasOverride={() => false}
          labelForTarget={(target) => target.label}
          summaryForTarget={() => '继承对应任务默认'}
          onSelect={onSelect}
        />,
      )
    })

    const imageEdit = container.querySelector<HTMLButtonElement>(
      '[data-preset-target="image_edit"]',
    )
    act(() => imageEdit?.click())

    expect(onSelect).toHaveBeenCalledWith('image_edit')
  })
})
