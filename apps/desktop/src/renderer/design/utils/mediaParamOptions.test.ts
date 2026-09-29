import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'

import {
  mediaModelDefaultVoice,
  mediaParamOptions,
  paramOptionsFromSchema,
  VOICE_PARAM_FIELD_NAMES,
} from './mediaParamOptions'

/**
 * 用例数据取自真实内置 manifest：
 * - 智谱 glm-tts voice：examples（系统音色 + 同步写入的复刻音色）+ x-allow-custom；
 * - 百炼 size：enum 只有 1K/2K，具体画幅在 examples + x-template-labels；
 * - MiniMax voice：仅 examples + x-allow-custom（无 enum）。
 */
function model(
  overrides: Partial<CanvasMediaModelSummary> &
    Pick<CanvasMediaModelSummary, 'manifestId' | 'displayName' | 'effectiveModelId'>,
): CanvasMediaModelSummary {
  return {
    providerKind: 'custom',
    modelId: overrides.effectiveModelId,
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: [],
    sourceUrls: [],
    enabled: true,
    ...overrides,
  }
}

function speechCapability(
  paramSchema: Record<string, unknown>,
  defaults?: Record<string, unknown>,
): CanvasMediaModelSummary['capabilities'][number] {
  return {
    id: 'audio.speech',
    label: '语音合成',
    input: { required: ['text'] },
    output: { types: ['audio'], mimeTypes: ['audio/wav'] },
    paramSchema,
    ...(defaults !== undefined ? { defaults } : {}),
  }
}

describe('paramOptionsFromSchema', () => {
  it('enum 始终收集，default 保留在候选内', () => {
    const options = paramOptionsFromSchema(
      {
        properties: {
          quality: { type: 'string', enum: ['hd', 'standard'], default: 'standard' },
        },
      },
      ['quality'],
    )
    expect(options.map((option) => option.value)).toEqual(['hd', 'standard'])
    expect(options.every((option) => option.label === option.value)).toBe(true)
  })

  it('无 x-allow-custom 时不把 examples 当候选（示例≠约束）', () => {
    const options = paramOptionsFromSchema(
      {
        properties: {
          size: { type: 'string', enum: ['1K', '2K'], examples: ['2048*2048', '1152*2048'] },
        },
      },
      ['size'],
    )
    expect(options.map((option) => option.value)).toEqual(['1K', '2K'])
  })

  it('x-allow-custom=true 时 examples 并入候选，且去重', () => {
    const options = paramOptionsFromSchema(
      {
        properties: {
          size: {
            type: 'string',
            enum: ['1K'],
            examples: ['1K', '2048*2048', '1152*2048'],
            'x-allow-custom': true,
          },
        },
      },
      ['size'],
    )
    expect(options.map((option) => option.value)).toEqual(['1K', '2048*2048', '1152*2048'])
  })

  it('useLabels 时 x-template-labels 作为可读名，值本身不变', () => {
    const schema = {
      properties: {
        voice: {
          type: 'string',
          examples: ['tongtong', 'chuichui'],
          'x-allow-custom': true,
          'x-template-labels': { tongtong: '彤彤', chuichui: '锤锤' },
        },
      },
    }
    const plain = paramOptionsFromSchema(schema, VOICE_PARAM_FIELD_NAMES)
    expect(plain).toEqual([
      { value: 'tongtong', label: 'tongtong' },
      { value: 'chuichui', label: 'chuichui' },
    ])
    const labelled = paramOptionsFromSchema(schema, VOICE_PARAM_FIELD_NAMES, { useLabels: true })
    expect(labelled).toEqual([
      { value: 'tongtong', label: '彤彤' },
      { value: 'chuichui', label: '锤锤' },
    ])
  })

  it('缺 properties / 字段不存在 / 非标量值均安全返回', () => {
    expect(paramOptionsFromSchema(undefined, ['voice'])).toEqual([])
    expect(paramOptionsFromSchema({}, ['voice'])).toEqual([])
    expect(paramOptionsFromSchema({ properties: { voice: null } }, ['voice'])).toEqual([])
    expect(
      paramOptionsFromSchema({ properties: { voice: { enum: [{ n: 1 }, 'ok'] } } }, ['voice']),
    ).toEqual([{ value: 'ok', label: 'ok' }])
  })

  it('渠道音色字段命名各异：voice / voice_id / voiceId / speaker 均命中', () => {
    for (const name of VOICE_PARAM_FIELD_NAMES) {
      const options = paramOptionsFromSchema(
        {
          properties: {
            [name]: { type: 'string', examples: ['v1'], 'x-allow-custom': true },
          },
        },
        VOICE_PARAM_FIELD_NAMES,
      )
      expect(options).toEqual([{ value: 'v1', label: 'v1' }])
    }
  })
})

