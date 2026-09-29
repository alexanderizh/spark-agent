import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'

import {
  resolveTtsChannelId,
  resolveTtsModel,
  ttsChannelModels,
  ttsChannelOptions,
  ttsVoiceOptions,
} from './voiceAssistantTtsOptions'

/**
 * 用例贴近真实语音渠道：MiniMax（examples + x-allow-custom，8 个精选音色）
 * 与智谱 glm-tts（同步音色目录写入 examples + x-template-labels 可读名）。
 */
function speechModel(
  providerProfileId: string,
  providerName: string,
  modelId: string,
  displayName: string,
  voiceSchema: Record<string, unknown>,
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
        paramSchema: { type: 'object', properties: { voice: voiceSchema } },
      },
    ],
    sourceUrls: [],
    enabled: true,
  }
}

const minimaxVoice = {
  type: 'string',
  examples: ['male-qn-qingse', 'female-shaonv'],
  'x-allow-custom': true,
}

const minimax = speechModel(
  'p-minimax',
  '自建 MiniMax',
  'speech-2.6-hd',
  'MiniMax Speech 2.6 HD',
  minimaxVoice,
)
const minimaxFlash = speechModel(
  'p-minimax',
  '自建 MiniMax',
  'speech-2.6-turbo',
  'MiniMax Speech 2.6 Turbo',
  minimaxVoice,
)
const zhipu = speechModel('p-zhipu', '智谱开放平台', 'glm-tts', 'GLM-TTS 语音合成', {
  type: 'string',
  examples: ['tongtong', 'my-cloned-voice'],
  'x-allow-custom': true,
  'x-template-labels': { tongtong: '彤彤' },
})

describe('ttsChannelOptions', () => {
  it('按清单顺序去重渠道并展示渠道名', () => {
    expect(ttsChannelOptions([minimax, minimaxFlash, zhipu])).toEqual([
      { value: 'p-minimax', label: '自建 MiniMax' },
      { value: 'p-zhipu', label: '智谱开放平台' },
    ])
  })

  it('缺少 providerProfileId 的条目被跳过（画布目录模型不带渠道）', () => {
    // 目录模型（catalogOnly 路径）不带 providerProfileId，无法据此路由到渠道。
    const catalogModel: CanvasMediaModelSummary = {
      manifestId: 'minimax:speech-2.6-hd',
      providerKind: 'minimax-hailuo',
      modelId: 'speech-2.6-hd',
      effectiveModelId: 'speech-2.6-hd',
      displayName: 'MiniMax Speech 2.6 HD',
      domains: ['audio'],
      invocationMode: 'sync',
      capabilities: [],
      sourceUrls: [],
      enabled: true,
    }
    expect(ttsChannelOptions([catalogModel])).toEqual([])
  })

  it('无语音模型时返回空清单', () => {
    expect(ttsChannelOptions([])).toEqual([])
  })
})

describe('resolveTtsChannelId', () => {
  it('显式选择优先，未选择时对齐主进程的首个可用渠道', () => {
    expect(resolveTtsChannelId([minimax, zhipu], 'p-zhipu')).toBe('p-zhipu')
    expect(resolveTtsChannelId([minimax, zhipu], null)).toBe('p-minimax')
    expect(resolveTtsChannelId([], null)).toBeNull()
  })
})

describe('ttsChannelModels', () => {
  it('取指定渠道的模型并按 modelId 去重', () => {
    const duplicate = { ...minimaxFlash, manifestId: 'p-minimax:speech-2.6-hd:alt' }
    const models = ttsChannelModels([minimax, duplicate, minimaxFlash, zhipu], 'p-minimax')
    expect(models.map((model) => model.modelId)).toEqual(['speech-2.6-hd', 'speech-2.6-turbo'])
  })

  it('渠道为 null 时返回空清单', () => {
    expect(ttsChannelModels([minimax], null)).toEqual([])
  })
})

describe('resolveTtsModel', () => {
  it('显式模型优先，未指定时取渠道首个模型', () => {
    expect(resolveTtsModel([minimax, minimaxFlash], 'p-minimax', 'speech-2.6-turbo')?.modelId).toBe(
      'speech-2.6-turbo',
    )
    expect(resolveTtsModel([minimax, minimaxFlash], 'p-minimax', null)?.modelId).toBe(
      'speech-2.6-hd',
    )
  })

  it('模型已不在渠道内时回退首个，避免展示失效模型', () => {
    expect(resolveTtsModel([minimax, minimaxFlash], 'p-minimax', 'removed-model')?.modelId).toBe(
      'speech-2.6-hd',
    )
    expect(resolveTtsModel([], 'p-minimax', null)).toBeUndefined()
  })
})

describe('ttsVoiceOptions', () => {
  it('默认档合并整条渠道的音色并按值去重', () => {
    expect(ttsVoiceOptions([minimax, minimaxFlash, zhipu], 'p-minimax', null)).toEqual([
      { value: 'male-qn-qingse', label: 'male-qn-qingse' },
      { value: 'female-shaonv', label: 'female-shaonv' },
    ])
  })

  it('指定模型时只取该模型的音色', () => {
    const turboOnly = speechModel('p-minimax', '自建 MiniMax', 'speech-2.6-turbo', 'Turbo', {
      type: 'string',
      examples: ['female-yujie'],
      'x-allow-custom': true,
    })
    expect(ttsVoiceOptions([minimax, turboOnly], 'p-minimax', 'speech-2.6-turbo')).toEqual([
      { value: 'female-yujie', label: 'female-yujie' },
    ])
  })

  it('指定模型但该模型未声明音色参数时返回空清单，不误用同渠道其他模型的音色', () => {
    const turboNoVoice = { ...minimaxFlash, capabilities: [] }
    expect(ttsVoiceOptions([minimax, turboNoVoice], 'p-minimax', 'speech-2.6-turbo')).toEqual([])
  })

  it('渠道同步的可读音色名作为文案，值保持渠道原值', () => {
    expect(ttsVoiceOptions([zhipu], 'p-zhipu', null)).toEqual([
      { value: 'tongtong', label: '彤彤' },
      { value: 'my-cloned-voice', label: 'my-cloned-voice' },
    ])
  })

  it('渠道为空 / 模型无音色参数时返回空清单（控件回落手输）', () => {
    expect(ttsVoiceOptions([minimax], null, null)).toEqual([])
    const noVoiceParam = speechModel('p-x', 'X', 'm', 'M', { type: 'string' })
    expect(ttsVoiceOptions([noVoiceParam], 'p-x', null)).toEqual([])
  })
})
