// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

import { VoiceAssistantSettingsCard } from './VoiceAssistantSettingsCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖设置卡的 TTS 候选链路：`canvas:media-models:list` 的响应驱动
 * 「播报渠道 / 播报模型 / 音色」三行的候选与回落分支。
 * （候选推导本身在 voiceAssistantTtsOptions.test.ts 里逐条覆盖，这里只验接线与分支。）
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
const zhipu = speechModel(
  'p-zhipu',
  '智谱开放平台',
  'glm-tts',
  'GLM-TTS 语音合成',
  { type: 'string', examples: ['tongtong'], 'x-allow-custom': true },
  { voice: 'tongtong' },
)

describe('VoiceAssistantSettingsCard', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const stubSpark = (
    models: CanvasMediaModelSummary[],
    settingsPatch: Partial<VoiceAssistantSettings> = {},
  ): { updateSettings: ReturnType<typeof vi.fn> } => {
    const settings: VoiceAssistantSettings = {
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      ...settingsPatch,
    }
    const updateSettings = vi.fn(async (request: { settings: VoiceAssistantSettings }) => ({
      settings: request.settings,
    }))
    vi.stubGlobal('spark', {
      invoke: vi.fn(async (channel: string, request?: unknown) => {
        if (channel === 'voice-assistant:get-settings')
          return { settings, sessionAgent: null, status: null }
        if (channel === 'voice-assistant:get-status') return { status: { state: 'idle' } }
        if (channel === 'canvas:media-models:list') return { models }
        if (channel === 'voice-assistant:update-settings')
          return updateSettings(request as { settings: VoiceAssistantSettings })
        throw new Error(`unexpected channel: ${channel}`)
      }),
      on: vi.fn(() => vi.fn()),
    })
    return { updateSettings }
  }

  const renderCard = async (): Promise<void> => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<VoiceAssistantSettingsCard />)
    })
  }

  /** 按标题定位设置行：行内控件是兄弟节点，不能用 getByLabelText 之类语义查询。 */
  const rowFor = (title: string): HTMLElement => {
    const row = [...container.querySelectorAll('.settings-card-row')].find(
      (item) => item.querySelector('.row-title')?.textContent === title,
    )
    if (row == null) throw new Error(`未找到设置行：${title}`)
    return row as HTMLElement
  }

  /** antd v6 的选中项文案容器是 .ant-select-content（v5 的 selection-item 已不存在）。 */
  const selectionText = (title: string): string | undefined =>
    rowFor(title).querySelector('.ant-select-content')?.textContent?.trim()

  beforeEach(() => {
    // 真实 AutoComplete 展开下拉会挂 rc-virtual-list（resize-observer），jsdom 无该全局对象
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
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

  it('有语音渠道时渲染渠道/模型选择，音色用候选控件并提示渠道默认音色', async () => {
    stubSpark([minimax, zhipu])
    await renderCard()

    // 未显式指定渠道 → 展示「自动」档文案，而非空白控件或裸 id（哨兵值，不能用空串）。
    expect(selectionText('播报渠道')).toBe('自动（第一个可用语音渠道）')
    expect(selectionText('播报模型')).toBe('渠道默认模型')
    // 未指定渠道时模型选择锁定，避免模型脱离渠道后被误用。
    expect(rowFor('播报模型').querySelector('.ant-select-disabled')).not.toBeNull()
    // 音色：候选存在 → AutoComplete（提示生效渠道的默认音色），不再是手输降级 input。
    // antd v6 的占位文案渲染为独立节点，不落在 input 的 placeholder 属性上。
    const voiceRow = rowFor('音色')
    expect(voiceRow.querySelector('.ant-select-auto-complete')).not.toBeNull()
    expect(voiceRow.querySelector('.ant-select-placeholder')?.textContent).toBe(
      '默认（male-qn-qingse）',
    )
    expect(voiceRow.querySelector('input.ant-input')).toBeNull()
  })

  it('无语音渠道时回落：音色为手输框，模型选择为空且禁用', async () => {
    stubSpark([])
    await renderCard()

    const voiceInput = rowFor('音色').querySelector('input.ant-input')
    expect(voiceInput).not.toBeNull()
    expect(voiceInput?.getAttribute('placeholder')).toBe('默认音色')
    expect(rowFor('播报模型').querySelector('.ant-select-disabled')).not.toBeNull()
  })

  it('清单列举失败时设置仍可读，音色回落手输（不阻塞整卡）', async () => {
    vi.stubGlobal('spark', {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'voice-assistant:get-settings')
          return { settings: DEFAULT_VOICE_ASSISTANT_SETTINGS, sessionAgent: null, status: null }
        if (channel === 'voice-assistant:get-status') return { status: { state: 'idle' } }
        throw new Error('渠道服务不可用')
      }),
      on: vi.fn(() => vi.fn()),
    })
    await renderCard()

    expect(rowFor('音色').querySelector('input.ant-input')).not.toBeNull()
  })

  it('已保存的渠道已失效时补占位项，不暴露裸 provider id', async () => {
    stubSpark([minimax], { ttsProviderProfileId: 'p-removed' })
    await renderCard()

    expect(selectionText('播报渠道')).toBe('当前渠道（不在语音渠道列表）')
  })

  it('音色选中后再展开，候选不被输入框回显的已选值过滤成只剩一项', async () => {
    // 多候选模型：只有 ≥2 个候选才能区分「全量」与「只剩已选项」。
    const multiVoice = speechModel(
      'p-minimax',
      '自建 MiniMax',
      'speech-2.6-hd',
      'MiniMax Speech 2.6 HD',
      {
        type: 'string',
        examples: ['male-qn-qingse', 'female-shaonv', 'cute_boy'],
        'x-allow-custom': true,
      },
      { voice: 'male-qn-qingse' },
    )
    const { updateSettings } = stubSpark([multiVoice])
    await renderCard()

    /** jsdom 下驱动 rc-select：mousedown 展开，mousedown+click 选中候选。 */
    const press = async (el: EventTarget, type: string): Promise<void> => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
      })
    }
    const optionNodes = (): HTMLElement[] =>
      [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')].filter(
        (node) => node.textContent !== '',
      )
    const voiceInput = rowFor('音色').querySelector('input')
    expect(voiceInput).not.toBeNull()

    // 首次展开：全部候选可见。
    await press(voiceInput!, 'mousedown')
    expect(optionNodes()).toHaveLength(3)

    // 选中 female-shaonv：即持久化。
    const target = optionNodes().find((node) => node.textContent === 'female-shaonv')
    expect(target).toBeDefined()
    await press(target!, 'mousedown')
    await press(target!, 'click')
    await act(async () => {
      await Promise.resolve()
    })
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ ttsVoice: 'female-shaonv' }),
      }),
    )

    // 回归点：再次展开，输入框回填已选值，但候选必须是全量 3 项而非只剩已选项。
    await press(voiceInput!, 'mousedown')
    expect(optionNodes().map((node) => node.textContent)).toEqual([
      'male-qn-qingse',
      'female-shaonv',
      'cute_boy',
    ])
  })
})
