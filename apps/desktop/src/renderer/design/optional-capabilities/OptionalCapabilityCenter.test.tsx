// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  install: vi.fn(async () => undefined),
  setTweak: vi.fn(),
}))

vi.mock('./useOptionalCapabilities', () => ({
  useOptionalCapabilities: () => ({
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
    },
    progress: {},
    install: mocks.install,
  }),
}))

vi.mock('../AppContext', () => ({ useApp: () => ({ setTweak: mocks.setTweak }) }))

import { OptionalCapabilityCenter } from './OptionalCapabilityCenter'

describe('OptionalCapabilityCenter', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('leaves large optional packages unchecked by default', async () => {
    await act(async () => root.render(<OptionalCapabilityCenter />))

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox?.checked).toBe(false)
    const installButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('后台安装所选组件'),
    )
    expect(installButton?.hasAttribute('disabled')).toBe(true)
  })
})
