// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { message } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setTweak = vi.fn()

vi.mock('../../AppContext', () => ({
  useApp: () => ({
    t: { sidebarHidden: false, density: 'regular' },
    setTweak,
  }),
  useAppOptional: () => null,
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

import { QuickCreateView } from './QuickCreateView'

/** TTS 模型清单：只有语音模式才会用到。 */
const AUDIO_MODEL = {
  manifestId: 'tts-manifest',
  providerProfileId: 'tts-provider',
  providerName: '语音渠道',
  providerKind: 'openai-compatible',
  modelId: 'qwen3-tts-flash',
  effectiveModelId: 'qwen3-tts-flash',
  displayName: 'Qwen3 TTS',
  domains: ['audio'],
  invocationMode: 'sync',
  capabilities: [
    {
      id: 'audio.speech',
      label: '语音合成',
      input: { required: ['prompt'], maxImages: 0 },
      output: { types: ['audio'] },
      paramSchema: {},
    },
  ],
  sourceUrls: [],
  enabled: true,
}

/** 记录每个 IPC 通道的调用参数，供断言「语音模式只查 audio.speech」。 */
let invocations: Array<{ channel: string; payload: unknown }> = []

function installSparkBridge(audioModels: unknown[]) {
  invocations = []
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string, payload?: unknown) => {
        invocations.push({ channel, payload })
        if (channel === 'canvas:media-models:list') {
          const capability = (payload as { capability?: string } | undefined)?.capability
          return { models: capability === 'audio.speech' ? audioModels : [] }
        }
        if (channel === 'provider:list') return { profiles: [] }
        if (channel === 'settings:get') return { value: null }
        return {}
      }),
      // 视图内的 media/text 进度订阅要求返回退订函数
      on: vi.fn(() => () => {}),
    },
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('QuickCreateView 语音模式', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    installSparkBridge([AUDIO_MODEL])
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
    await act(async () => {})
  })

  function modeButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-create-mode')).find(
      (button) => button.textContent === label,
    )
  }

  it('模式 rail 提供「语音」，切过去后隐藏素材区并把输入区改为文稿', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()

    expect(modeButton('语音')).not.toBeUndefined()
    // 默认生图模式有素材区
    expect(document.querySelector('.quick-create-reference-section')).not.toBeNull()

    await act(async () => modeButton('语音')?.click())

    expect(document.querySelector('.quick-create-reference-section')).toBeNull()
    expect(document.body.textContent).toContain('文稿')
    expect(document.querySelector('#quick-create-prompt')?.getAttribute('placeholder')).toContain(
      '输入要转换为语音的文稿',
    )
    expect(document.body.textContent).toContain('输入文稿，选择合适的音色后合成语音')
    expect(document.body.textContent).toContain('生成语音')
  })

  it('语音模式按 audio.speech 查询模型，未配置渠道时给空态引导并可跳转配置页', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()
    await act(async () => modeButton('语音')?.click())
    await flush()

    const capabilityQueries = invocations
      .filter((item) => item.channel === 'canvas:media-models:list')
      .map((item) => (item.payload as { capability?: string }).capability)
    expect(capabilityQueries).toContain('audio.speech')

    // 该渠道声明了 audio.speech，应进入兼容模型列表而不是空态
    expect(document.body.textContent).not.toContain('暂无已启用的语音模型')
  })

  it('未配置任何语音模型时显示空态文案与「去配置」入口', async () => {
    installSparkBridge([])
    await act(async () => root.render(<QuickCreateView />))
    await flush()
    await act(async () => modeButton('语音')?.click())
    await flush()

    expect(document.body.textContent).toContain('暂无已启用的语音模型')
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '去配置',
    )
    expect(action).not.toBeUndefined()
    act(() => action?.click())
    expect(setTweak).toHaveBeenCalledWith('view', 'providers')
  })

  it('只有文稿为空时禁用生成；填入文稿且存在语音模型后可提交', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()
    await act(async () => modeButton('语音')?.click())
    await flush()

    const generateButton = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        button.textContent?.includes('生成语音'),
      )
    expect(generateButton()?.disabled).toBe(true)

    const textarea = document.querySelector<HTMLTextAreaElement>('#quick-create-prompt')
    await act(async () => {
      if (!textarea) return
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(textarea, '欢迎收听今天的早间资讯')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(generateButton()?.disabled).toBe(false)
  })

  it('语音模式下粘贴图片被拦下并给出专门提示，不进入素材列表', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()
    await act(async () => modeButton('语音')?.click())
    await flush()

    const warning = vi.spyOn(message, 'warning').mockImplementation(() => undefined as never)
    const form = document.querySelector('.quick-create-form')
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }),
          },
        ],
      },
    })
    await act(async () => {
      form?.dispatchEvent(pasteEvent)
    })

    expect(warning).toHaveBeenCalledWith('语音模式只需输入文稿，不支持添加素材')
    expect(document.querySelector('.quick-create-input-list')).toBeNull()
    warning.mockRestore()
  })
})
