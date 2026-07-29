// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderEnabledSwitch } from './ProviderEnabledSwitch'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  updateProvider: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.updateProvider }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { success: mocks.success, error: mocks.error } }),
}))

vi.mock('antd', () => ({
  Switch: ({
    checked,
    disabled,
    loading: _loading,
    size: _size,
    onChange,
    ...props
  }: {
    checked: boolean
    disabled?: boolean
    loading?: boolean
    size?: string
    onChange: (checked: boolean) => void
    [key: string]: unknown
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      {...props}
    />
  ),
}))

describe('ProviderEnabledSwitch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProvider.mockResolvedValue({ profile: { id: 'provider-1', enabled: false } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('updates the provider and refreshes the current management view', async () => {
    const onChanged = vi.fn()
    function Harness() {
      const [enabled, setEnabled] = React.useState(true)
      return (
        <ProviderEnabledSwitch
          providerId="provider-1"
          providerName="测试 Provider"
          enabled={enabled}
          onChanged={(nextEnabled) => {
            setEnabled(nextEnabled)
            onChanged(nextEnabled)
          }}
        />
      )
    }
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[role="switch"]')?.click()
    })

    expect(mocks.updateProvider).toHaveBeenCalledWith({
      id: 'provider-1',
      enabled: false,
    })
    expect(onChanged).toHaveBeenCalledWith(false)
    expect(mocks.success).toHaveBeenCalledWith('测试 Provider 已禁用')
    expect(
      container.querySelector<HTMLInputElement>('input[role="switch"]')?.checked,
    ).toBe(false)
  })
})