describe('mediaParamOptions', () => {
  const zhipu = model({
    manifestId: 'zhipu:glm-tts',
    displayName: 'GLM-TTS',
    effectiveModelId: 'glm-tts',
    capabilities: [
      speechCapability(
        {
          properties: {
            voice: {
              type: 'string',
              examples: ['tongtong'],
              'x-allow-custom': true,
              'x-template-labels': { tongtong: '彤彤' },
            },
            format: { type: 'string', enum: ['wav', 'pcm'], default: 'wav' },
          },
        },
        { voice: 'tongtong' },
      ),
    ],
  })

  it('只收集命中能力的候选（capabilityId 过滤）', () => {
    const transcription = model({
      manifestId: 'zhipu:glm-asr-2512',
      displayName: 'GLM-ASR',
      effectiveModelId: 'glm-asr-2512',
      capabilities: [
        {
          id: 'audio.transcription',
          label: '语音转写',
          input: { required: ['file'] },
          output: { types: ['text'] },
          paramSchema: { properties: { voice: { type: 'string', enum: ['不应出现'] } } },
        },
      ],
    })
    const options = mediaParamOptions([zhipu, transcription], VOICE_PARAM_FIELD_NAMES, {
      capabilityId: 'audio.speech',
      useLabels: true,
    })
    expect(options).toEqual([{ value: 'tongtong', label: '彤彤' }])
  })

  it('多模型合并按首次出现去重并保序', () => {
    const other = model({
      manifestId: 'minimax:speech-2.6-hd',
      displayName: 'MiniMax TTS',
      effectiveModelId: 'speech-2.6-hd',
      capabilities: [
        speechCapability({
          properties: {
            voice: {
              type: 'string',
              examples: ['tongtong', 'male-qn-qingse'],
              'x-allow-custom': true,
            },
          },
        }),
      ],
    })
    const options = mediaParamOptions([zhipu, other], VOICE_PARAM_FIELD_NAMES)
    expect(options.map((option) => option.value)).toEqual(['tongtong', 'male-qn-qingse'])
  })
})

describe('mediaModelDefaultVoice', () => {
  it('优先取能力 defaults，其次渠道 defaults，再次 paramSchema.default', () => {
    const withCapabilityDefaults = model({
      manifestId: 'a',
      displayName: 'A',
      effectiveModelId: 'a',
      capabilities: [speechCapability({ properties: {} }, { voice: 'tongtong' })],
    })
    expect(mediaModelDefaultVoice(withCapabilityDefaults)).toBe('tongtong')

    const withProviderDefaults = model({
      manifestId: 'b',
      displayName: 'B',
      effectiveModelId: 'b',
      defaults: { voice: 'cherry' },
      capabilities: [speechCapability({ properties: {} })],
    })
    expect(mediaModelDefaultVoice(withProviderDefaults)).toBe('cherry')

    const withSchemaDefault = model({
      manifestId: 'c',
      displayName: 'C',
      effectiveModelId: 'c',
      capabilities: [
        speechCapability({ properties: { voice: { type: 'string', default: 'alloy' } } }),
      ],
    })
    expect(mediaModelDefaultVoice(withSchemaDefault)).toBe('alloy')
  })

  it('无语音能力或未声明默认音色时返回 null', () => {
    expect(mediaModelDefaultVoice(undefined)).toBeNull()
    const silent = model({
      manifestId: 'd',
      displayName: 'D',
      effectiveModelId: 'd',
      capabilities: [speechCapability({ properties: { voice: { type: 'string' } } })],
    })
    expect(mediaModelDefaultVoice(silent)).toBeNull()
  })
})
