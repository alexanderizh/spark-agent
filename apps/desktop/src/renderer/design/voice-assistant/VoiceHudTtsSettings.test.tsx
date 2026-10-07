// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

import { VoiceHudTtsSettings } from './VoiceHudTtsSettings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 播报设置条（胶囊分段式）的交互分支：收起/展开、哨兵档展示、
 * 语速分段条点击上抛、自定义音色占位。候选推导本身在 voiceAssistantTtsOptions.test.ts
 * 已覆盖，这里只验接线与分支（同设置卡测试的分工）。
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

  /** 按胶囊内嵌标签（Select prefix）定位胶囊：返回值即 .ant-select 根元素。 */
  const hasPill = (label: string): boolean =>
    [...container.querySelectorAll('.voice-hud-tts-pill')].some(
      (item) => item.querySelector('.voice-hud-tts-pill-label')?.textContent === label,
    )

  const pillFor = (label: string): HTMLElement => {
    const pill = [...container.querySelectorAll('.voice-hud-tts-pill')].find(
      (item) => item.querySelector('.voice-hud-tts-pill-label')?.textContent === label,
    )
    if (pill == null) throw new Error(`未找到胶囊：${label}`)
    return pill as HTMLElement
  }

  /** antd v6 的选中项文案容器是 .ant-select-content（v5 的 selection-item 已不存在）。 */
  const pillText = (label: string): string | undefined =>
    pillFor(label).querySelector('.ant-select-content')?.textContent?.trim()

  /** 语速分段条当前高亮档文案（is-active 档）。 */
  const activeSegLabel = (): string | undefined =>
    container.querySelector('.voice-hud-tts-seg-item.is-active')?.textContent ?? undefined

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

  it('默认收起：音色胶囊 + 语速分段条两行，空音色显示「默认」档、语速高亮 1', async () => {
    await renderHud()

    expect(hasPill('音色')).toBe(true)
    expect(hasPill('渠道')).toBe(false)
    expect(hasPill('模型')).toBe(false)
    // ttsVoice 为空串映射「默认」哨兵档（antd 空串会渲染成占位符，不能用空值）。
    expect(pillText('音色')).toBe('默认')

    // 语速六档分段条：免下拉一点即切，档位不带 ×（行首已有「语速」标签）
    const segItems = [...container.querySelectorAll('.voice-hud-tts-seg-item')]
    expect(segItems.map((node) => node.textContent)).toEqual([
      '0.5',
      '0.75',
      '1',
      '1.25',
      '1.5',
      '2',
    ])
    expect(activeSegLabel()).toBe('1')
    const activeItem = container.querySelector('.voice-hud-tts-seg-item.is-active')
    expect(activeItem?.getAttribute('aria-pressed')).toBe('true')

    // 收起态共三行：音色胶囊 / 语速分段条 / 展开钮（单独一行居中，固定末行）
    const rows = [...container.querySelectorAll('.voice-hud-tts-row')]
    expect(rows).toHaveLength(3)
    expect(rows[0]?.querySelector('.voice-hud-tts-pill-label')?.textContent).toBe('音色')
    expect(rows[1]?.querySelector('.voice-hud-tts-seg')).not.toBeNull()
    expect(rows[2]?.classList.contains('voice-hud-tts-toggle-row')).toBe(true)
    expect(rows[2]?.querySelector('.voice-hud-tts-toggle')).not.toBeNull()
  })

  it('点击展开钮后渠道/模型胶囊插到顶部，展开钮仍在末行居中，并持久化展开态', async () => {
    await renderHud()

    const toggle = container.querySelector<HTMLButtonElement>('.voice-hud-tts-toggle')
    expect(toggle).not.toBeNull()
    await press(toggle!, 'click')

    expect(hasPill('渠道')).toBe(true)
    expect(hasPill('模型')).toBe(true)
    // 展开后五行：渠道/模型/音色/语速/展开钮，钮位不随展开跳动。
    const rows = [...container.querySelectorAll('.voice-hud-tts-row')]
    expect(rows).toHaveLength(5)
    expect(rows[0]?.querySelector('.voice-hud-tts-pill-label')?.textContent).toBe('渠道')
    expect(rows[1]?.querySelector('.voice-hud-tts-pill-label')?.textContent).toBe('模型')
    expect(rows[2]?.querySelector('.voice-hud-tts-pill-label')?.textContent).toBe('音色')
    expect(rows[4]?.classList.contains('voice-hud-tts-toggle-row')).toBe(true)
    expect(rows[4]?.querySelector('.voice-hud-tts-toggle')).not.toBeNull()
    // 未显式指定时渠道/模型显示哨兵档而非空白或裸 id。
    expect(pillText('渠道')).toBe('自动')
    expect(pillText('模型')).toBe('默认')
    expect(window.localStorage.getItem('voice-hud-tts-expanded')).toBe('1')
  })

  it('点语速分段条档位直接触发 onPatch 落值（免下拉）', async () => {
    const { onPatch } = await renderHud()

    const item = [...container.querySelectorAll<HTMLElement>('.voice-hud-tts-seg-item')].find(
      (node) => node.textContent === '0.75',
    )
    expect(item).toBeDefined()
    await press(item!, 'click')

    expect(onPatch).toHaveBeenCalledWith({ ttsSpeed: 0.75 })
  })

  it('音色自定义值不在候选时补占位 option 展示原值', async () => {
    await renderHud({ ttsVoice: 'my-cloned-voice' })

    // 胶囊文案直接展示原值，不静默改写用户配置。
    expect(pillText('音色')).toBe('my-cloned-voice')
    await press(pillFor('音色'), 'mousedown')
    const optionTexts = [...document.querySelectorAll('.ant-select-item-option')].map(
      (node) => node.textContent,
    )
    expect(optionTexts).toContain('my-cloned-voice')
    expect(optionTexts).toContain('默认')
    expect(optionTexts).toContain('male-qn-qingse')
  })

  it('非档位语速高亮最近档位（1.12 → 1），不回写设置', async () => {
    await renderHud({ ttsSpeed: 1.12 })

    expect(activeSegLabel()).toBe('1')
  })

  it('展开的下拉弹层 z-index 抬到 2300，高于 HUD 卡根（2200），不被卡片遮挡', async () => {
    await renderHud()

    await press(pillFor('音色'), 'mousedown')

    // 弹层 portal 到 body 且真实挂载。cssVar 模式下 z-index 不走 inline style，
    // 而是弹层自带 css-var 作用域类 + ant-select-css-var，经组件 token 变量下发。
    const popup = document.querySelector('.ant-select-dropdown')
    expect(popup).not.toBeNull()
    expect(popup!.classList.contains('ant-select-css-var')).toBe(true)
    const popupScopeClass = [...popup!.classList].find((name) => name.startsWith('css-var-'))
    expect(popupScopeClass).toBeDefined()
    if (popupScopeClass == null) return // 上面的 expect 已兜底，这里仅为类型收窄

    // 断言该作用域把 --ant-select-z-index-popup 定义为 2300（antd 默认 1050）：
    // 弹层规则 z-index: var(--ant-select-z-index-popup) 由此解析为 2300 > 卡根 2200。
    const hasScopedZRule = [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText?.includes(popupScopeClass) === true &&
            /--ant-select-z-index-popup:\s*2300\b/.test(rule.cssText),
        )
      } catch {
        // 跨源样式表 jsdom 读不了 cssRules，跳过
        return false
      }
    })
    expect(hasScopedZRule).toBe(true)
  })
})
