// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasComposerToolbar } from './CanvasComposerToolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({ children, icon, onClick, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; loading?: boolean }) =>
      ReactActual.createElement('button', { type: 'button', onClick, disabled: props.disabled || loading, ...props }, icon, children),
    Tooltip: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) =>
      ReactActual.createElement('span', { title: String(title ?? '') }, children),
  }
})

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

async function renderToolbar(props: React.ComponentProps<typeof CanvasComposerToolbar>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasComposerToolbar {...props} />))
  return container
}

describe('CanvasComposerToolbar', () => {
  it('keeps summaries before icon actions and dispatches interactions', async () => {
    const onSummary = vi.fn()
    const onToggleAdvanced = vi.fn()
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    const container = await renderToolbar({
      summaries: [
        { key: 'model', label: '模型', value: 'Grok Imagine 1.0', icon: <span>M</span>, onClick: onSummary },
        { key: 'ratio', label: '比例', value: '16:9', icon: <span>R</span>, onClick: onSummary },
      ],
      advancedAvailable: true,
      advancedOpen: false,
      canSubmit: true,
      submitting: false,
      onToggleAdvanced,
      onCancel,
      onSubmit,
    })

    const toolbar = container.querySelector('.canvas-composer-toolbar')!
    expect(toolbar.firstElementChild?.classList.contains('canvas-composer-toolbar-summaries')).toBe(true)
    expect(container.querySelector('.canvas-composer-toolbar-actions')).not.toBeNull()
    expect(container.textContent).toContain('Grok Imagine 1.0')

    await act(async () => container.querySelector<HTMLButtonElement>('[data-summary-key="model"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开高级设置"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="取消"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="创建任务"]')!.click())
    expect(onSummary).toHaveBeenCalledTimes(1)
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('disables the native submit button while invalid or submitting', async () => {
    const container = await renderToolbar({
      summaries: [],
      advancedAvailable: false,
      advancedOpen: false,
      canSubmit: false,
      submitting: false,
      onToggleAdvanced: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    })
    expect(container.querySelector<HTMLButtonElement>('[aria-label="创建任务"]')?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="展开高级设置"]')).toBeNull()
  })
})
