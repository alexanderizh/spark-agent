// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresentedFilesList } from './PresentedFiles'
import { filterPresentedFiles, hasPresentedFiles } from './presented-files'

const { errorToast, successToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
  successToast: vi.fn(),
}))
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { error: errorToast, success: successToast } }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('explicit presented attachments', () => {
  let container: HTMLDivElement
  let root: Root
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    invoke.mockReset().mockResolvedValue({ opened: true })
    errorToast.mockReset()
    successToast.mockReset()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke, platform: 'darwin' },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'spark')
  })

  it.each(['clash.yaml', 'clash.yml', 'settings.json', 'bundle.zip', 'LICENSE', 'main.ts'])(
    'renders a %s attachment and opens it through the existing file route',
    async (name) => {
      const filePath = `/workspace/output/${name}`
      await act(async () => root.render(<PresentedFilesList files={[{ path: filePath }]} />))
      const button = container.querySelector<HTMLButtonElement>('.document-output-card')
      expect(button?.textContent).toContain(name)
      await act(async () => button?.click())
      expect(invoke).toHaveBeenCalledWith('file:open', { filePath })
    },
  )

  it('uses the preview callback for supported documents', async () => {
    const preview = vi.fn()
    await act(async () =>
      root.render(
        <PresentedFilesList
          files={[{ path: '/workspace/report.md', title: '交付报告' }]}
          onFilePreview={preview}
        />,
      ),
    )
    const button = container.querySelector<HTMLButtonElement>('.document-output-card')
    expect(button?.textContent).toContain('交付报告')
    await act(async () => button?.click())
    expect(preview).toHaveBeenCalledWith('/workspace/report.md', 'markdown')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('retains media previews alongside generic attachments without duplicate cards', async () => {
    await act(async () =>
      root.render(
        <PresentedFilesList
          files={[
            { path: '/workspace/clash.yaml', title: '代理配置' },
            { path: '/workspace/report.pdf' },
            { path: '/workspace/voice.mp3' },
            { path: '/workspace/demo.mp4' },
          ]}
        />,
      ),
    )
    expect(container.querySelectorAll('.document-output-card')).toHaveLength(2)
    expect(container.querySelectorAll('audio')).toHaveLength(1)
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(container.textContent).toContain('代理配置')
  })

  it('shows open failures instead of silently swallowing the result', async () => {
    invoke.mockResolvedValue({ opened: false, error: '文件已被移动' })
    await act(async () =>
      root.render(<PresentedFilesList files={[{ path: '/workspace/a.zip' }]} />),
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.document-output-card')?.click(),
    )
    expect(errorToast).toHaveBeenCalledWith('文件已被移动')
  })

  async function openFileMenu() {
    await act(async () =>
      container
        .querySelector('.document-output-card')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 30 })),
    )
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>('[aria-label="文件操作"] [role="menuitem"]'),
    )
  }

  it('offers system and text actions and routes them to their IPC handlers', async () => {
    const filePath = '/workspace/clash.yaml'
    await act(async () => root.render(<PresentedFilesList files={[{ path: filePath }]} />))
    const items = await openFileMenu()
    expect(items.map((item) => item.textContent)).toEqual([
      '打开文件',
      '打开方式…',
      '在终端打开所在目录',
      '另存为…',
      '复制文件内容',
      '复制路径',
      '在 Finder 中显示',
    ])
    invoke.mockResolvedValueOnce({ status: 'done' })
    await act(async () => items.find((item) => item.textContent === '复制文件内容')?.click())
    expect(invoke).toHaveBeenCalledWith('file:chat-action', { filePath, action: 'copy-content' })
    expect(successToast).toHaveBeenCalledWith('已复制文件内容')
    expect(document.querySelector('[aria-label="文件操作"]')).toBeNull()

    const reopened = await openFileMenu()
    invoke.mockResolvedValueOnce({ status: 'canceled' })
    successToast.mockClear()
    await act(async () => reopened.find((item) => item.textContent === '另存为…')?.click())
    expect(invoke).toHaveBeenCalledWith('file:chat-action', { filePath, action: 'save-as' })
    expect(successToast).not.toHaveBeenCalled()
  })

  it('keeps explicit preview and excludes text copying for binary attachments', async () => {
    const preview = vi.fn()
    const filePath = '/workspace/report.pdf'
    await act(async () =>
      root.render(<PresentedFilesList files={[{ path: filePath }]} onFilePreview={preview} />),
    )
    const items = await openFileMenu()
    expect(items.map((item) => item.textContent)).not.toContain('复制文件内容')
    await act(async () => items.find((item) => item.textContent === '预览')?.click())
    expect(preview).toHaveBeenCalledWith(filePath, 'universal', { mode: 'preview' })
  })

  it('does not run desktop actions on non-local paths', async () => {
    await act(async () =>
      root.render(<PresentedFilesList files={[{ path: 'https://example.com/bundle.zip' }]} />),
    )
    expect((await openFileMenu()).map((item) => item.textContent)).toEqual(['复制路径'])
  })

  it('skips empty paths consistently and renders no empty wrapper', async () => {
    const files = [{ path: '' }, { path: '  ' }]
    expect(filterPresentedFiles(files)).toEqual([])
    expect(hasPresentedFiles(files)).toBe(false)
    await act(async () => root.render(<PresentedFilesList files={files} />))
    expect(container.childElementCount).toBe(0)
    expect(hasPresentedFiles([{ path: '/workspace/unknown.custom' }])).toBe(true)
  })
})
