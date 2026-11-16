// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteMessageList, type RemoteUserItem } from './RemoteMessageList'
import type { RemoteTimelineItem } from './remoteEventMerge'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const speechMocks = vi.hoisted(() => ({
  available: true,
  toggle: vi.fn(),
  getStatusFor: vi.fn(() => 'off' as const),
  subscribe: vi.fn(() => () => undefined),
  player: null as unknown,
}))
speechMocks.player = {
  toggle: speechMocks.toggle,
  getStatusFor: speechMocks.getStatusFor,
  subscribe: speechMocks.subscribe,
}

vi.mock('../chat/MessageTtsPlayer', () => ({
  getMessageTtsPlayer: () => speechMocks.player,
}))

vi.mock('../chat/useMessageTtsAvailable', () => ({
  useMessageTtsAvailable: () => speechMocks.available,
}))

vi.mock('../chat/ChatMarkdown', () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: vi.fn(async () => ({ opened: true })) }),
}))

vi.mock('../../hooks/useAppearance', () => ({
  readAppearance: () => ({ timestampFormat: 'abs' }),
}))

vi.mock('./RemoteAttachmentStrip', () => ({
  RemoteAttachmentStrip: () => null,
}))

vi.mock('./RemoteDocPreview', () => ({
  RemoteDocPreview: () => null,
}))

vi.mock('./RemoteFileCards', () => ({
  RemoteFileCards: () => null,
}))

vi.mock('./RemoteHtmlPreview', () => ({
  RemoteHtmlPreview: () => null,
}))

describe('RemoteMessageList message actions', () => {
  let container: HTMLDivElement
  let root: Root
  let writeClipboard: ReturnType<typeof vi.fn>

  beforeEach(() => {
    speechMocks.available = true
    speechMocks.toggle.mockClear()
    speechMocks.getStatusFor.mockReset().mockReturnValue('off')
    speechMocks.subscribe.mockClear()
    writeClipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeClipboard },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(
    items: RemoteTimelineItem[],
    onReuseUserMessage?: (item: RemoteUserItem) => void,
  ) {
    act(() => {
      root.render(
        <RemoteMessageList
          items={items}
          deviceId="device-1"
          {...(onReuseUserMessage != null ? { onReuseUserMessage } : {})}
        />,
      )
    })
  }

  it('远程用户消息保留复制和重发，助手消息提供复制与朗读', async () => {
    const userItem: RemoteUserItem = {
      kind: 'user',
      id: 'user-1',
      seq: 1,
      turnId: 'turn-user-1',
      text: 'question',
      attachments: [],
    }
    const assistantItem: Extract<RemoteTimelineItem, { kind: 'assistant' }> = {
      kind: 'assistant',
      id: 'assistant-1',
      seq: 2,
      turnId: 'turn-1',
      text: 'remote answer',
      streaming: false,
    }
    const onReuse = vi.fn()

    render([userItem, assistantItem], onReuse)

    expect(container.querySelector('.rc-msg-user .msg-hover-copy')).not.toBeNull()
    const resend = container.querySelector<HTMLButtonElement>('.rc-msg-user .msg-hover-resend')
    expect(resend).not.toBeNull()
    act(() => resend?.click())
    expect(onReuse).toHaveBeenCalledWith(userItem)

    const copy = container.querySelector<HTMLButtonElement>('.rc-msg-assistant .msg-hover-copy')
    expect(copy).not.toBeNull()
    await act(async () => {
      copy?.click()
      await Promise.resolve()
    })
    expect(writeClipboard).toHaveBeenCalledWith('remote answer')

    const speech = container.querySelector<HTMLButtonElement>('.rc-msg-assistant .msg-hover-speech')
    expect(speech?.getAttribute('aria-label')).toBe('朗读')
    act(() => speech?.click())
    expect(speechMocks.toggle).toHaveBeenCalledWith('remote:device-1:assistant-1', 'remote answer')
  })

  it('当前没有可用 TTS 模型时仍可复制，但不显示朗读入口', () => {
    speechMocks.available = false
    render([
      {
        kind: 'assistant',
        id: 'assistant-2',
        seq: 1,
        turnId: 'turn-2',
        text: 'remote answer',
        streaming: false,
      },
    ])

    expect(container.querySelector('.rc-msg-assistant .msg-hover-copy')).not.toBeNull()
    expect(container.querySelector('.rc-msg-assistant .msg-hover-speech')).toBeNull()
  })
})
