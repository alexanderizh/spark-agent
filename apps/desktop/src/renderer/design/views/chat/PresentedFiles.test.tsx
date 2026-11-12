// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresentedFilesList } from './PresentedFiles'
import { filterPresentedFiles, hasPresentedFiles } from './presented-files'

const { errorToast } = vi.hoisted(() => ({ errorToast: vi.fn() }))
vi.mock('../../components/Toast', () => ({ useToast: () => ({ toast: { error: errorToast } }) }))
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
    Object.defineProperty(window, 'spark', { configurable: true, value: { invoke } })
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

  it('offers the existing context menu for generic attachments', async () => {
    await act(async () =>
      root.render(<PresentedFilesList files={[{ path: '/workspace/clash.yaml' }]} />),
    )
    await act(async () =>
      container
        .querySelector('.document-output-card')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 30 })),
    )
    expect(container.textContent).toContain('复制文件地址')
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
