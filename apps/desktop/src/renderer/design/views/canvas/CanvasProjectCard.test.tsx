// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './canvas.types'
import { CanvasProjectCard } from './CanvasProjectCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      onClick,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      icon?: React.ReactNode
      loading?: boolean
    }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', onClick, disabled: props.disabled || loading, ...props },
        icon,
        children,
      ),
    Dropdown: ({ children }: { children: React.ReactNode }) => children,
    Tag: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('span', null, children),
    Tooltip: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) =>
      ReactActual.createElement('span', { title: String(title ?? '') }, children),
  }
})

const project: CanvasProject = {
  id: 'project-1',
  userId: 1,
  title: '电影项目',
  description: '测试项目',
  status: 'active',
  nodeCount: 3,
  assetCount: 2,
  taskCount: 1,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

async function renderCard(overrides: Partial<React.ComponentProps<typeof CanvasProjectCard>> = {}) {
  const props: React.ComponentProps<typeof CanvasProjectCard> = {
    project,
    opening: false,
    busy: false,
    onOpen: vi.fn(),
    onTogglePin: vi.fn(),
    onEdit: vi.fn(),
    onOpenFolder: vi.fn(),
    onExport: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasProjectCard {...props} />))
  return { container, props }
}

describe('CanvasProjectCard', () => {
  it('opens explicitly from the button and does not rely on card bubbling', async () => {
    const onOpen = vi.fn()
    const { container } = await renderCard({ onOpen })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="打开项目：电影项目"]')!.click(),
    )
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('project-1')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="项目操作：电影项目"]')!.click(),
    )
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('keeps the entire card clickable and keyboard accessible', async () => {
    const onOpen = vi.fn()
    const { container } = await renderCard({ onOpen })
    const card = container.querySelector<HTMLElement>('.canvas-project-card')!
    await act(async () => card.click())
    await act(async () =>
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('disables the open action and exposes progress while opening', async () => {
    const { container } = await renderCard({ opening: true })
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="正在打开项目：电影项目"]',
    )!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('打开中')
  })
})
