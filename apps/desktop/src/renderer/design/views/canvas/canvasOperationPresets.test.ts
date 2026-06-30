// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildCanvasOperationPrompt,
  formatCanvasOperationPresetModelParams,
  mergeCanvasOperationPresetModelParams,
  mergeCanvasOperationPresetNegativePrompt,
  mergeCanvasOperationPresetPrompt,
  parseCanvasOperationPresetModelParams,
  readBuiltinCanvasOperationPreset,
  readCanvasOperationPreset,
  readCanvasOperationPresetPromptPrefix,
  readCanvasOperationPresetOverrides,
  resetCanvasOperationPreset,
  writeCanvasOperationPreset,
} from './canvasOperationPresets'

describe('canvasOperationPresets', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('provides built-in panorama defaults even without stored overrides', () => {
    expect(readCanvasOperationPreset('panorama_360')).toEqual({
      prompt: '请基于输入内容生成一张可用于 360° 全景预览的等距柱状投影场景图。',
      negativePrompt: '',
      skillIds: [],
      modelParams: {
        aspect_ratio: '2:1',
        resolution: '2k',
      },
    })
  })

  it('exposes built-in default prompts for preset editor reset/init', () => {
    expect(readBuiltinCanvasOperationPreset('image_edit').prompt).toBe(
      '请基于输入图片进行自然编辑，保持主体与画面质量。',
    )
  })

  it('exposes readonly system prompt prefixes and builds final prompts from them', () => {
    expect(readCanvasOperationPresetPromptPrefix('panorama_360')).toContain(
      '可用于 360° 全景查看器的完整场景全景图',
    )
    expect(
      buildCanvasOperationPrompt(
        'panorama_360',
        '请基于输入内容生成一张可用于 360° 全景预览的等距柱状投影场景图。',
      ),
    ).toContain('入参/场景要求：')
    expect(buildCanvasOperationPrompt('text_to_image', '电影感构图')).toBe('电影感构图')
  })

  it('persists custom per-operation presets in localStorage', () => {
    writeCanvasOperationPreset('text_to_image', {
      prompt: '电影感构图',
      negativePrompt: '水印',
      providerProfileId: 'provider-1',
      manifestId: 'manifest-1',
      modelId: 'gpt-image-1',
      skillIds: [],
      modelParams: { size: '1792x1024', seed: 42 },
    })

    expect(readCanvasOperationPreset('text_to_image')).toEqual({
      prompt: '电影感构图',
      negativePrompt: '水印',
      providerProfileId: 'provider-1',
      manifestId: 'manifest-1',
      modelId: 'gpt-image-1',
      skillIds: [],
      modelParams: { size: '1792x1024', seed: 42 },
    })
    expect(Object.keys(readCanvasOperationPresetOverrides())).toEqual(['text_to_image'])
  })

  it('persists text runtime defaults such as agent, model, and skills', () => {
    writeCanvasOperationPreset('text_generate', {
      agentId: 'agent:writer',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:outline', 'skill:style'],
    })

    expect(readCanvasOperationPreset('text_generate')).toEqual({
      prompt: '请基于输入内容生成结构清晰、信息完整的文本。',
      negativePrompt: '',
      agentId: 'agent:writer',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:outline', 'skill:style'],
      modelParams: {},
    })
  })

  it('resets custom overrides while keeping built-in panorama defaults', () => {
    writeCanvasOperationPreset('panorama_360', {
      prompt: '黄昏海边',
      modelParams: { size: '2048x1024' },
    })

    resetCanvasOperationPreset('panorama_360')

    expect(readCanvasOperationPreset('panorama_360')).toEqual({
      prompt: '请基于输入内容生成一张可用于 360° 全景预览的等距柱状投影场景图。',
      negativePrompt: '',
      skillIds: [],
      modelParams: {
        aspect_ratio: '2:1',
        resolution: '2k',
      },
    })
  })

  it('merges prompt, negative prompt, and model params with dedupe', () => {
    writeCanvasOperationPreset('text_to_image', {
      prompt: '统一镜头语言',
      negativePrompt: '不要水印',
      modelParams: { size: '1792x1024' },
    })

    expect(mergeCanvasOperationPresetPrompt('角色站在街头', '统一镜头语言')).toBe('角色站在街头')
    expect(mergeCanvasOperationPresetPrompt('', '统一镜头语言')).toBe('统一镜头语言')
    expect(mergeCanvasOperationPresetNegativePrompt('不要模糊', '不要水印')).toBe(
      '不要模糊\n不要水印',
    )
    expect(mergeCanvasOperationPresetModelParams('text_to_image', { quality: 'high' })).toEqual({
      size: '1792x1024',
      quality: 'high',
    })
  })

  it('formats and parses preset model params JSON', () => {
    const formatted = formatCanvasOperationPresetModelParams({ size: '1792x1024', quality: 'high' })
    expect(parseCanvasOperationPresetModelParams(formatted)).toEqual({
      size: '1792x1024',
      quality: 'high',
    })
  })

  it('rejects invalid preset model params JSON', () => {
    expect(() => parseCanvasOperationPresetModelParams('[]')).toThrow(
      '默认参数必须是 JSON 对象，例如 {"size":"1792x1024"}',
    )
  })
})
