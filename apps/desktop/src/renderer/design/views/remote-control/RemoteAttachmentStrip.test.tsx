// @vitest-environment jsdom

/**
 * 远程附件条：图片缩略图可以直接点开大图。
 *
 * 为什么必须有这层测试：预览壳（浏览器）里 safe-file:// 不解析，图片永远停在
 * 占位状态，浏览器探针点不到缩略图，只能在这里验交互。
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteAttachmentStrip, type RemoteAttachmentRef } from './RemoteAttachmentStrip'
import type { RemoteFileState } from './remoteFileCache'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const remoteFiles = new Map<string, RemoteFileState>()

vi.mock('./remoteFileCache', () => ({
  remoteFileUrl: (localPath: string) => `safe-file://${localPath}`,
  useRemoteFile: (deviceId: string, remotePath: string | null) =>
    remoteFiles.get(`${deviceId}\u0000${remotePath}`) ?? {
      loading: false,
      localPath: null,
      mimeType: null,
      text: null,
      error: null,
    },
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

function setRemoteFile(deviceId: string, path: string, state: Partial<RemoteFileState>): void {
  remoteFiles.set(`${deviceId}\u0000${path}`, {
    loading: false,
    localPath: null,
    mimeType: null,
    text: null,
    error: null,
    ...state,
  })
}

describe('RemoteAttachmentStrip 图片放大', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    remoteFiles.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  function render(attachments: RemoteAttachmentRef[]) {
    act(() => {
      root.render(<RemoteAttachmentStrip deviceId="dev-1" attachments={attachments} />)
    })
  }

  function thumb(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button.rc-attach-thumb')
  }

  it('取回成功后缩略图可点', () => {
    setRemoteFile('dev-1', '/remote/shot.png', { localPath: '/cache/shot.png' })
    render([{ type: 'image', path: '/remote/shot.png', name: 'shot.png' }])

    const button = thumb()
    expect(button).not.toBeNull()
    expect(button?.getAttribute('title')).toBe('查看大图')
    expect(button?.getAttribute('aria-label')).toBe('查看大图：shot.png')
  })

  it('点缩略图打开大图，Esc 关掉', () => {
    setRemoteFile('dev-1', '/remote/shot.png', { localPath: '/cache/shot.png' })
    render([{ type: 'image', path: '/remote/shot.png', name: 'shot.png' }])

    act(() => {
      thumb()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 灯箱走 createPortal 挂到 body，不在 container 里
    const backdrop = document.querySelector('.image-lightbox-backdrop')
    expect(backdrop).not.toBeNull()
    expect(document.querySelector('.image-lightbox-title')?.textContent).toBe('shot.png')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.image-lightbox-backdrop')).toBeNull()
  })

  it('本机已有文件（粘贴图片）时不必等目标端回图', () => {
    setRemoteFile('dev-1', '/remote/pasted.png', { localPath: '/cache/should-not-be-used.png' })
    render([
      {
        type: 'image',
        path: '/remote/pasted.png',
        name: 'pasted.png',
        previewUrl: 'safe-file:///local/pasted.png',
      },
    ])

    expect(thumb()?.querySelector('img')?.getAttribute('src')).toBe('safe-file:///local/pasted.png')
  })

  it('文件附件不出现缩放按钮', () => {
    render([{ type: 'file', path: '/remote/spec.pdf', name: 'spec.pdf' }])
    expect(thumb()).toBeNull()
    expect(container.querySelector('.rc-attach-name')?.textContent).toBe('spec.pdf')
  })

  it('拿不到地址时只显示占位，不给点', () => {
    render([{ type: 'image', path: '/remote/lost.png', name: 'lost.png' }])
    expect(thumb()).toBeNull()
    expect(container.querySelector('.rc-attach-image-placeholder')).not.toBeNull()
  })

  it('取回失败标成错误态', () => {
    setRemoteFile('dev-1', '/remote/gone.png', { error: '取回失败' })
    render([{ type: 'image', path: '/remote/gone.png', name: 'gone.png' }])
    expect(container.querySelector('.rc-attach-image-placeholder.is-error')).not.toBeNull()
  })
})
