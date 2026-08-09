// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setAutoUpdate: vi.fn(async () => {
    throw new Error('保存自动更新设置失败')
  }),
}))

vi.mock('./useOptionalCapabilities', () => ({
  useOptionalCapabilities: () => ({
    loading: false,
    progress: {},
    snapshot: {
      capabilities: [
        {
          id: 'office-viewer',
          displayName: '离线 Office 预览',
          description: 'Office resources',
          state: 'ready',
          installedVersion: '2.2.3-1',
          targetVersion: '2.2.3-1',
          downloadSize: 10,
          installedSize: 20,
          autoUpdate: true,
          supportsUninstall: false,
        },
      ],
      checkedAt: '2026-08-02T00:00:00.000Z',
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: true,
    },
    refresh: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    repair: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    setAutoUpdate: mocks.setAutoUpdate,
  }),
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({ requestConfirm: vi.fn(async () => true) }),
}))

import { OptionalCapabilitiesSettingsCard } from './OptionalCapabilitiesSettingsCard'

describe('OptionalCapabilitiesSettingsCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('shows a clear client error when saving auto-update fails', async () => {
    await act(async () => root.render(<OptionalCapabilitiesSettingsCard />))

    const autoUpdate = document.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(autoUpdate).toBeTruthy()
    await act(async () => autoUpdate?.click())

    expect(container.textContent).toContain('保存自动更新设置失败')
  })

  it('does not offer in-app uninstall for externally managed resources', async () => {
    await act(async () => root.render(<OptionalCapabilitiesSettingsCard />))

    expect(container.textContent).not.toContain('卸载')
  })
})
