// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastMocks = vi.hoisted(() => {
  const toast = Object.assign(
    vi.fn(() => 'toast-id'),
    {
      success: vi.fn(() => 'toast-id'),
      error: vi.fn(() => 'toast-id'),
      info: vi.fn(() => 'toast-id'),
      warning: vi.fn(() => 'toast-id'),
    },
  )
  return { toast }
})

const appMocks = vi.hoisted(() => ({ setTweak: vi.fn() }))

vi.mock('../AppContext', () => ({
  useAppOptional: () => ({ setTweak: appMocks.setTweak }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: toastMocks.toast, dismiss: vi.fn(), toasts: [] }),
}))

import { VoiceAssistantButton, VoiceAssistantButtonView } from './VoiceAssistantButton'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('VoiceAssistantButtonView', () => {
  it('shows the wake shortcut on the idle button', () => {
    const html = renderToStaticMarkup(
      <VoiceAssistantButtonView state="idle" enabled shortcut="Alt+Space" onClick={vi.fn()} />,
    )

    expect(html).toContain('aria-label="语音对话（Alt+Space）"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('marks listening as active and offers cancel', () => {
    const html = renderToStaticMarkup(
      <VoiceAssistantButtonView state="listening" enabled shortcut="Alt+Space" onClick={vi.fn()} />,
    )

    expect(html).toContain('is-active')
    expect(html).toContain('aria-label="正在聆听，点击取消"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('explains a disabled assistant instead of a shortcut', () => {
    const html = renderToStaticMarkup(
      <VoiceAssistantButtonView
        state="idle"
        enabled={false}
        shortcut="Alt+Space"
        onClick={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="语音对话未启用，点击查看语音助手设置"')
    expect(html).not.toContain('is-active')
  })
})

describe('VoiceAssistantButton', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let stateHandler: ((event: Record<string, unknown>) => void) | null = null

  const settings = {
    enabled: true,
    wakeShortcut: 'Alt+Space',
  }

  const stubSpark = (trigger: ReturnType<typeof vi.fn>): void => {
    vi.stubGlobal('spark', {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'voice-assistant:get-status') return { status: { state: 'idle' } }
        if (channel === 'voice-assistant:get-settings') return { settings }
        if (channel === 'voice-assistant:trigger') return trigger()
        throw new Error(`unexpected channel: ${channel}`)
      }),
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:voice-assistant:state') stateHandler = callback
        return vi.fn()
      }),
    })
  }

  beforeEach(() => {
    toastMocks.toast.info.mockClear()
    toastMocks.toast.error.mockClear()
    appMocks.setTweak.mockClear()
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    stateHandler = null
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
  })

  it('triggers the voice assistant on click', async () => {
    const trigger = vi.fn(async () => ({ ok: true, message: '正在聆听' }))
    stubSpark(trigger)
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(toastMocks.toast.info).not.toHaveBeenCalled()
  })

  it('surfaces a rejected trigger with a shortcut to the voice settings', async () => {
    const trigger = vi.fn(async () => ({ ok: false, message: '语音助手未启用' }))
    stubSpark(trigger)
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(toastMocks.toast.info).toHaveBeenCalledWith('语音助手未启用', {
      actions: [expect.objectContaining({ label: '去设置' })],
    })
  })

  it('reports state-stream errors that the HUD cannot show', async () => {
    stubSpark(vi.fn(async () => ({ ok: true, message: '正在聆听' })))
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    await act(async () => {
      stateHandler?.({
        state: 'idle',
        previous: 'idle',
        reason: 'error',
        detail: '语音识别运行时未就绪，请先在设置中安装语音包',
      })
    })

    expect(toastMocks.toast.error).toHaveBeenCalledWith(
      '语音识别运行时未就绪，请先在设置中安装语音包',
      { actions: [expect.objectContaining({ label: '去设置' })] },
    )
  })
})
