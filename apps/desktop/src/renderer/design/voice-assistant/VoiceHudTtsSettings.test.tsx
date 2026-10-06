// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

import { VoiceHudTtsSettings } from './VoiceHudTtsSettings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 播报设置条的交互分支：收起/展开、哨兵档展示、语速档位上抛、
 * 自定义音色占位。候选推导本身在 voiceAssistantTtsOptions.test.ts 已覆盖，
 * 这里只验接线与分支（同设置卡测试的分工）。
 */
function speechModel(
  providerProfileId: string,
  providerName: string,
  modelId: string,
  displayName: string,
  paramSchema: Record<string, unknown>,
  capabilityDefaults?: Record<string, unknown>,
): CanvasMediaModelSummary {
  return {
    manifestId: `${providerProfileId}:${modelId}`,
    providerProfileId,
    providerName,
    providerKind: 'custom',
    modelId,
    effectiveModelId: modelId,
    displayName,
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: { required: ['text'] },
        output: { types: ['audio'], mimeTypes: ['audio/mpeg'] },
        paramSchema: { type: 'object', properties: { voice: paramSchema } },
        ...(capabilityDefaults !== undefined ? { defaults: capabilityDefaults } : {}),
      },
    ],
    sourceUrls: [],
    enabled: true,
  }
}

const minimax = speechModel(
  'p-minimax',
  '自建 MiniMax',
  'speech-2.6-hd',
  'MiniMax Speech 2.6 HD',
  { type: 'string', examples: ['male-qn-qingse'], 'x-allow-custom': true },
  { voice: 'male-qn-qingse' },
)

describe('VoiceHudTtsSettings', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const renderHud = async (
    settingsPatch: Partial<VoiceAssistantSettings> = {},
  ): Promise<{ onPatch: ReturnType<typeof vi.fn> }> => {
    const onPatch = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <VoiceHudTtsSettings
          settings={{ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ...settingsPatch }}
          models={[minimax]}
          onPatch={onPatch}
        />,
      )
    })
    return { onPatch }
  }

  /** 按前置小标签定位字段单元：Select 是兄弟节点，不能用语义查询。 */
  const hasField = (label: string): boolean =>
    [...container.querySelectorAll('.voice-hud-tts-field')].some(
      (item) => item.querySelector('.voice-hud-tts-label')?.textContent === label,
    )

  const fieldFor = (label: string): HTMLElement => {
    const field = [...container.querySelectorAll('.voice-hud-tts-field')].find(
      (item) => item.querySelector('.voice-hud-tts-label')?.textContent === label,
    )
    if (field == null) throw new Error(`未找到字段：${label}`)
    return field as HTMLElement
  }

  /** antd v6 的选中项文案容器是 .ant-select-content（v5 的 selection-item 已不存在）。 */
  const selectionText = (label: string): string | undefined =>
    fieldFor(label).querySelector('.ant-select-content')?.textContent?.trim()

  /** jsdom 下驱动 rc-select / 原生按钮：dispatch 冒泡事件。 */
  const press = async (el: EventTarget, type: string): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    })
  }

  beforeEach(() => {
    // antd Select 展开下拉会挂 rc-virtual-list（resize-observer），jsdom 无该全局对象
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    window.localStorage.removeItem('voice-hud-tts-expanded')
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
  })

  it('默认收起：只渲染音色与语速，空音色显示「默认」档、语速显示 1×', async () => {
    await renderHud()

    expect(hasField('音色')).toBe(true)
    expect(hasField('语速')).toBe(true)
    expect(hasField('渠道')).toBe(false)
    expect(hasField('模型')).toBe(false)
    // ttsVoice 为空串映射「默认」哨兵档（antd 空串会渲染成占位符，不能用空值）。
    expect(selectionText('音色')).toBe('默认')
    expect(selectionText('语速')).toBe('1×')
  })

  it('点击展开钮后渠道/模型出现在收起行上方，并持久化展开态', async () => {
    await renderHud()

    const toggle = container.querySelector<HTMLButtonElement>('.voice-hud-tts-toggle')
    expect(toggle).not.toBeNull()
    await press(toggle!, 'click')

    expect(hasField('渠道')).toBe(true)
    expect(hasField('模型')).toBe(true)
    // 展开行在收起行上方：第一行第一个标签是「渠道」。
    const firstRow = container.querySelector('.voice-hud-tts-row')
    expect(firstRow?.querySelector('.voice-hud-tts-label')?.textContent).toBe('渠道')
    // 未显式指定时渠道/模型显示哨兵档而非空白或裸 id。
    expect(selectionText('渠道')).toBe('自动')
    expect(selectionText('模型')).toBe('默认')
    expect(window.localStorage.getItem('voice-hud-tts-expanded')).toBe('1')
  })

  it('选语速档位触发 onPatch 落值', async () => {
    const { onPatch } = await renderHud()

    const speedSelect = fieldFor('语速').querySelector('.ant-select')
    expect(speedSelect).not.toBeNull()
    await press(speedSelect!, 'mousedown')
    const option = [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')].find(
      (node) => node.textContent === '0.75×',
    )
    expect(option).toBeDefined()
    await press(option!, 'mousedown')
    await press(option!, 'click')

    expect(onPatch).toHaveBeenCalledWith({ ttsSpeed: 0.75 })
  })

  it('音色自定义值不在候选时补占位 option 展示原值', async () => {
    await renderHud({ ttsVoice: 'my-cloned-voice' })

    // 选中文案直接展示原值，不静默改写用户配置。
    expect(selectionText('音色')).toBe('my-cloned-voice')
    const voiceSelect = fieldFor('音色').querySelector('.ant-select')
    expect(voiceSelect).not.toBeNull()
    await press(voiceSelect!, 'mousedown')
    const optionTexts = [...document.querySelectorAll('.ant-select-item-option')].map(
      (node) => node.textContent,
    )
    expect(optionTexts).toContain('my-cloned-voice')
    expect(optionTexts).toContain('默认')
    expect(optionTexts).toContain('male-qn-qingse')
  })

  it('非档位语速显示最近档位（1.12 → 1×），不回写设置', async () => {
    await renderHud({ ttsSpeed: 1.12 })

    expect(selectionText('语速')).toBe('1×')
  })
})
