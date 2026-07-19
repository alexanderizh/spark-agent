import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  type MediaCapabilityId,
  type MediaModelCapabilityManifest,
  type MediaModelManifest,
} from '@spark/protocol'
import type { MediaGenerateInput } from '../../../services/media/media-adapter.types.js'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'

describe('APIMart media request validation', () => {
  it('keeps the Seedance prompt threshold advisory', () => {
    const result = validate({
      modelId: 'doubao-seedance-2.0',
      capability: 'video.generate',
      prompt: 'a'.repeat(4001),
    })

    expect(result.blockingIssues).toEqual([])
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', code: 'out_of_range' }),
      ]),
    )
  })

  it('accepts documented Seedance 2.0 multi-reference inputs', () => {
    const result = validate({
      modelId: 'doubao-seedance-2.0',
      capability: 'video.reference_to_video',
      inputFiles: [
        { type: 'image', role: 'reference', url: 'https://cdn/a.png' },
        { type: 'image', role: 'reference', url: 'https://cdn/b.png' },
        { type: 'video', role: 'reference', url: 'https://cdn/motion.mp4' },
      ],
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('rejects reference mode without any reference media', () => {
    const result = validate({
      modelId: 'doubao-seedance-2.0',
      capability: 'video.reference_to_video',
      inputFiles: [],
    })

    expect(
      result.blockingIssues.some(
        (issue) => issue.code === 'missing_required' && issue.message.includes('参考素材'),
      ),
    ).toBe(true)
  })

  it('enforces Wan 2.7 R2V combined image and video count', () => {
    const accepted = validate({
      modelId: 'wan2.7-r2v',
      capability: 'video.reference_to_video',
      inputFiles: [
        ...images(3),
        ...videos(2),
      ],
    })
    const rejected = validate({
      modelId: 'wan2.7-r2v',
      capability: 'video.reference_to_video',
      inputFiles: [
        ...images(3),
        ...videos(3),
      ],
    })

    expect(accepted.blockingIssues).toEqual([])
    expect(rejected.blockingIssues.some((issue) => issue.message.includes('总数不能超过 5'))).toBe(
      true,
    )
  })

  it('enforces Omni Flash reference counts and video-duration exclusion', () => {
    const invalidImages = validate({
      modelId: 'Omni-Flash-Ext',
      capability: 'video.reference_to_video',
      inputFiles: images(2),
      modelParams: { generation_type: 'reference', durationSeconds: 6 },
    })
    const validImages = validate({
      modelId: 'Omni-Flash-Ext',
      capability: 'video.reference_to_video',
      inputFiles: images(3),
      modelParams: { generation_type: 'reference', durationSeconds: 6 },
    })
    const invalidVideo = validate({
      modelId: 'Omni-Flash-Ext',
      capability: 'video.reference_to_video',
      inputFiles: videos(1),
      modelParams: { durationSeconds: 6 },
    })

    expect(invalidImages.blockingIssues.some((issue) => issue.message.includes('1 张或 3 张'))).toBe(
      true,
    )
    expect(validImages.blockingIssues).toEqual([])
    expect(invalidVideo.blockingIssues.some((issue) => issue.message.includes('不能同时传'))).toBe(
      true,
    )
  })

  it('rejects the undocumented two-image Omni Flash combination in every image mode', () => {
    const result = validate({
      modelId: 'Omni-Flash-Ext',
      capability: 'video.image_to_video',
      inputFiles: images(2),
    })

    expect(result.blockingIssues.some((issue) => issue.message.includes('1 张或 3 张'))).toBe(true)
  })

  it('accepts Omni Flash reference video without reference images', () => {
    const result = validate({
      modelId: 'Omni-Flash-Ext',
      capability: 'video.reference_to_video',
      inputFiles: videos(1),
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('does not apply Seedance 2.0 prompt limit to the documented mini model', () => {
    const result = validate({
      modelId: 'doubao-seedance-2-0-mini',
      capability: 'video.generate',
      prompt: 'x'.repeat(4001),
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('enforces source-backed conditional duration constraints', () => {
    const wanWithVideo = validate({
      modelId: 'wan2.7-r2v',
      capability: 'video.reference_to_video',
      inputFiles: videos(1),
      modelParams: { durationSeconds: 12 },
    })
    const pixverseTransition = validate({
      modelId: 'pixverse-v6',
      capability: 'video.image_to_video',
      inputFiles: [
        ...images(1, 'first_frame'),
        ...images(1, 'last_frame'),
      ],
      modelParams: { durationSeconds: 6 },
    })

    expect(wanWithVideo.blockingIssues.some((issue) => issue.message.includes('2–10 秒'))).toBe(
      true,
    )
    expect(
      pixverseTransition.blockingIssues.some((issue) => issue.message.includes('5 或 8 秒')),
    ).toBe(true)
  })

  it('rejects VEO GIF output combined with 1080p or 4k', () => {
    const result = validate({
      modelId: 'veo3.1-fast',
      capability: 'video.generate',
      modelParams: { enable_gif: true, resolution: '1080p' },
    })

    expect(result.blockingIssues.some((issue) => issue.message.includes('GIF'))).toBe(true)
  })

  it('enforces Hailuo resolution and duration combinations', () => {
    for (const [modelId, validDuration] of [
      ['MiniMax-Hailuo-2.3', 6],
      ['MiniMax-Hailuo-02', 5],
    ] as const) {
      const accepted = validate({
        modelId,
        capability: 'video.image_to_video',
        inputFiles: images(1, 'first_frame'),
        modelParams: { resolution: '1080p', durationSeconds: validDuration },
      })
      const rejected = validate({
        modelId,
        capability: 'video.image_to_video',
        inputFiles: images(1, 'first_frame'),
        modelParams: { resolution: '1080p', durationSeconds: 10 },
      })

      expect(accepted.blockingIssues).toEqual([])
      expect(rejected.blockingIssues.some((issue) => issue.code === 'conflicting_params')).toBe(
        true,
      )
    }
  })

  it('enforces Kling 2.6 mode, tail-frame, and audio combinations', () => {
    const standardTail = validate({
      modelId: 'kling-v2-6',
      capability: 'video.image_to_video',
      inputFiles: [
        ...images(1, 'first_frame'),
        ...images(1, 'last_frame'),
      ],
      modelParams: { mode: 'std', audio: false },
    })
    const professionalTail = validate({
      modelId: 'kling-v2-6',
      capability: 'video.image_to_video',
      inputFiles: [
        ...images(1, 'first_frame'),
        ...images(1, 'last_frame'),
      ],
      modelParams: { mode: 'pro', audio: false },
    })
    const tailWithAudio = validate({
      modelId: 'kling-v2-6',
      capability: 'video.image_to_video',
      inputFiles: [
        ...images(1, 'first_frame'),
        ...images(1, 'last_frame'),
      ],
      modelParams: { mode: 'pro', audio: true },
    })

    expect(standardTail.blockingIssues.some((issue) => issue.message.includes('pro 模式'))).toBe(
      true,
    )
    expect(professionalTail.blockingIssues).toEqual([])
    expect(tailWithAudio.blockingIssues.some((issue) => issue.message.includes('尾帧与音频互斥'))).toBe(
      true,
    )
  })

  it('enforces Wan 2.5 480p ratio and required audio setting', () => {
    const accepted = validate({
      modelId: 'wan2.5-preview',
      capability: 'video.generate',
      modelParams: { resolution: '720p', aspectRatio: '4:3', audio: true },
    })
    const invalidRatio = validate({
      modelId: 'wan2.5-preview',
      capability: 'video.generate',
      modelParams: { resolution: '480p', aspectRatio: '4:3', audio: true },
    })
    const invalidAudio = validate({
      modelId: 'wan2.5-preview',
      capability: 'video.generate',
      modelParams: { resolution: '720p', aspectRatio: '16:9', audio: false },
    })

    expect(accepted.blockingIssues).toEqual([])
    expect(invalidRatio.blockingIssues.some((issue) => issue.message.includes('480p'))).toBe(true)
    expect(invalidAudio.blockingIssues.some((issue) => issue.message.includes('audio=true'))).toBe(
      true,
    )
  })
})

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
      operation: operationForCapability(input.capability),
      capability: input.capability,
      prompt: input.prompt ?? 'test prompt',
      ...(input.inputFiles ? { inputFiles: input.inputFiles } : {}),
      ...(input.modelParams ? { modelParams: input.modelParams } : {}),
      outputDir: '',
    },
    providerKind: 'apimart',
    modelId: input.modelId,
    capability: input.capability,
    manifest,
    manifestCapability: capability,
    mode: 'canvas',
  })
}

function findManifest(modelId: string): MediaModelManifest {
  const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
    (entry) => entry.providerKind === 'apimart' && entry.modelId === modelId,
  )
  if (!manifest) throw new Error(`missing APIMart manifest ${modelId}`)
  return manifest
}

function images(
  count: number,
  role: 'first_frame' | 'last_frame' | 'reference' = 'reference',
): NonNullable<MediaGenerateInput['inputFiles']> {
  return Array.from({ length: count }, (_, index) => ({
    type: 'image' as const,
    role,
    url: `https://cdn/image-${role}-${index}.png`,
  }))
}

function videos(count: number): NonNullable<MediaGenerateInput['inputFiles']> {
  return Array.from({ length: count }, (_, index) => ({
    type: 'video' as const,
    role: 'reference' as const,
    url: `https://cdn/video-${index}.mp4`,
  }))
}

function operationForCapability(capability: MediaCapabilityId) {
  if (capability === 'video.edit') return 'video_edit' as const
  if (capability === 'video.reference_to_video') return 'image_to_video' as const
  if (capability === 'video.image_to_video') return 'image_to_video' as const
  return 'text_to_video' as const
}
