// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptionalCapabilitySnapshot } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  install: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  setTweak: vi.fn(),
  view: 'chat' as string,
  progress: {} as Record<string, unknown>,
  snapshot: {
    capabilities: [
      {
        id: 'office-viewer',
        displayName: '离线 Office 预览',
        description: 'Office resources',
        state: 'missing',
        installedVersion: null,
        targetVersion: '2.2.3-1',
        downloadSize: 10_000_000,
        installedSize: null,
        autoUpdate: true,
      },
    ],
    checkedAt: '2026-08-02T00:00:00.000Z',
    manifestUpdatedAt: '2026-08-02',
    remoteAvailable: true,
  } as OptionalCapabilitySnapshot,
}))

vi.mock('./useOptionalCapabilities', () => ({
  useOptionalCapabilities: () => ({
    snapshot: mocks.snapshot,
    progress: mocks.progress,
    install: mocks.install,
    cancel: mocks.cancel,
  }),
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({ setTweak: mocks.setTweak, t: { view: mocks.view } }),
}))

import { OptionalCapabilityCenter } from './OptionalCapabilityCenter'

describe('OptionalCapabilityCenter', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    mocks.view = 'chat'
    mocks.progress = {}
    mocks.install.mockClear()
    mocks.snapshot.capabilities = [
      {
        id: 'office-viewer',
        displayName: '离线 Office 预览',
        description: 'Office resources',
        state: 'missing',
        installedVersion: null,
        targetVersion: '2.2.3-1',
        downloadSize: 10_000_000,
        installedSize: null,
        autoUpdate: true,
      },
    ]
    mocks.cancel.mockClear()
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('leaves large optional packages unchecked by default', async () => {
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox?.checked).toBe(false)
    const installButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('后台安装'),
    )
    expect(installButton?.hasAttribute('disabled')).toBe(true)
  })

  it('keeps the startup prompt installation flow working after selecting a component', async () => {
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const capabilityCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => capabilityCheckbox?.click())
    const installButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('后台安装（1）'),
    )

    expect(installButton?.hasAttribute('disabled')).toBe(false)
    await act(async () => installButton?.click())
    expect(mocks.install).toHaveBeenCalledWith('office-viewer')
  })

  it('does not render the startup resource prompt during onboarding', async () => {
    mocks.view = 'onboarding'
    await act(async () => root.render(<OptionalCapabilityCenter />))

    expect(document.body.textContent).not.toContain('可选功能资源')
  })

  it('lets the user cancel an active optional capability download', async () => {
    mocks.progress = {
      'office-viewer': {
        capabilityId: 'office-viewer',
        displayName: '离线 Office 预览',
        phase: 'downloading',
        downloaded: 5,
        total: 10,
        percent: 50,
        queuePosition: 0,
        message: '正在下载 Office Viewer',
      },
    }
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const cancelButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('取消'),
    )
    const actions = document.querySelector('.optional-capability-progress-actions')
    expect(actions?.textContent).toContain('查看详情')
    expect(cancelButton).toBeTruthy()
    await act(async () => cancelButton?.click())
    expect(mocks.cancel).toHaveBeenCalledWith('office-viewer')
  })

  it('closes the startup prompt before navigating to integrity settings', async () => {
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const settingsButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('前往完整性'),
    )
    expect(settingsButton).toBeTruthy()

    await act(async () => settingsButton?.click())

    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'settings')
    expect(mocks.setTweak).toHaveBeenCalledWith('settingsSection', 'integrity')
    expect(
      JSON.parse(window.localStorage.getItem('spark-optional-capability-prompt') ?? '{}'),
    ).toMatchObject({
      dismissedAt: expect.any(Number),
    })
  })

  it('persists the choice to disable future startup reminders', async () => {
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const reminderCheckbox = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.closest('label')?.textContent?.includes('不再在启动时提醒'))
    expect(reminderCheckbox).toBeTruthy()
    await act(async () => reminderCheckbox?.click())

    expect(
      JSON.parse(window.localStorage.getItem('spark-optional-capability-prompt') ?? '{}'),
    ).toMatchObject({ disabled: true })
  })

  it('opens manually and shows installed components even when startup reminders are disabled', async () => {
    mocks.snapshot.capabilities = [
      {
        id: 'office-viewer',
        displayName: '离线 Office 预览',
        description: 'Office resources',
        state: 'ready',
        installedVersion: '2.2.3-1',
        targetVersion: '2.2.3-1',
        downloadSize: 10_000_000,
        installedSize: 20_000_000,
        autoUpdate: true,
      },
    ]
    window.localStorage.setItem(
      'spark-optional-capability-prompt',
      JSON.stringify({
        manifestUpdatedAt: mocks.snapshot.manifestUpdatedAt,
        dismissedAt: Date.now(),
        disabled: true,
      }),
    )
    await act(async () => root.render(<OptionalCapabilityCenter />))

    expect(document.body.textContent).not.toContain('安装可选功能')
    await act(async () => {
      window.dispatchEvent(new CustomEvent('spark:open-optional-capability-center'))
    })

    expect(document.body.textContent).toContain('安装可选功能')
    expect(document.body.textContent).toContain('离线 Office 预览')
    expect(document.body.textContent).toContain('已安装')
    expect(document.body.textContent).toContain('所有可用组件均已安装')
    expect(document.body.textContent).not.toContain('前往完整性')
    expect(document.body.textContent).not.toContain('不再在启动时提醒')
    const installButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('后台安装'),
    )
    expect(installButton?.hasAttribute('disabled')).toBe(true)
  })
})
