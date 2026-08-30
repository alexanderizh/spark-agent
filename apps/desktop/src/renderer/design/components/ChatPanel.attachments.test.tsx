// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toast = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}

vi.mock('../components/Toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('../views/ChatView', () => ({
  MarkdownText: ({ content }: { content: string }) => <span>{content}</span>,
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (!item) continue
    act(() => item.root.unmount())
    item.container.remove()
  }
  toast.error.mockReset()
  toast.info.mockReset()
  toast.success.mockReset()
})

function dispatchDrop(target: Element, dataTransfer: DataTransfer) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  target.dispatchEvent(event)
}

function getChatPanel(container: HTMLDivElement): Element {
  const panel = container.querySelector('.chat-panel')
  if (panel == null) throw new Error('ChatPanel was not rendered')
  return panel
}

describe('ChatPanel dropped attachments', () => {
  it('uses the compact add menu with only canvas-relevant actions', async () => {
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        on: vi.fn(() => () => undefined),
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () =>
      root.render(
        <ChatPanel
          sessionId={null}
          onSend={vi.fn(async () => undefined)}
          composerBelow={<button data-testid="composer-below-control">模型</button>}
        />,
      ),
    )

    const actionsMenu = container.querySelector('.composer-actions-menu')
    const parameterScroller = container.querySelector('.chat-panel-composer-below-scroll')
    expect(actionsMenu?.parentElement?.classList.contains('chat-panel-composer-below')).toBe(true)
    expect(parameterScroller?.contains(actionsMenu)).toBe(false)
    expect(
      parameterScroller?.querySelector('[data-testid="composer-below-control"]'),
    ).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="添加图片、文件或文件夹"]')?.click()
    })

    expect(container.textContent).toContain('添加图片')
    expect(container.textContent).toContain('添加文件或文件夹')
    expect(container.textContent).toContain('命令')
    expect(container.textContent).not.toContain('技能')

    const commandButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.composer-actions-item'),
    ).find((button) => button.textContent?.trim() === '命令')
    await act(async () => commandButton?.click())

    const textarea = container.querySelector<HTMLTextAreaElement>('.chat-panel-input')
    expect(textarea?.value).toBe('/')
  })

  it('adds a host artifact drop to the composer and sends it with the turn', async () => {
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        on: vi.fn(() => () => undefined),
      },
    })
    const onSend = vi.fn(async () => undefined)
    const dataTransfer = {
      files: [],
      items: [],
      types: ['application/x-test-artifact'],
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    } as unknown as DataTransfer
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () =>
      root.render(
        <ChatPanel
          sessionId={null}
          onSend={onSend}
          canResolveDroppedAttachments={(transfer) =>
            transfer.types.includes('application/x-test-artifact')
          }
          resolveDroppedAttachments={() => [{ type: 'image', path: '/project/assets/shot.png' }]}
        />,
      ),
    )

    await act(async () => dispatchDrop(getChatPanel(container), dataTransfer))

    expect(container.textContent).toContain('shot.png')
    expect(toast.success).toHaveBeenCalledWith('已添加 1 个附件')

    const send = container.querySelector<HTMLButtonElement>('.chat-panel-send-btn')
    await act(async () => send?.click())
    expect(onSend).toHaveBeenCalledWith('请查看附件。', [
      { type: 'image', path: '/project/assets/shot.png' },
    ])
  })

  it('adds a local file drop and lets the user remove it before sending', async () => {
    const localFile = new File(['notes'], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        getPathForFile: vi.fn(() => '/project/notes.md'),
        invoke: vi.fn(async () => ({ kind: 'file' })),
        on: vi.fn(() => () => undefined),
      },
    })
    const dataTransfer = {
      files: [localFile],
      items: [{ kind: 'file', getAsFile: () => localFile }],
      types: ['Files'],
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    } as unknown as DataTransfer
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(<ChatPanel sessionId={null} />))
    await act(async () => dispatchDrop(getChatPanel(container), dataTransfer))

    expect(container.textContent).toContain('notes.md')
    expect(toast.success).toHaveBeenCalledWith('已添加 1 个附件')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="移除 notes.md"]')?.click()
    })
    expect(container.textContent).not.toContain('notes.md')
  })

  it('shows a clear error instead of adding a remote-only canvas artifact', async () => {
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        on: vi.fn(() => () => undefined),
      },
    })
    const dataTransfer = {
      files: [],
      items: [],
      types: ['application/x-test-artifact'],
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    } as unknown as DataTransfer
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () =>
      root.render(
        <ChatPanel
          sessionId={null}
          canResolveDroppedAttachments={(transfer) =>
            transfer.types.includes('application/x-test-artifact')
          }
          resolveDroppedAttachments={() => []}
        />,
      ),
    )
    await act(async () => dispatchDrop(getChatPanel(container), dataTransfer))

    expect(toast.error).toHaveBeenCalledWith('该产物没有可读取的本地文件，请先下载或物化产物。')
    expect(container.querySelector('.chat-panel-composer-attachments')).toBeNull()
  })
})
