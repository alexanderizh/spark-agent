// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptionalCapabilitySnapshot } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  setAutoUpdate: vi.fn(async () => {
    throw new Error('保存自动更新设置失败')
  }),
  snapshot: null as OptionalCapabilitySnapshot | null,
}))

vi.mock('./useOptionalCapabilities', () => ({
  useOptionalCapabilities: () => ({
    loading: false,
    progress: {},
    snapshot: mocks.snapshot,
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
    mocks.snapshot = {
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
    }
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

  it('hides capabilities managed by dedicated integrity cards to avoid duplication', async () => {
    mocks.snapshot = {
      ...mocks.snapshot!,
      capabilities: [
        {
          id: 'codex-runtime',
          displayName: 'Codex 本地运行环境',
          description: 'Codex native runtime',
          state: 'ready',
          installedVersion: '0.153.4',
          targetVersion: '0.153.4',
          downloadSize: 200,
          installedSize: 400,
          autoUpdate: false,
          supportsUninstall: false,
        },
        {
          id: 'ffmpeg',
          displayName: 'FFmpeg',
          description: 'Local ffmpeg',
          state: 'missing',
          installedVersion: null,
          targetVersion: '7.0.2',
          downloadSize: 100,
          installedSize: null,
          autoUpdate: true,
          supportsUninstall: false,
        },
        {
          id: 'voice-pack',
          displayName: '语音输入资源',
          description: 'Voice pack',
          state: 'missing',
          installedVersion: null,
          targetVersion: '1.0.0',
          downloadSize: 100,
          installedSize: null,
          autoUpdate: true,
          supportsUninstall: false,
        },
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
    }

    await act(async () => root.render(<OptionalCapabilitiesSettingsCard />))

    expect(container.textContent).toContain('离线 Office 预览')
    expect(container.textContent).not.toContain('Codex 本地运行环境')
    expect(container.textContent).not.toContain('FFmpeg')
    expect(container.textContent).not.toContain('语音输入资源')
  })

  it('opens the optional capability installer from the integrity page action', async () => {
    const listener = vi.fn()
    window.addEventListener('spark:open-optional-capability-center', listener)
    await act(async () => root.render(<OptionalCapabilitiesSettingsCard />))

    const openButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('选择并安装可选功能'),
    )
    expect(openButton).toBeTruthy()
    await act(async () => openButton?.click())

    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('spark:open-optional-capability-center', listener)
  })
})
