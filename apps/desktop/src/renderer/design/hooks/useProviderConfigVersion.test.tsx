// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderConfigVersion } from './useProviderConfigVersion'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('useProviderConfigVersion', () => {
  let container: HTMLDivElement
  let root: Root
  let configChanged:
    | ((event: { scope: 'provider' | 'model'; action: 'update'; id?: string }) => void)
    | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        on: vi.fn((channel: string, handler: typeof configChanged) => {
          if (channel === 'stream:config:changed') configChanged = handler
          return vi.fn()
        }),
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    configChanged = undefined
  })

  it('refreshes only for provider configuration changes', async () => {
    function Probe() {
      return <span>{useProviderConfigVersion()}</span>
    }
    await act(async () => root.render(<Probe />))

    act(() => configChanged?.({ scope: 'model', action: 'update' }))
    expect(container.textContent).toBe('0')

    act(() => configChanged?.({ scope: 'provider', action: 'update', id: 'provider-1' }))
    expect(container.textContent).toBe('1')
  })
})
