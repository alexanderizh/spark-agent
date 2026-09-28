// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderProfile } from '@spark/protocol'
import { ProviderModelPicker } from './ComposerV2'
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

const { updateProvider } = vi.hoisted(() => ({
  updateProvider: vi.fn(async () => ({ profile: null })),
}))
// 该测试只挂载 ProviderModelPicker（不含 AppProvider/ToastProvider），
// 用桩替换 useToast，聚焦验证入口与弹窗挂载位置。
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }),
}))
vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: updateProvider }),
  useIpcSend: () => ({ send: vi.fn() }),
  useIpcOn: () => ({ on: vi.fn() }),
}))

const CHANNEL: ProviderProfile = {
  id: 'p-hidden',
  name: '模型设置渠道',
  provider: 'openai',
  providerType: 'openai',
  enabled: true,
  defaultModel: 'model-a',
  modelIds: ['model-a', 'model-b'],
  modelSettings: { 'model-b': { hidden: true } },
  keystoreRef: 'ks-p-hidden',
  isDefault: false,
  createdAt: '2026-09-29T00:00:00.000Z',
}

/**
 * 「模型设置」入口与隐藏过滤的集成验证：
 * - 隐藏模型（modelSettings.hidden）不进选择器列表，但未被删除、选中态不受影响
 * - 列表页脚「模型设置」可打开弹窗（弹窗挂在 Dropdown 之外）
 */
describe('ProviderModelPicker · 模型设置入口', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    updateProvider.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('.ant-dropdown').forEach((node) => node.remove())
    document.querySelectorAll('.mv_settings_modal').forEach((node) => node.remove())
  })

  function renderPicker() {
    act(() =>
      root.render(
        <ProviderModelPicker
          icon={<span />}
          providers={[CHANNEL]}
          selectedProviderId={CHANNEL.id}
          selectedModelId="model-a"
          onChange={vi.fn()}
        />,
      ),
    )
  }

  async function openMenu() {
    act(() => {
      document.querySelector<HTMLButtonElement>('.composer-select-trigger')?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('隐藏模型不出现在选择器列表中（其余模型与渠道保持可见）', async () => {
    renderPicker()
    await openMenu()
    const labels = Array.from(document.querySelectorAll('.composer-model-item')).map((node) =>
      node.textContent?.trim(),
    )
    expect(labels.some((label) => label?.includes('model-a'))).toBe(true)
    expect(labels.some((label) => label?.includes('model-b'))).toBe(false)
  })

  it('列表页脚「模型设置」点击后打开弹窗', async () => {
    renderPicker()
    await openMenu()
    const entry = document.querySelector<HTMLButtonElement>('.composer-model-manage')
    expect(entry?.textContent).toContain('模型设置')
    act(() => entry?.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain('思考强度')
    expect(document.querySelector('.mv_settings_modal')).not.toBeNull()
  })
})
