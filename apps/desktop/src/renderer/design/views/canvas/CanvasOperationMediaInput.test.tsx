// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({ Button: 'button' }))

import { CanvasOperationMediaInput } from './CanvasOperationMediaInput'
import type { CanvasNode } from './canvas.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const imageNode: CanvasNode = {
  id: 'image-1',
  projectId: 'project-1',
  boardId: 'board-1',
  userId: 1,
  type: 'image',
  title: '参考图',
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  rotation: 0,
  zIndex: 1,
  locked: false,
  hidden: false,
  data: { url: 'https://example.com/reference.png' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

describe('CanvasOperationMediaInput', () => {
  it('asks for one image and supports choosing it from the canvas', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onPick = vi.fn()

    await act(async () => {
      root.render(<CanvasOperationMediaInput onPick={onPick} />)
    })

    expect(container.textContent).toContain('连接或上传一张图片')
    const pickButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('从画布选择'),
    )
    await act(async () => pickButton?.click())
    expect(onPick).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })

  it('asks for one video when used by the depth-video operation', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasOperationMediaInput mediaKind="video" onUpload={vi.fn()} />)
    })

    expect(container.textContent).toContain('连接或上传一段视频')
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe('video/*')

    await act(async () => root.unmount())
  })

  it('shows the selected image and allows replacing or removing it', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onClear = vi.fn()

    await act(async () => {
      root.render(<CanvasOperationMediaInput node={imageNode} onClear={onClear} />)
    })

    expect(container.querySelector<HTMLImageElement>('img')?.src).toBe(
      'https://example.com/reference.png',
    )
    expect(container.textContent).toContain('参考图')
    const clearButton = container.querySelector<HTMLButtonElement>('[aria-label="移除输入图片"]')
    await act(async () => clearButton?.click())
    expect(onClear).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })
})
