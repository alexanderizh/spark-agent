// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasNodeSelectionToolbar,
  type CanvasNodeToolbarEntry,
} from './CanvasNodeSelectionToolbar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) =>
      ReactActual.createElement('button', { type: 'button', onClick, ...props }, icon, children),
    Tooltip: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) =>
      ReactActual.createElement('span', { title: String(title ?? '') }, children),
  }
})

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (!item) return
    act(() => item.root.unmount())
    item.container.remove()
  }
})

async function renderToolbar(entries: CanvasNodeToolbarEntry[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasNodeSelectionToolbar entries={entries} />))
  return container
}

describe('CanvasNodeSelectionToolbar', () => {
  it('renders icon-only text buttons and dispatches the original action', async () => {
    const onClick = vi.fn()
    const container = await renderToolbar([
      { key: 'duplicate', label: '复制节点', icon: <span>copy</span>, onClick },
    ])

    const button = container.querySelector<HTMLButtonElement>('[aria-label="复制节点"]')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('copy')
    expect(container.querySelector('[title="复制节点"]')).not.toBeNull()

    await act(async () => button?.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not render an empty dynamic group', async () => {
    const container = await renderToolbar([
      { key: 'pipeline', label: '功能操作', icon: <span>workflow</span>, children: [] },
    ])

    expect(container.querySelector('[aria-label="功能操作"]')).toBeNull()
  })

  it('renders a separated danger action at the end of the toolbar', async () => {
    const onDelete = vi.fn()
    const container = await renderToolbar([
      { key: 'copy', label: '复制节点', icon: <span>copy</span>, onClick: vi.fn() },
      { key: 'delete-divider', type: 'divider' },
      {
        key: 'delete-node',
        label: '删除节点',
        icon: <span>trash</span>,
        danger: true,
        onClick: onDelete,
      },
    ])

    expect(container.querySelector('.canvas-node-selection-toolbar-divider')).not.toBeNull()
    const button = container.querySelector<HTMLButtonElement>('[aria-label="删除节点"]')
    expect(button?.className).toContain('is-danger')
    await act(async () => button?.click())
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
