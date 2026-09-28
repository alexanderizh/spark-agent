// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderProfile } from '@spark/protocol'
import { ProviderModelPicker } from './ComposerV2'
import { HOVER_REVEAL_OPEN_DELAY_MS } from './useHoverRevealCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (!(globalThis as { matchMedia?: unknown }).matchMedia) {
  ;(globalThis as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })
}

const PLAIN: ProviderProfile = {
  id: 'p-1',
  name: 'OpenCode 渠道',
  provider: 'openai',
  providerType: 'openai',
  enabled: true,
  defaultModel: 'deepseek-v4.1-flash',
  modelIds: ['deepseek-v4.1-flash'],
  keystoreRef: 'ks-p-1',
  isDefault: false,
  createdAt: '2026-09-29T00:00:00.000Z',
}

const ROUTER: ProviderProfile = {
  id: 'router-codex',
  name: 'Codex 系列',
  provider: 'auto-router',
  providerType: 'auto-router',
  enabled: true,
  defaultModel: '',
  modelIds: [],
  keystoreRef: 'ks-router-codex',
  isDefault: false,
  createdAt: '2026-09-29T00:00:00.000Z',
  autoRouterConfig: {
    kind: 'auto-router',
    version: 1,
    adapter: 'codex',
    dispatcher: { providerProfileId: 'p-1', modelId: 'deepseek-v4.1-flash', timeoutMs: 30_000 },
    executors: [
      {
        id: 'exec-high',
        providerProfileId: 'p-1',
        modelId: 'deepseek-v4.1-flash',
        intensity: 'high',
        enabled: true,
        reasoningEffort: 'max',
      },
      {
        id: 'exec-balanced',
        providerProfileId: 'p-1',
        modelId: 'deepseek-v4.1-flash',
        intensity: 'balanced',
        enabled: true,
        reasoningEffort: 'medium',
      },
      {
        id: 'exec-low',
        providerProfileId: 'p-1',
        modelId: 'gpt-5.6-luna',
        intensity: 'low',
        enabled: true,
        reasoningEffort: 'max',
      },
    ],
    fallbackIntensity: 'balanced',
    allowDecomposition: true,
    maxConcurrentSubtasks: 3,
    subagentIntensityMapping: true,
  },
}

/**
 * 回归背景：悬浮配置卡是 portal 到 document.body 的浮层，若渲染在 Dropdown 的
 * popupRender 内，popup 关闭后其子树不再随宿主状态更新，卡片会永久残留
 * （曾用 onSelect 里手动 dismiss 修过一次但无效）。因此卡片必须渲染在 popup 之外，
 * 并在菜单关闭时随宿主常规渲染一起卸载。
 */
describe('ProviderModelPicker 智能路由悬浮卡', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('.composer-auto-router-card').forEach((node) => node.remove())
    document.querySelectorAll('.ant-dropdown').forEach((node) => node.remove())
    vi.useRealTimers()
  })

  function renderPicker(onChange: (providerId: string, modelId: string) => void) {
    act(() =>
      root.render(
        <ProviderModelPicker
          icon={<span />}
          providers={[PLAIN, ROUTER]}
          selectedProviderId=""
          selectedModelId=""
          onChange={onChange}
        />,
      ),
    )
  }

  function card(): Element | null {
    return document.querySelector('.composer-auto-router-card')
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(60)
    })
  }

  it('菜单关闭后悬浮卡不再残留', async () => {
    const onChange = vi.fn()
    renderPicker(onChange)

    act(() => {
      document.querySelector<HTMLButtonElement>('.composer-select-trigger')?.click()
    })
    await flush()
    await flush()
    const row = document.querySelector<HTMLElement>('.composer-auto-router-row')
    expect(row).not.toBeNull()

    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(HOVER_REVEAL_OPEN_DELAY_MS)
    })
    await flush()
    expect(card()).not.toBeNull()

    act(() => {
      row?.querySelector<HTMLButtonElement>('.composer-menu-item')?.click()
    })
    // 关闭后推进动画/定时器，确认既不是“延迟消失”也不是“残留”
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    await flush()

    expect(card()).toBeNull()
    expect(onChange).toHaveBeenCalledWith(ROUTER.id, '')
  })
})
