// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteFileCards } from './RemoteFileCards'

const mocks = vi.hoisted(() => ({
  fetchRemoteAttachment: vi.fn(),
  openLocalFile: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.openLocalFile }),
}))

vi.mock('./remoteFileCache', () => ({
  fetchRemoteAttachment: mocks.fetchRemoteAttachment,
  remoteFileUrl: vi.fn(() => ''),
  useRemoteFile: (_deviceId: string, _path: string, enabled: boolean) => ({
    loading: enabled,
    error: null,
    localPath: null,
    text: null,
  }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteFileCards file name interaction', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<RemoteFileCards deviceId="device-1" files={[{ path: '/remote/report.md' }]} />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the inline preview and shows the remote-fetch loading state', () => {
    const name = container.querySelector('.rc-file-name-button')
    expect(name?.textContent).toBe('report.md')
    act(() => (name as HTMLButtonElement).click())
    expect(container.textContent).toContain('正在从目标电脑取回…')
    expect(container.querySelector('.rc-file-name-button')?.getAttribute('aria-expanded')).toBe(
      'true',
    )
  })
})
