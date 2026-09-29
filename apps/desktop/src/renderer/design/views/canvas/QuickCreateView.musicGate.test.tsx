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

// @lobehub/ui 间接 import @emoji-mart/data（裸 JSON 入口），Node ESM 严格模式不允许；
// 视图只用到 Button，mock 成原生 button 即可（先例见 QuickCreateView.audio.test.tsx）。
vi.mock('@lobehub/ui', () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode }) =>
    React.createElement('button', { ...rest, 'data-mock': 'lobe-button' }, children),
}))

import { QuickCreateView } from './QuickCreateView'

const PREFERENCES_KEY = 'spark-canvas:quick-create-preferences:v1'
const TASKS_KEY = 'spark-canvas:quick-create-tasks:v1'

/** 一条已完成的音乐任务：隐藏入口后它仍应作为真实历史可查看，但不能被重放。 */
const MUSIC_TASK = {
  id: 'music-task-1',
  mode: 'music',
  operation: 'text_to_audio',
  prompt: '轻快的电子流行，夏日海边的午后',
  inputFiles: [],
  modelParams: {},
  status: 'succeeded',
  assets: [],
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
}

/** 记录 IPC 通道调用，供断言「隐藏模式不会真的发起生成请求」。 */
let invocations: Array<{ channel: string; payload: unknown }> = []

/** 音乐模式实现已经落地，但入口默认不对外开放（见 quickCreateModeAvailability）。 */
function installSparkBridge() {
  invocations = []
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string, payload?: unknown) => {
        invocations.push({ channel, payload })
        if (channel === 'canvas:media-models:list') return { models: [] }
        if (channel === 'provider:list') return { profiles: [] }
        if (channel === 'settings:get') return { value: null }
        return {}
      }),
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

function modeButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-create-mode'))
}

function modeButton(label: string): HTMLButtonElement | undefined {
  return modeButtons().find((button) => button.textContent === label)
}

function historyTab(): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('.quick-create-result-tabs button'),
  ).find((button) => button.textContent?.includes('创作历史'))
}

describe('QuickCreateView 音乐模式入口默认隐藏', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    installSparkBridge()
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

  it('模式 rail 不渲染「音乐」，其余 5 个模式照常可见', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()

    expect(modeButtons().map((button) => button.textContent)).toEqual([
      '生图',
      '反推',
      '视频',
      '语音',
      '识别',
    ])
    expect(modeButton('音乐')).toBeUndefined()
  })

  it('历史筛选页签同样没有「音乐」，不与「全部」口径打架', async () => {
    await act(async () => root.render(<QuickCreateView />))
    await flush()

    await act(async () => historyTab()?.click())
    await flush()

    const filters = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.quick-create-history-filters button'),
    ).map((button) => button.textContent)
    expect(filters.some((label) => label?.includes('音乐'))).toBe(false)
    expect(filters.some((label) => label?.includes('全部'))).toBe(true)
    expect(filters.some((label) => label?.includes('识别'))).toBe(true)
  })

  it('历史偏好里残留的音乐模式会被收窄为图片模式，不出现无页签高亮的隐形模式', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ mode: 'music' }))

    await act(async () => root.render(<QuickCreateView />))
    await flush()

    // 图片模式才有的参考素材区在，说明初始模式已经落到 image
    expect(document.querySelector('.quick-create-reference-section')).not.toBeNull()
    // 提示词区标题为图片模式的「提示词」，而不是音乐模式的「音乐描述」
    expect(document.body.textContent).toContain('提示词')
    expect(document.body.textContent).not.toContain('音乐描述')
    // 生成按钮也不是音乐模式文案
    expect(document.body.textContent).not.toContain('生成音乐')
  })

  it('隐藏模式的历史记录仍可查看，但「重新生成」被拦下且不会发起请求', async () => {
    window.localStorage.setItem(TASKS_KEY, JSON.stringify([MUSIC_TASK]))

    await act(async () => root.render(<QuickCreateView />))
    await flush()

    await act(async () => historyTab()?.click())
    await flush()

    // 记录本身不隐藏：真实产物与历史仍能在「全部」里查看
    expect(document.querySelector('.quick-create-task-main')).not.toBeNull()
    expect(document.body.textContent).toContain('音乐')

    // 展开行后点「重新生成」
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.quick-create-task-main')?.click(),
    )
    await flush()

    const warning = vi.spyOn(message, 'warning').mockImplementation(() => undefined as never)
    const retryButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '重新生成',
    )
    expect(retryButton).not.toBeUndefined()
    await act(async () => retryButton?.click())
    await flush()

    expect(warning).toHaveBeenCalledWith('音乐模式暂未对外开放')
    expect(invocations.some((item) => item.channel === 'canvas:task:create-media')).toBe(false)
    warning.mockRestore()
  })
})
