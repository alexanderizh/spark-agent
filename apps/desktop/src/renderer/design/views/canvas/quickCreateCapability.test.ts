import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary, MediaCapabilityId } from '@spark/protocol'
import {
  capabilityFor,
  operationFor,
  operationForSubmission,
  type QuickCreateInput,
} from './quickCreateCapability'

function input(type: QuickCreateInput['type']): QuickCreateInput {
  return { id: `input-${type}`, name: `${type}.bin`, type, role: 'input', previewUrl: '' }
}

function model(capabilities: MediaCapabilityId[]): CanvasMediaModelSummary {
  return {
    manifestId: `manifest-${capabilities.join('-')}`,
    providerProfileId: 'provider',
    providerName: 'provider',
    providerKind: 'openai-images',
    modelId: 'model',
    effectiveModelId: 'model',
    displayName: 'model',
    domains: ['video'],
    invocationMode: 'sync',
    capabilities: capabilities.map((id) => ({
      id,
      label: id,
      input: { required: ['prompt'], maxImages: 1 },
      output: { types: ['video'] },
      paramSchema: {},
    })),
    sourceUrls: [],
    enabled: true,
  }
}

const MINIMAX_LIKE = model(['video.generate', 'video.image_to_video', 'video.reference_to_video'])
const EDIT_ONLY = model(['video.edit'])
const GENERATE_ONLY = model(['video.generate'])

describe('capabilityFor', () => {
  it('视频模式 + 参考视频：reference_to_video 模型保持可选（修复前会被 video.edit 过滤掉）', () => {
    expect(capabilityFor('video', [input('video')], MINIMAX_LIKE)).toBe('video.reference_to_video')
  })

  it('视频模式 + 参考视频：仅支持 video.edit 的模型仍可选并走编辑能力', () => {
    expect(capabilityFor('video', [input('video')], EDIT_ONLY)).toBe('video.edit')
  })

  it('视频模式 + 参考视频：仅支持 generate 的模型不参与参考输入（候选回退项不在模型能力内，会被兼容过滤剔除）', () => {
    const candidate = capabilityFor('video', [input('video')], GENERATE_ONLY)
    expect(GENERATE_ONLY.capabilities.some((capability) => capability.id === candidate)).toBe(false)
  })

  it('视频模式 + 参考图：优先 image_to_video，其次 reference_to_video', () => {
    expect(capabilityFor('video', [input('image')], MINIMAX_LIKE)).toBe('video.image_to_video')
    expect(capabilityFor('video', [input('image')], EDIT_ONLY)).toBe('video.image_to_video')
  })

  it('视频模式 + 纯文本：generate / reference_to_video 均可选', () => {
    expect(capabilityFor('video', [], MINIMAX_LIKE)).toBe('video.generate')
    expect(capabilityFor('video', [], EDIT_ONLY)).toBe('video.generate')
  })

  it('生图模式 + 参考图：走 image.edit；纯文本走 generate', () => {
    expect(capabilityFor('image', [input('image')], model(['image.generate', 'image.edit']))).toBe(
      'image.edit',
    )
    expect(capabilityFor('image', [], model(['image.generate', 'image.edit']))).toBe(
      'image.generate',
    )
  })

  it('反推模式不解析媒体能力', () => {
    expect(capabilityFor('reverse', [input('image')], MINIMAX_LIKE)).toBeUndefined()
  })

  it('语音模式锁定 audio.speech：即便模型只声明 audio.music 也不回退到音乐能力', () => {
    expect(capabilityFor('audio', [], model(['audio.speech']))).toBe('audio.speech')
    // 回退项固定为 speech，音乐模型会在兼容过滤阶段被剔除，不会误路由
    expect(capabilityFor('audio', [], model(['audio.music']))).toBe('audio.speech')
  })
})

describe('operationFor', () => {
  it('视频模式 + 视频输入记为 video_edit（历史语义），图片输入记为 image_to_video，纯文本记为 text_to_video', () => {
    expect(operationFor('video', [input('video')])).toBe('video_edit')
    expect(operationFor('video', [input('image')])).toBe('image_to_video')
    expect(operationFor('video', [])).toBe('text_to_video')
  })

  it('语音模式恒为 text_to_audio，不受输入素材影响', () => {
    expect(operationFor('audio', [])).toBe('text_to_audio')
    expect(operationFor('audio', [input('image')])).toBe('text_to_audio')
  })
})

describe('operationForSubmission', () => {
  it('reference_to_video 能力提交时记为 text_to_video，保证重试能还原能力', () => {
    expect(operationForSubmission('video', [input('video')], 'video.reference_to_video')).toBe(
      'text_to_video',
    )
  })

  it('video.edit 能力沿用 video_edit operation', () => {
    expect(operationForSubmission('video', [input('video')], 'video.edit')).toBe('video_edit')
  })

  it('无能力时沿用 operationFor 推导', () => {
    expect(operationForSubmission('video', [input('video')], undefined)).toBe('video_edit')
    expect(operationForSubmission('video', [input('image')], undefined)).toBe('image_to_video')
  })

  it('语音模式提交恒为 text_to_audio，历史重试能还原同一操作', () => {
    expect(operationForSubmission('audio', [], 'audio.speech')).toBe('text_to_audio')
    expect(operationForSubmission('audio', [], undefined)).toBe('text_to_audio')
  })
})
