// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteFileCards } from './RemoteFileCards'

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: vi.fn() }),
}))

vi.mock('./remoteFileCache', () => ({
  fetchRemoteAttachment: vi.fn(),
  remoteFileUrl: (path: string) => `safe-file://${path}`,
  useRemoteFile: (_deviceId: string, _path: string, enabled: boolean) => ({
    loading: false,
    error: null,
    localPath: enabled ? '/cache/preview.png' : null,
    text: null,
  }),
}))

vi.mock('./RemoteDocPreview', () => ({ RemoteDocPreview: () => null }))
vi.mock('./RemoteHtmlPreview', () => ({ RemoteHtmlPreview: () => null }))
vi.mock('../../components/ImagePreviewModal', () => ({
  ImagePreviewModal: ({
    src,
    fileName,
    onClose,
  }: {
    src: string
    fileName: string
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={fileName}>
      <span>{src}</span>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteFileCards image preview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<RemoteFileCards deviceId="device-1" files={[{ path: '/remote/photo.png' }]} />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the full-screen preview when the inline image is clicked', () => {
    const previewButton = Array.from(container.querySelectorAll('.rc-file-btn')).find((button) =>
      button.textContent?.includes('预览'),
    )
    expect(previewButton).toBeDefined()
    act(() => (previewButton as HTMLButtonElement).click())

    const imageButton = container.querySelector('.rc-file-image-trigger')
    expect(imageButton).not.toBeNull()
    act(() => (imageButton as HTMLButtonElement).click())

    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('photo.png')
    expect(container.textContent).toContain('safe-file:///cache/preview.png')

    const closeButton = container.querySelector('[role="dialog"] button')
    act(() => (closeButton as HTMLButtonElement).click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
