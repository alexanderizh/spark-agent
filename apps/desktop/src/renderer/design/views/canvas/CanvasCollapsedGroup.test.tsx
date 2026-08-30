// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasCollapsedGroup } from './CanvasCollapsedGroup'
import type { CanvasCollapsedGroupPresentation } from './canvasGroupCollapse'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

async function mountCollapsedGroup() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  const onRename = vi.fn().mockResolvedValue(undefined)
  const onColorChange = vi.fn()
  const onExpand = vi.fn()
  const onParentDoubleClick = vi.fn()
  const presentation: CanvasCollapsedGroupPresentation = {
    childCount: 4,
    previews: [
      { kind: 'fallback', slot: 0 },
      { kind: 'fallback', slot: 1 },
    ],
    size: { width: 420, height: 360 },
    color: 'blue',
  }

  await act(async () => {
    root.render(
      <div onDoubleClick={onParentDoubleClick}>
        <CanvasCollapsedGroup
          nodeId="group-1"
          title="Group 4"
          presentation={presentation}
          onRename={onRename}
          onColorChange={onColorChange}
          onExpand={onExpand}
        />
      </div>,
    )
  })

  return { container, onRename, onColorChange, onExpand, onParentDoubleClick }
}

describe('CanvasCollapsedGroup', () => {
  it('edits the title on double click without expanding the folder', async () => {
    const mounted = await mountCollapsedGroup()
    const title = mounted.container.querySelector<HTMLButtonElement>('[aria-label="重命名节点"]')!

    await act(async () => {
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(mounted.container.querySelector('[aria-label="节点名称"]')).not.toBeNull()
    expect(mounted.onParentDoubleClick).not.toHaveBeenCalled()
  })

  it('shows ten presets and changes color without expanding the folder', async () => {
    const mounted = await mountCollapsedGroup()
    const trigger = mounted.container.querySelector<HTMLButtonElement>(
      '[aria-label="更改文件夹颜色"]',
    )!

    await act(async () => trigger.click())
    const options = mounted.container.querySelectorAll<HTMLButtonElement>(
      '.canvas-collapsed-group-color-option',
    )
    expect(options).toHaveLength(10)

    const purple = mounted.container.querySelector<HTMLButtonElement>(
      '[aria-label="切换为紫色"]',
    )!
    await act(async () => purple.click())

    expect(mounted.onColorChange).toHaveBeenCalledWith('purple')
    expect(mounted.onParentDoubleClick).not.toHaveBeenCalled()
  })

  it('expands from the folder shortcut without bubbling to the folder body gesture', async () => {
    const mounted = await mountCollapsedGroup()
    const trigger = mounted.container.querySelector<HTMLButtonElement>('[aria-label="展开编组"]')

    expect(trigger).not.toBeNull()
    await act(async () => trigger?.click())

    expect(mounted.onExpand).toHaveBeenCalledTimes(1)
    expect(mounted.onParentDoubleClick).not.toHaveBeenCalled()
  })
})
