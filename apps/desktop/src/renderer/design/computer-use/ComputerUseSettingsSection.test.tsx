// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputerUseCapabilitySummary } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseSettingsSection } from './ComputerUseSettingsSection'

const BASE_CAPABILITIES: ComputerUseCapabilitySummary = {
  available: false,
  platform: 'macos',
  nativeHost: null,
  permissions: {
    screen: 'not_determined',
    accessibility: 'not_determined',
    input: 'not_determined',
  },
  unavailableReason: 'screen_permission_denied',
}

describe('ComputerUseSettingsSection', () => {
  let container: HTMLDivElement
  let root: Root
  const invoke = vi.fn()

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    invoke.mockReset()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('requests a first-time system permission from the dedicated settings page', async () => {
    const { unavailableReason: _unavailableReason, ...baseWithoutReason } = BASE_CAPABILITIES
    const granted = {
      ...baseWithoutReason,
      available: true,
      permissions: { screen: 'granted', accessibility: 'granted', input: 'granted' },
    } satisfies ComputerUseCapabilitySummary
    let capabilityReads = 0
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'computer-use:get-capabilities') {
        capabilityReads += 1
        return capabilityReads === 1 ? BASE_CAPABILITIES : granted
      }
      if (channel === 'app-snapshot:request-permissions') {
        return {
          available: true,
          platform: 'macos',
          permissions: { screen: 'granted', accessibility: 'granted' },
          supportsAppExposedText: true,
        }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    })

    await act(async () => root.render(<ComputerUseSettingsSection />))
    await vi.waitFor(() => {
      expect(container.textContent).toContain('请求授权')
    })
    const requestButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent?.includes('请求授权'),
    )
    expect(requestButtons).toHaveLength(2)

    await act(async () => requestButtons[0]?.click())

    expect(invoke).toHaveBeenCalledWith('app-snapshot:request-permissions', {
      permissions: ['screen'],
    })
    expect(invoke).not.toHaveBeenCalledWith('computer-use:open-system-settings', expect.anything())
    expect(container.textContent).toContain('电脑操作已就绪')
  })

  it('opens the exact operating-system pane after a permission was denied', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'computer-use:get-capabilities') {
        return {
          ...BASE_CAPABILITIES,
          permissions: { ...BASE_CAPABILITIES.permissions, screen: 'denied' },
        }
      }
      if (channel === 'computer-use:open-system-settings') return { opened: true }
      throw new Error(`Unexpected channel: ${channel}`)
    })

    await act(async () => root.render(<ComputerUseSettingsSection />))
    await vi.waitFor(() => {
      expect(container.textContent).toContain('打开系统设置')
    })
    const openButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('打开系统设置'),
    )
    expect(openButton).toBeTruthy()

    await act(async () => openButton?.click())

    expect(invoke).toHaveBeenCalledWith('computer-use:open-system-settings', {
      permission: 'screen',
    })
  })
})
