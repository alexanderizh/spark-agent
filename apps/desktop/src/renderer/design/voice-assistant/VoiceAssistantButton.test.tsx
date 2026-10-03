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

const appMocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  requestConfirm: vi.fn(async (..._options: unknown[]) => true),
}))

vi.mock('../AppContext', () => ({
  useAppOptional: () => ({ setTweak: appMocks.setTweak, requestConfirm: appMocks.requestConfirm }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: toastMocks.toast, dismiss: vi.fn(), toasts: [] }),
}))

import { VoiceAssistantButton, VoiceAssistantButtonView } from './VoiceAssistantButton'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY_STATUS = {
  ready: true,
  downloading: false,
  supported: true,
  unsupportedReason: null,
  components: [],
  lastError: null,
}

const MISSING_STATUS = { ...READY_STATUS, ready: false }

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

  it('mentions the pack download while it is in progress', () => {
    const html = renderToStaticMarkup(
      <VoiceAssistantButtonView
        state="idle"
        enabled
        shortcut="Alt+Space"
        downloading
        onClick={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="语音包下载中，完成后自动开始…"')
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

  interface SparkStubOptions {
    /** voice:check-integrity 返回的完整性状态（本地与云端两次检查共用） */
    integrityStatus?: typeof READY_STATUS
  }

  const stubSpark = (
    trigger: ReturnType<typeof vi.fn>,
    options: SparkStubOptions = {},
  ): { invokes: string[]; pushStatus: (status: Record<string, unknown>) => void } => {
    const invokes: string[] = []
    const statusHandlers: Array<(s: Record<string, unknown>) => void> = []
    vi.stubGlobal('spark', {
      invoke: vi.fn(async (channel: string, payload?: Record<string, unknown>) => {
        invokes.push(channel)
        if (channel === 'voice-assistant:get-status') return { status: { state: 'idle' } }
        if (channel === 'voice-assistant:get-settings') return { settings }
        if (channel === 'voice-assistant:trigger') return trigger()
        if (channel === 'voice:check-integrity') {
          return { status: options.integrityStatus ?? READY_STATUS }
        }
        if (channel === 'voice:install') {
          return { status: { ...(options.integrityStatus ?? READY_STATUS), ready: true } }
        }
        throw new Error(`unexpected channel: ${channel} ${JSON.stringify(payload ?? {})}`)
      }),
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:voice-assistant:state') stateHandler = callback
        if (channel === 'stream:voice:status') statusHandlers.push(callback)
        return vi.fn()
      }),
    })
    return {
      invokes,
      pushStatus: (s: Record<string, unknown>) => statusHandlers.forEach((h) => h(s)),
    }
  }

  beforeEach(() => {
    toastMocks.toast.info.mockClear()
    toastMocks.toast.error.mockClear()
    appMocks.setTweak.mockClear()
    appMocks.requestConfirm.mockClear()
    appMocks.requestConfirm.mockImplementation(async () => true)
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

  const clickButton = async (): Promise<void> => {
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('triggers the voice assistant on click when the pack is ready', async () => {
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
    expect(appMocks.requestConfirm).not.toHaveBeenCalled()
  })

  it('offers the pack download instead of a raw error when missing', async () => {
    const trigger = vi.fn(async () => ({ ok: true, message: '正在聆听' }))
    const { invokes } = stubSpark(trigger, { integrityStatus: MISSING_STATUS })
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })
    invokes.length = 0

    await clickButton()

    // 不直接 trigger，而是先弹下载确认框（mock 中安装即时完成，随后自动唤醒属预期）
    expect(appMocks.requestConfirm).toHaveBeenCalledTimes(1)
    const options = appMocks.requestConfirm.mock.calls[0]?.[0] as { title?: string }
    expect(options.title).toBe('下载语音包？')
    // 确认后进入后台安装
    expect(invokes).toContain('voice:install')
  })

  it('skips triggering when the user declines the download', async () => {
    appMocks.requestConfirm.mockImplementation(async () => false)
    const trigger = vi.fn(async () => ({ ok: true, message: '正在聆听' }))
    const { invokes } = stubSpark(trigger, { integrityStatus: MISSING_STATUS })
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })
    invokes.length = 0

    await clickButton()

    expect(appMocks.requestConfirm).toHaveBeenCalledTimes(1)
    expect(invokes).not.toContain('voice:install')
    expect(trigger).not.toHaveBeenCalled()
    expect(toastMocks.toast.error).not.toHaveBeenCalled()
  })

  it('starts a voice turn automatically once the confirmed install finishes', async () => {
    const trigger = vi.fn(async () => ({ ok: true, message: '正在聆听' }))
    const { invokes } = stubSpark(trigger, { integrityStatus: MISSING_STATUS })
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    await clickButton()
    expect(appMocks.requestConfirm).toHaveBeenCalledTimes(1)

    // voice:install 完成后 integrity.ready 翻转（install 内部 setStatus），随后自动唤醒；
    // mock 中安装即时完成，因此无需额外等待
    await act(async () => {
      await vi.waitFor(() => {
        expect(invokes).toContain('voice:install')
        expect(trigger).toHaveBeenCalledTimes(1)
      })
    })
  })

  it('keeps triggering normally while the integrity check is still running', async () => {
    // check-integrity 未返回前 ready 是初始 false，但 checking 未决：直接 trigger 兜底
    const trigger = vi.fn(async () => ({ ok: true, message: '正在聆听' }))
    vi.stubGlobal('spark', {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'voice-assistant:get-status') return { status: { state: 'idle' } }
        if (channel === 'voice-assistant:get-settings') return { settings }
        if (channel === 'voice-assistant:trigger') return trigger()
        // 完整性检查挂起（不 resolve 的场景用长延时代替，避免挂住测试）
        return new Promise((resolve) => setTimeout(() => resolve({ status: MISSING_STATUS }), 500))
      }),
      on: vi.fn(() => vi.fn()),
    })
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    await clickButton()

    expect(appMocks.requestConfirm).not.toHaveBeenCalled()
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected trigger with a shortcut to the voice settings', async () => {
    const trigger = vi.fn(async () => ({ ok: false, message: '语音助手未启用' }))
    stubSpark(trigger)
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })

    await clickButton()

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

  it('adds a download action to error toasts when the pack is missing', async () => {
    stubSpark(
      vi.fn(async () => ({ ok: true, message: '正在聆听' })),
      {
        integrityStatus: MISSING_STATUS,
      },
    )
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantButton />)
    })
    // 等本地完整性检查落定（checking 结束），错误 toast 才补下载动作
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
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
      {
        actions: [
          expect.objectContaining({ label: '下载语音包' }),
          expect.objectContaining({ label: '去设置' }),
        ],
      },
    )
  })
})
