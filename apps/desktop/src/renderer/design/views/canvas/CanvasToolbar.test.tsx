// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from './CanvasToolbar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      icon?: React.ReactNode
      loading?: boolean
    }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', ...props, disabled: props.disabled || loading },
        icon,
        children,
      ),
    Segmented: () => ReactActual.createElement('div'),
    Tag: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('span', null, children),
    Tooltip: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) =>
      ReactActual.createElement('span', { title: String(title ?? '') }, children),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Popover: ({ children }: { children: React.ReactNode }) => children,
    Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) =>
      ReactActual.createElement('input', {
        type: 'checkbox',
        checked,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked),
      }),
  }
})

vi.mock('../../Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get: () => () => React.createElement('span'),
    },
  ),
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
})

async function renderToolbar(overrides: Partial<React.ComponentProps<typeof CanvasToolbar>> = {}) {
  const props: React.ComponentProps<typeof CanvasToolbar> = {
    saveState: {
      dirty: false,
      saving: false,
      autoSaving: false,
      autoSaveEnabled: true,
    },
    onSave: vi.fn(),
    onRefresh: vi.fn(),
    onAutoSaveChange: vi.fn(),
    onExport: vi.fn(),
    onArrange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasToolbar {...props} />))
  return { container, props }
}

describe('CanvasToolbar', () => {
  it('places a manual reload action next to auto-save and dispatches it', async () => {
    const onRefresh = vi.fn()
    const { container } = await renderToolbar({ onRefresh })
    const autoSave = container.querySelector('.canvas-toolbar-autosave')
    const refreshButton = container.querySelector<HTMLButtonElement>('[aria-label="刷新画布"]')

    expect(autoSave?.nextElementSibling?.querySelector('[aria-label="刷新画布"]')).toBe(
      refreshButton,
    )
    if (refreshButton == null) throw new Error('Refresh button was not rendered')
    await act(async () => refreshButton.click())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('disables reload while a save is in progress', async () => {
    const { container } = await renderToolbar({
      saveState: {
        dirty: true,
        saving: true,
        autoSaving: false,
        autoSaveEnabled: true,
      },
    })

    expect(container.querySelector<HTMLButtonElement>('[aria-label="刷新画布"]')?.disabled).toBe(
      true,
    )
  })
})
