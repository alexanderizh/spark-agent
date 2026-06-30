// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasPresetHubEntry } from './CanvasPresetHubEntry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      onClick,
      className,
    }: {
      children: React.ReactNode
      onClick?: () => void
      className?: string
    }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', onClick, className },
        children,
      ),
    Tag: ({
      children,
      color,
    }: {
      children: React.ReactNode
      color?: string
    }) => ReactActual.createElement('span', { 'data-color': color }, children),
  }
})

vi.mock('../../Icons', () => ({
  Icons: {
    Sliders: ({ size }: { size?: number }) =>
      React.createElement('span', { 'data-icon': 'sliders', 'data-size': size }),
  },
}))

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.includes(text),
  )
  expect(button).toBeDefined()
  if (button == null) throw new Error(`Button not found: ${text}`)
  return button
}

describe('CanvasPresetHubEntry', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
  })

  it('renders both panel and floating entry variants with preset status', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <>
          <CanvasPresetHubEntry configuredPresetCount={2} onOpen={() => undefined} variant="panel" />
          <CanvasPresetHubEntry
            configuredPresetCount={0}
            onOpen={() => undefined}
            variant="floating"
          />
        </>,
      )
    })

    expect(container.querySelector('.canvas-preset-hub-card')).not.toBeNull()
    expect(container.querySelector('.canvas-preset-hub-quick-entry')).not.toBeNull()
    expect(container.textContent).toContain('已配置 2')
    expect(container.textContent).toContain('未配置')
    expect(
      container.querySelector('.canvas-preset-hub-quick-entry')?.getAttribute('aria-label'),
    ).toContain('打开节点预设中心')
  })

  it('opens from both entry touchpoints', () => {
    const onOpen = vi.fn()

    act(() => {
      root = createRoot(container)
      root.render(
        <>
          <CanvasPresetHubEntry configuredPresetCount={1} onOpen={onOpen} variant="panel" />
          <CanvasPresetHubEntry configuredPresetCount={1} onOpen={onOpen} variant="floating" />
        </>,
      )
    })

    act(() => {
      buttonByText('打开预设中心').click()
    })
    const quickEntry = container.querySelector<HTMLButtonElement>('.canvas-preset-hub-quick-entry')
    expect(quickEntry).not.toBeNull()
    act(() => {
      quickEntry?.click()
    })

    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
