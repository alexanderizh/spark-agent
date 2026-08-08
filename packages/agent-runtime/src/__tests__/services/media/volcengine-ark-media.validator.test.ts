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
  it('accepts Seedance 2.5 audio-only references, 30 seconds, and MOV output', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-5-260628',
      capability: 'video.reference_to_video',
      prompt: '根据音频节奏生成一段视频',
      inputFiles: [
        { type: 'audio', role: 'reference', url: 'https://cdn/ref.mp3', durationMs: 30_000 },
      ],
      modelParams: { durationSeconds: 30, outputFormat: 'mov' },
    })
    expect(result.blockingIssues).toEqual([])
  })

  it('accepts the Seedance 2.5 30/10/10 reference distribution and rejects a 51st item', () => {
    const accepted = validate({
      modelId: 'doubao-seedance-2-5-260628',
      capability: 'video.reference_to_video',
      prompt: '组合所有参考素材',
      inputFiles: [
        ...Array.from({ length: 30 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          url: `https://cdn/image-${index}.png`,
        })),
        ...Array.from({ length: 10 }, (_, index) => ({
          type: 'video' as const,
          role: 'reference' as const,
          url: `https://cdn/video-${index}.mp4`,
        })),
        ...Array.from({ length: 10 }, (_, index) => ({
          type: 'audio' as const,
          role: 'reference' as const,
          url: `https://cdn/audio-${index}.mp3`,
        })),
      ],
    })
    expect(accepted.blockingIssues).toEqual([])

    const rejected = validate({
      modelId: 'doubao-seedance-2-5-260628',
      capability: 'video.reference_to_video',
      prompt: '组合所有参考素材',
      inputFiles: [
        ...Array.from({ length: 30 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          url: `https://cdn/image-${index}.png`,
        })),
        ...Array.from({ length: 10 }, (_, index) => ({
          type: 'video' as const,
          role: 'reference' as const,
          url: `https://cdn/video-${index}.mp4`,
        })),
        ...Array.from({ length: 11 }, (_, index) => ({
          type: 'audio' as const,
          role: 'reference' as const,
          url: `https://cdn/audio-${index}.mp3`,
        })),
      ],
    })
    expect(rejected.blockingIssues.some((issue) => issue.message.includes('总数 51/50'))).toBe(true)
  })

  it('rejects a Seedance 2.5 per-kind reference overflow even below the total limit', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-5-260628',
      capability: 'video.reference_to_video',
      prompt: '组合参考素材',
      inputFiles: Array.from({ length: 31 }, (_, index) => ({
        type: 'image' as const,
        role: 'reference' as const,
        url: `https://cdn/image-${index}.png`,
      })),
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('图片 31/30'))).toBe(true)
  })

  it('keeps Seedance 2.0 audio-only and 30-second requests rejected', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-260128',
      capability: 'video.reference_to_video',
      prompt: '音频参考',
      inputFiles: [{ type: 'audio', role: 'reference', url: 'https://cdn/ref.mp3' }],
      modelParams: { durationSeconds: 30 },
    })
    expect(result.blockingIssues.some((issue) => issue.message.includes('不能只传音频'))).toBe(true)
    expect(result.blockingIssues.some((issue) => issue.message.includes('不支持时长 30'))).toBe(
      true,
    )
  })

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

  it.each([
    ['doubao-seedance-1-5-pro-251215', 2],
    ['doubao-seedance-1-0-pro-250528', 2],
    ['doubao-seedance-1-0-pro-fast-251015', 1],
  ] as const)('accepts canvas reference roles as %s frame inputs', (modelId, imageCount) => {
    const result = validate({
      modelId,
      capability: 'video.image_to_video',
      prompt: '首尾帧平滑过渡',
      inputFiles: Array.from({ length: imageCount }, (_, index) => ({
        type: 'image' as const,
        role: 'reference' as const,
        url: `https://cdn/frame-${index}.png`,
      })),
      modelParams: { resolution: '720p' },
    })
    expect(result.blockingIssues).toEqual([])
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
