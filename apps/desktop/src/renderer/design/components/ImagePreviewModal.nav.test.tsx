// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePreviewModal } from './ImagePreviewModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

const IMAGES = [
  { src: 'safe-file://x/aaa', alt: '第一张', fileName: 'one.png' },
  { src: 'safe-file://x/bbb', alt: '第二张', fileName: 'two.png' },
  { src: 'safe-file://x/ccc', alt: '第三张', fileName: 'three.png' },
]

function queryButton(title: string): HTMLButtonElement | null {
  return document.body.querySelector(`button[title="${title}"]`)
}

describe('ImagePreviewModal 多图导航', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  function renderModal(props: Partial<Parameters<typeof ImagePreviewModal>[0]> = {}) {
    act(() => {
      root.render(
        <ImagePreviewModal
          src="safe-file://x/aaa"
          alt="第一张"
          fileName="one.png"
          onClose={vi.fn()}
          {...props}
        />,
      )
    })
  }

  function currentImg(): HTMLImageElement | null {
    return document.body.querySelector('.image-lightbox-img')
  }

  it('单图（无 navigation）不渲染导航按钮与序号，行为与旧版一致', () => {
    renderModal()
    expect(currentImg()).not.toBeNull()
    expect(queryButton('上一张 (←)')).toBeNull()
    expect(queryButton('下一张 (→)')).toBeNull()
    expect(document.body.querySelector('.image-lightbox-counter')).toBeNull()
  })

  it('navigation 仅 1 张时同样不启用导航', () => {
    renderModal({
      navigation: {
        images: [{ src: 'safe-file://x/aaa', alt: '第一张', fileName: 'one.png' }],
        startIndex: 0,
      },
    })
    expect(queryButton('下一张 (→)')).toBeNull()
  })

  it('多图：按 startIndex 初始化，序号与文件名正确，按钮可循环切换', () => {
    const onClose = vi.fn()
    renderModal({ navigation: { images: IMAGES, startIndex: 1 }, onClose })
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/bbb')
    expect(document.body.querySelector('.image-lightbox-counter')?.textContent).toBe('2 / 3')
    expect(document.body.querySelector('.image-lightbox-title')?.textContent).toBe('two.png')

    act(() => queryButton('下一张 (→)')?.click())
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/ccc')
    expect(document.body.querySelector('.image-lightbox-counter')?.textContent).toBe('3 / 3')

    // 末尾继续下一张 → 循环回首张
    act(() => queryButton('下一张 (→)')?.click())
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/aaa')

    // 首张点上一张 → 循环到末张
    act(() => queryButton('上一张 (←)')?.click())
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/ccc')
    // 点按钮不应触发遮罩关闭
    expect(onClose).not.toHaveBeenCalled()
  })

  it('键盘 ←/→ 切换，Esc 关闭', () => {
    const onClose = vi.fn()
    renderModal({ navigation: { images: IMAGES, startIndex: 0 }, onClose })

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/bbb')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/aaa')

    // 无 navigation 时方向键不做事
    act(() => root.unmount())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<ImagePreviewModal src="a.png" alt="a" fileName="a.png" onClose={onClose} />)
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(currentImg()?.getAttribute('src')).toBe('a.png')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('某张加载失败后切到下一张会重置错误态', () => {
    renderModal({ navigation: { images: IMAGES, startIndex: 0 } })

    // 模拟当前图加载失败
    const img = currentImg()
    expect(img).not.toBeNull()
    act(() => img?.dispatchEvent(new Event('error')))
    expect(document.body.querySelector('.image-lightbox-error')).not.toBeNull()

    // 切换后错误态重置，新图正常渲染
    act(() => queryButton('下一张 (→)')?.click())
    expect(document.body.querySelector('.image-lightbox-error')).toBeNull()
    expect(currentImg()?.getAttribute('src')).toBe('safe-file://x/bbb')
  })
})
