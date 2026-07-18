// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildCanvasOperationPrompt,
  formatCanvasOperationPresetModelParams,
  mergeCanvasOperationPresetModelParams,
  mergeCanvasPresetTargetModelParams,
  mergeCanvasOperationPresetNegativePrompt,
  mergeCanvasOperationPresetPrompt,
  parseCanvasOperationPresetModelParams,
  readBuiltinCanvasOperationPreset,
  readCanvasLastUsedPresetTarget,
  readCanvasInheritedPresetTarget,
  readCanvasOperationPreset,
  readCanvasOperationPresetPromptPrefix,
  readCanvasOperationPresetOverrides,
  readCanvasPresetTarget,
  readCanvasResolvedPresetTarget,
  resetCanvasLastUsedPresetTarget,
  resetCanvasOperationPreset,
  resolveCanvasPresetTarget,
  writeCanvasLastUsedPresetTarget,
  writeCanvasPresetTarget,
  writeCanvasOperationPreset,
} from './canvasOperationPresets'
import { writeCanvasTaskDefault } from './canvasTaskDefaults'

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
    expect(readCanvasOperationPresetPromptPrefix('storyboard_grid')).toContain('单图故事板')
    expect(buildCanvasOperationPrompt('storyboard_grid', '彩绘稿，雨夜追逐')).toContain(
      '参考图 1 对应第 1 个带入说明',
    )
  })

  it('does not duplicate built-in prompt prefixes when retrying operation nodes', () => {
    const first = buildCanvasOperationPrompt('panorama_360', '老旧居民楼六层内走廊，夜戏')
    const second = buildCanvasOperationPrompt('panorama_360', first)
    const third = buildCanvasOperationPrompt('panorama_360', second)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(first?.match(/入参\/场景要求：/g)).toHaveLength(1)
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

  it('supports dedicated screenplay pipeline presets with operation fallback', () => {
    writeCanvasOperationPreset('text_generate', {
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:base'],
    })
    writeCanvasPresetTarget('screenplay.extract_characters', {
      prompt: '抽取角色并输出 JSON',
      modelParams: { workflow: 'extract_character', responseFormat: 'json' },
    })

    expect(readCanvasPresetTarget('screenplay.extract_characters')).toEqual({
      prompt: '抽取角色并输出 JSON',
      negativePrompt: '',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:base'],
      modelParams: { workflow: 'extract_character', responseFormat: 'json' },
    })
  })

  it('does not inherit a generic authored prompt into a dedicated pipeline contract', () => {
    writeCanvasOperationPreset('text_generate', {
      prompt: '你是角色分析师，只输出 characters JSON',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      modelParams: { workflow: 'extract_character', responseFormat: 'json' },
    })

    expect(readCanvasInheritedPresetTarget('screenplay.to_shot_script')).toMatchObject({
      prompt: '',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      modelParams: { workflow: 'shot_script', responseFormat: 'json' },
    })
  })

  it('repairs contaminated last-used workflow metadata for a dedicated pipeline target', () => {
    writeCanvasLastUsedPresetTarget('screenplay.to_shot_script', {
      modelParams: { workflow: 'extract_character', temperature: 0.3 },
    })

    expect(readCanvasResolvedPresetTarget('screenplay.to_shot_script').modelParams).toEqual({
      workflow: 'shot_script',
      responseFormat: 'json',
      temperature: 0.3,
    })
  })

  it('keeps the configured system prompt while reusing runtime selections', () => {
    writeCanvasPresetTarget('chapter.to_screenplay', {
      prompt: '预设版转剧本',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: [],
    })
    writeCanvasLastUsedPresetTarget('chapter.to_screenplay', {
      prompt: '上次实际使用的转剧本配置',
      modelId: 'gpt-5.1',
      modelParams: { temperature: 0.2 },
    })

    expect(readCanvasLastUsedPresetTarget('chapter.to_screenplay')).toEqual({
      prompt: '上次实际使用的转剧本配置',
      modelId: 'gpt-5.1',
      modelParams: { temperature: 0.2 },
    })
    expect(readCanvasResolvedPresetTarget('chapter.to_screenplay')).toEqual({
      prompt: '预设版转剧本',
      negativePrompt: '',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5.1',
      skillIds: [],
      modelParams: { temperature: 0.2 },
    })
  })

  it('merges task defaults beneath node overrides and last-used runtime values', () => {
    writeCanvasTaskDefault('text', {
      agentId: 'agent:global',
      providerProfileId: 'provider:global',
      modelId: 'gpt-global',
      skillIds: ['skill:global'],
    })
    writeCanvasPresetTarget('text_generate', {
      agentId: 'agent:node',
      modelId: 'gpt-node',
      skillIds: [],
    })
    writeCanvasLastUsedPresetTarget('text_generate', {
      modelId: 'gpt-last-used',
    })

    expect(readCanvasResolvedPresetTarget('text_generate')).toMatchObject({
      agentId: 'agent:node',
      providerProfileId: 'provider:global',
      modelId: 'gpt-last-used',
      skillIds: [],
    })
  })

  it('exposes the inherited task default without materializing a node override', () => {
    writeCanvasTaskDefault('image_generation', {
      providerProfileId: 'provider:global-image',
      modelId: 'image-global',
      skillIds: [],
    })
    writeCanvasPresetTarget('image_edit', {
      providerProfileId: 'provider:node-image',
      modelId: 'image-node',
      skillIds: [],
    })

    expect(readCanvasInheritedPresetTarget('image_edit')).toMatchObject({
      providerProfileId: 'provider:global-image',
      modelId: 'image-global',
    })
    expect(readCanvasPresetTarget('image_edit')).toMatchObject({
      providerProfileId: 'provider:node-image',
      modelId: 'image-node',
    })
  })

  it('uses the image-understanding default for text tasks with image input', () => {
    writeCanvasTaskDefault('text', {
      providerProfileId: 'provider:text',
      modelId: 'gpt-text',
      skillIds: [],
    })
    writeCanvasTaskDefault('image_understanding', {
      providerProfileId: 'provider:vision',
      modelId: 'gpt-vision',
      skillIds: [],
    })

    expect(readCanvasResolvedPresetTarget('text_generate', { hasImageInput: true })).toMatchObject({
      providerProfileId: 'provider:vision',
      modelId: 'gpt-vision',
    })
    expect(readCanvasResolvedPresetTarget('text_generate')).toMatchObject({
      providerProfileId: 'provider:text',
      modelId: 'gpt-text',
    })
  })

  it('keeps scene extraction selections under its dedicated pipeline target', () => {
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_generate',
        taskPipelineRole: 'scene',
        workflow: 'extract_scene',
      }),
    ).toBe('screenplay.extract_scenes')

    writeCanvasLastUsedPresetTarget('screenplay.extract_scenes', {
      providerProfileId: 'provider:text',
      modelId: 'gpt-5.1',
      modelParams: { temperature: 0.4, maxTokens: 1200 },
    })

    expect(readCanvasResolvedPresetTarget('screenplay.extract_scenes')).toMatchObject({
      providerProfileId: 'provider:text',
      modelId: 'gpt-5.1',
      modelParams: { temperature: 0.4, maxTokens: 1200 },
    })
  })

  it('clears last used when resetting via resetCanvasLastUsedPresetTarget', () => {
    writeCanvasPresetTarget('text_generate', {
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:base'],
    })
    writeCanvasLastUsedPresetTarget('text_generate', {
      modelId: 'gpt-5.1',
      modelParams: { temperature: 0.5 },
    })

    expect(readCanvasResolvedPresetTarget('text_generate').modelId).toBe('gpt-5.1')

    resetCanvasLastUsedPresetTarget('text_generate')

    // lastUsed 清掉后，preset 立即生效
    expect(readCanvasResolvedPresetTarget('text_generate')).toEqual({
      prompt: '请基于输入内容生成结构清晰、信息完整的文本。',
      negativePrompt: '',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:base'],
      modelParams: {},
    })
    // lastUsed 应该被清空
    expect(readCanvasLastUsedPresetTarget('text_generate')).toEqual({})
  })

  it('returns an empty object from readCanvasLastUsedPresetTarget when nothing was stored', () => {
    expect(readCanvasLastUsedPresetTarget('text_generate')).toEqual({})
  })

  it('merges model params for dedicated preset targets', () => {
    writeCanvasPresetTarget('screenplay.to_shot_script', {
      modelParams: { workflow: 'shot_script', responseFormat: 'markdown' },
    })

    expect(
      mergeCanvasPresetTargetModelParams('screenplay.to_shot_script', { temperature: 0.4 }),
    ).toEqual({
      workflow: 'shot_script',
      responseFormat: 'markdown',
      temperature: 0.4,
    })
  })

  it('lets an explicit duration alias replace a stale preset alias', () => {
    writeCanvasPresetTarget('image_to_video', {
      modelParams: { durationSeconds: 8, resolution: '720p' },
    })

    expect(mergeCanvasPresetTargetModelParams('image_to_video', { duration: 3 })).toEqual({
      duration: 3,
      resolution: '720p',
    })
  })

  it('resolves pipeline preset target by operation, role, and workflow', () => {
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_rewrite',
        outputPipelineRole: 'screenplay',
      }),
    ).toBe('chapter.to_screenplay')
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_generate',
        taskPipelineRole: 'character',
        workflow: 'extract_character',
      }),
    ).toBe('screenplay.extract_characters')
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_generate',
        taskPipelineRole: 'prop',
        workflow: 'extract_prop',
      }),
    ).toBe('screenplay.extract_props')
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_generate',
        outputPipelineRole: 'shot',
        workflow: 'extract_character',
      }),
    ).toBe('screenplay.to_shot_script')
    expect(
      resolveCanvasPresetTarget({
        operation: 'text_generate',
        workflow: 'shot_script',
      }),
    ).toBe('screenplay.to_shot_script')
  })
})
