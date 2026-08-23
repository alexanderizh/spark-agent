// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProviderProfile, SessionPermissionMode } from '@spark/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PermissionPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement('button', null, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Dropdown: ({
      children,
      open,
      popupRender,
    }: {
      children?: React.ReactNode
      open?: boolean
      popupRender?: () => React.ReactNode
    }) =>
      ReactActual.createElement('div', null, children, open && popupRender ? popupRender() : null),
    Modal: {},
  }
})

vi.mock('../../components/ProviderLogo', () => ({
  ProviderLogo: ({
    icon,
    vendor,
  }: {
    icon?: { id: string; style: string }
    vendor?: { id?: string } | null
  }) => (
    <span
      data-provider-logo
      data-provider-icon={icon?.id}
      data-provider-icon-style={icon?.style}
      data-provider-vendor={vendor?.id}
    />
  ),
}))

vi.mock('./canvas-tool-host', () => ({
  useCanvasToolHost: vi.fn(),
}))

vi.mock('../../components/ChatPanel', () => ({
  ChatPanel: () => null,
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (!item) continue
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function provider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'custom-provider',
    name: 'Custom Provider',
    provider: 'openai',
    defaultModel: 'custom-model',
    modelIds: ['custom-model'],
    keystoreRef: 'test-key',
    isDefault: false,
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  }
}

async function renderPicker(profile: ProviderProfile) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () =>
    root.render(
      <ProviderModelPickerInline
        providers={[profile]}
        selectedProviderId={profile.id}
        selectedModelId={profile.defaultModel}
        open
        onOpenChange={vi.fn()}
        onChange={vi.fn()}
      />,
    ),
  )
  return container
}

describe('ProviderModelPickerInline', () => {
  it('uses the configured provider icon in the trigger and provider group title', async () => {
    const container = await renderPicker(
      provider({ providerIcon: { id: 'deepseek', style: 'mono' } }),
    )

    const logos = [...container.querySelectorAll<HTMLElement>('[data-provider-logo]')]
    expect(logos).toHaveLength(2)
    expect(logos.map((logo) => logo.dataset.providerIcon)).toEqual(['deepseek', 'deepseek'])
    expect(logos.map((logo) => logo.dataset.providerIconStyle)).toEqual(['mono', 'mono'])
  })

  it('keeps the provider vendor fallback when no custom icon is configured', async () => {
    const container = await renderPicker(provider())

    const logos = [...container.querySelectorAll<HTMLElement>('[data-provider-logo]')]
    expect(logos).toHaveLength(2)
    expect(logos.map((logo) => logo.dataset.providerIcon)).toEqual([undefined, undefined])
    expect(logos.map((logo) => logo.dataset.providerVendor)).toEqual(['openai', 'openai'])
  })
})

describe('PermissionPickerInline', () => {
  it('shows adapter-compatible modes and emits the selected mode', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    const onChange = vi.fn<(mode: SessionPermissionMode) => void>()

    await act(async () =>
      root.render(
        <PermissionPickerInline
          adapter="codex"
          value="codex-default"
          open
          onOpenChange={vi.fn()}
          onChange={onChange}
        />,
      ),
    )

    expect(container.textContent).toContain('按需批准')
    expect(container.textContent).toContain('替我批准')
    expect(container.textContent).toContain('完全访问')
    expect(container.textContent).not.toContain('自动编辑')

    const fullAccess = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('完全访问'),
    )
    expect(fullAccess).toBeDefined()
    await act(async () => fullAccess?.click())
    expect(onChange).toHaveBeenCalledWith('codex-full-access')
  })
})
