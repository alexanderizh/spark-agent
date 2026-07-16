import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  type MediaCapabilityId,
  type MediaModelCapabilityManifest,
  type MediaModelManifest,
} from '@spark/protocol'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'
import type { MediaGenerateInput } from '../../../services/media/media-adapter.types.js'

function findManifest(modelId: string): MediaModelManifest {
  const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
    (entry) => entry.providerKind === 'volcengine-ark' && entry.modelId === modelId,
  )
  if (!manifest) throw new Error(`missing manifest ${modelId}`)
  return manifest
}

function validate(input: {
  modelId: string
  capability: MediaCapabilityId
  prompt?: string
  inputFiles?: MediaGenerateInput['inputFiles']
  modelParams?: Record<string, unknown>
}) {
  const manifest = findManifest(input.modelId)
  const capability = manifest.capabilities.find((entry) => entry.id === input.capability) as
    | MediaModelCapabilityManifest
    | undefined
  if (!capability) throw new Error(`missing capability ${input.capability}`)
  return validateMediaRequest({
    input: {
      operation: input.capability.startsWith('image.') ? 'text_to_image' : 'image_to_video',
      capability: input.capability,
      ...(input.prompt != null ? { prompt: input.prompt } : {}),
      ...(input.inputFiles != null ? { inputFiles: input.inputFiles } : {}),
      ...(input.modelParams != null ? { modelParams: input.modelParams } : {}),
      outputDir: '',
    },
    providerKind: 'volcengine-ark',
    modelId: input.modelId,
    capability: input.capability,
    manifest,
    manifestCapability: capability,
    mode: 'canvas',
  })
}

describe('Volcengine Ark media request validation', () => {
  it('accepts Seedance 2.0 pure text with web search', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.generate',
      prompt: '上海未来五日天气的电影化延时摄影',
      modelParams: { searchEnabled: true, durationSeconds: 5 },
    })
    expect(result.blockingIssues).toEqual([])
  })

  it('rejects mixing first-frame and multimodal reference modes', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.image_to_video',
      prompt: '镜头缓慢推进',
      inputFiles: [
        { type: 'image', role: 'first_frame', url: 'https://cdn/first.png' },
        { type: 'video', role: 'reference', url: 'https://cdn/ref.mp4' },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.code === 'conflicting_params')).toBe(true)
  })

  it('rejects an unmarked image after an explicit first frame', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.image_to_video',
      prompt: '镜头缓慢推进',
      inputFiles: [
        { type: 'image', role: 'first_frame', url: 'https://cdn/first.png' },
        { type: 'image', url: 'https://cdn/unmarked.png' },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.code === 'conflicting_params')).toBe(true)
  })

  it('accepts two unmarked image-to-video inputs as implicit first and last frames', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.image_to_video',
      prompt: '首尾帧平滑过渡',
      inputFiles: [
        { type: 'image', url: 'https://cdn/first.png' },
        { type: 'image', url: 'https://cdn/last.png' },
      ],
    })
    expect(result.blockingIssues).toEqual([])
  })

  it('rejects a third unmarked image in implicit first-and-last-frame mode', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.image_to_video',
      prompt: '首尾帧平滑过渡',
      inputFiles: [
        { type: 'image', url: 'https://cdn/first.png' },
        { type: 'image', url: 'https://cdn/last.png' },
        { type: 'image', url: 'https://cdn/reference.png' },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.code === 'conflicting_params')).toBe(true)
  })

  it('rejects audio-only multimodal reference', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.reference_to_video',
      inputFiles: [
        { type: 'audio', role: 'reference', url: 'https://cdn/ref.mp3', durationMs: 5000 },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('不能只传音频'))).toBe(true)
  })

  it('rejects web search with media input and undocumented Seedance 2.0 params', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.image_to_video',
      inputFiles: [{ type: 'image', role: 'first_frame', url: 'https://cdn/first.png' }],
      modelParams: { searchEnabled: true, seed: 1, cameraFixed: true, frames: 29 },
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('仅支持纯文本'))).toBe(true)
    expect(result.blockingIssues.filter((issue) => issue.code === 'forbidden_param')).toHaveLength(
      3,
    )
  })

  it('rejects oversized reference duration totals', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-fast-260128',
      capability: 'video.reference_to_video',
      inputFiles: [
        { type: 'image', role: 'reference', url: 'https://cdn/ref.png' },
        { type: 'video', role: 'reference', url: 'https://cdn/a.mp4', durationMs: 8000 },
        { type: 'video', role: 'reference', url: 'https://cdn/b.mp4', durationMs: 8000 },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('视频总时长'))).toBe(true)
  })

  it('rejects last frame for Seedance 1.0 Pro Fast', () => {
    const result = validate({
      modelId: 'doubao-seedance-1-0-pro-fast-251015',
      capability: 'video.image_to_video',
      inputFiles: [
        { type: 'image', role: 'first_frame', url: 'https://cdn/first.png' },
        { type: 'image', role: 'last_frame', url: 'https://cdn/last.png' },
      ],
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('不支持首尾帧'))).toBe(true)
  })

  it('enforces Seedream group input plus output limit', () => {
    const result = validate({
      modelId: 'doubao-seedream-5-0-lite-260128',
      capability: 'image.edit',
      prompt: '生成连续分镜',
      inputFiles: Array.from({ length: 4 }, (_, index) => ({
        type: 'image' as const,
        role: 'reference' as const,
        url: `https://cdn/${index}.png`,
      })),
      modelParams: { sequentialImageGeneration: 'auto', maxImages: 12 },
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('之和不超过 15'))).toBe(
      true,
    )
  })

  it('rejects undocumented Seedream parameters before request submission', () => {
    const result = validate({
      modelId: 'doubao-seedream-5-0-pro-260628',
      capability: 'image.generate',
      prompt: '产品海报',
      modelParams: { seed: 42, guidanceScale: 7 },
    })
    expect(result.blockingIssues.filter((issue) => issue.code === 'forbidden_param')).toHaveLength(
      2,
    )
  })
})
