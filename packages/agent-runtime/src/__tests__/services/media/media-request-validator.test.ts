import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  type MediaModelCapabilityManifest,
  type MediaModelManifest,
} from '@spark/protocol'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'

function capability(
  overrides: Partial<MediaModelCapabilityManifest> = {},
): MediaModelCapabilityManifest {
  return {
    id: 'video.image_to_video',
    label: '图生视频',
    input: { required: ['prompt', 'image'], maxImages: 1 },
    output: { types: ['video'] },
    paramSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        durationSeconds: { type: 'integer', minimum: 1, maximum: 15 },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p'] },
      },
    },
    ...overrides,
  }
}

function manifest(
  providerKind: string,
  modelId: string,
  mediaCapability: MediaModelCapabilityManifest,
): MediaModelManifest {
  return {
    id: `${providerKind}:${modelId}`,
    providerKind,
    modelId,
    displayName: modelId,
    domains: ['video'],
    capabilities: [mediaCapability],
    invocation: {
      mode: 'sync',
      endpoint: '/generate',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {},
      response: { kind: 'url', jsonPaths: ['data.url'], download: true },
    },
    docs: { sourceUrls: [] },
  }
}

describe('validateMediaRequest', () => {
  it('combines manifest schema and input constraint failures', () => {
    const cap = capability()
    const mediaManifest = manifest('custom', 'video-model', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '',
        inputFiles: [
          { type: 'image', url: 'https://example.com/1.png' },
          { type: 'image', url: 'https://example.com/2.png' },
        ],
        modelParams: { durationSeconds: 20, resolution: '4k' },
        outputDir: '',
      },
      providerKind: 'custom',
      modelId: 'video-model',
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'canvas',
    })

    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing_required', 'out_of_range', 'invalid_enum']),
    )
    expect(
      result.blockingIssues.some(
        (issue) =>
          issue.code === 'out_of_range' && issue.path.join('.') === 'modelParams.durationSeconds',
      ),
    ).toBe(true)
    expect(result.blockingIssues.some((issue) => issue.message.includes('最多支持 1 张'))).toBe(
      true,
    )
  })

  it('classifies generic file inputs by MIME type before enforcing media counts', () => {
    const cap = capability({
      id: 'video.reference_to_video',
      input: {
        required: ['prompt', 'video'],
        maxImages: 1,
        maxVideos: 1,
        maxAudios: 1,
        acceptedMimeTypes: ['image/png', 'video/mp4', 'audio/mpeg'],
      },
    })
    const mediaManifest = manifest('custom', 'multimodal-video-model', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.reference_to_video',
        prompt: 'follow the references',
        inputFiles: [
          {
            type: 'file',
            role: 'reference',
            mimeType: 'image/png',
            url: 'https://example.com/reference.png',
          },
          {
            type: 'file',
            role: 'reference',
            mimeType: 'video/mp4',
            url: 'https://example.com/reference-1.mp4',
          },
          {
            type: 'file',
            role: 'reference',
            mimeType: 'video/mp4',
            url: 'https://example.com/reference-2.mp4',
          },
          {
            type: 'file',
            role: 'reference',
            mimeType: 'audio/mpeg',
            url: 'https://example.com/reference.mp3',
          },
        ],
        outputDir: '',
      },
      providerKind: 'custom',
      modelId: 'multimodal-video-model',
      capability: 'video.reference_to_video',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'canvas',
    })

    expect(result.blockingIssues).toHaveLength(1)
    expect(result.blockingIssues[0]?.message).toContain('最多支持 1 段视频')
  })

  it('normalizes equivalent MIME spellings before enforcing accepted formats', () => {
    const cap = capability({
      input: {
        required: ['image'],
        maxImages: 1,
        acceptedMimeTypes: ['image/jpeg'],
      },
    })
    const mediaManifest = manifest('custom', 'jpeg-model', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          {
            type: 'image',
            mimeType: 'IMAGE/JPG; charset=binary',
            url: 'https://example.com/frame.jpg',
          },
        ],
        outputDir: '',
      },
      providerKind: 'custom',
      modelId: 'jpeg-model',
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'canvas',
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('keeps xAI model-specific rules isolated in the xAI validator', () => {
    const cap = capability({
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
    })
    const mediaManifest = manifest('xai', 'grok-imagine-video-1.5', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: 'make a video',
        inputFiles: [{ type: 'image', role: 'last_frame', url: 'https://example.com/end.png' }],
        modelParams: { resolution: '1080p' },
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: 'grok-imagine-video-1.5',
      capability: 'video.generate',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'canvas',
    })

    expect(result.blockingIssues.some((issue) => issue.message.includes('仅支持图生视频'))).toBe(
      true,
    )
    expect(result.blockingIssues.some((issue) => issue.message.includes('不支持尾帧'))).toBe(true)
  })

  it('enforces the documented xAI reference-image limit and still validates extension duration', () => {
    const referenceCapability = capability({
      id: 'video.reference_to_video',
      input: { required: ['prompt', 'images'], maxImages: 9 },
    })
    const referenceManifest = manifest('xai', 'grok-imagine-video', referenceCapability)
    const referenceResult = validateMediaRequest({
      input: {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        prompt: 'animate',
        inputFiles: Array.from({ length: 7 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          url: `https://example.com/${index}.png`,
        })),
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: 'grok-imagine-video',
      capability: 'video.reference_to_video',
      manifest: referenceManifest,
      manifestCapability: referenceCapability,
    })
    expect(referenceResult.blockingIssues).toEqual([])

    const extensionCapability = capability({
      id: 'video.extend',
      input: { required: ['prompt', 'video'] },
    })
    const extensionManifest = manifest('xai', 'grok-imagine-video', extensionCapability)
    const extensionResult = validateMediaRequest({
      input: {
        operation: 'video_extend',
        capability: 'video.extend',
        prompt: 'continue',
        inputFiles: [{ type: 'video', url: 'https://example.com/input.mp4' }],
        modelParams: { durationSeconds: 3.5 },
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: 'grok-imagine-video',
      capability: 'video.extend',
      manifest: extensionManifest,
      manifestCapability: extensionCapability,
    })
    expect(
      extensionResult.blockingIssues.some((issue) => issue.message.includes('必须为整数')),
    ).toBe(true)
  })

  it('rejects an eighth xAI reference image before adapter execution', () => {
    const mediaManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'xai:grok-imagine-video',
    )!
    const capability = mediaManifest.capabilities.find(
      (entry) => entry.id === 'video.reference_to_video',
    )!
    const result = validateMediaRequest({
      input: {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        prompt: 'use these references',
        inputFiles: Array.from({ length: 8 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          url: `https://example.com/reference-${index}.png`,
        })),
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: mediaManifest.modelId,
      capability: 'video.reference_to_video',
      manifest: mediaManifest,
      manifestCapability: capability,
    })

    expect(result.blockingIssues.some((issue) => issue.code === 'out_of_range')).toBe(true)
  })

  it('accepts Seedance 1.5 Pro first and last frame input', () => {
    const mediaManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'apimart:doubao-seedance-1-5-pro-apimart',
    )
    const mediaCapability = mediaManifest?.capabilities.find(
      (entry) => entry.id === 'video.image_to_video',
    )
    expect(mediaManifest).toBeDefined()
    expect(mediaCapability).toBeDefined()

    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'animate from first frame to last frame',
        inputFiles: [
          { type: 'image', role: 'first_frame', url: 'https://example.com/first.png' },
          { type: 'image', role: 'last_frame', url: 'https://example.com/last.png' },
        ],
        outputDir: '',
      },
      providerKind: 'apimart',
      modelId: 'doubao-seedance-1-5-pro',
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: mediaCapability,
      mode: 'canvas',
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('does not reject xAI video prompts using an undocumented local character limit', () => {
    const cap = capability()
    const mediaManifest = manifest('xai', 'grok-imagine-video', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'x'.repeat(4_097),
        inputFiles: [{ type: 'image', url: 'https://example.com/frame.png' }],
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: 'grok-imagine-video',
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: cap,
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('accepts promptless xAI image-to-video and 10-second reference requests', () => {
    const mediaManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'xai:grok-imagine-video',
    )
    const imageToVideo = mediaManifest?.capabilities.find(
      (entry) => entry.id === 'video.image_to_video',
    )
    const referenceToVideo = mediaManifest?.capabilities.find(
      (entry) => entry.id === 'video.reference_to_video',
    )
    expect(mediaManifest).toBeDefined()
    expect(imageToVideo).toBeDefined()
    expect(referenceToVideo).toBeDefined()

    const imageResult = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          { type: 'image', role: 'first_frame', url: 'https://example.com/frame.png' },
        ],
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: mediaManifest!.modelId,
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: imageToVideo,
      mode: 'canvas',
    })
    const referenceResult = validateMediaRequest({
      input: {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        prompt: 'use these references',
        inputFiles: Array.from({ length: 7 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          url: `https://example.com/reference-${index}.png`,
        })),
        modelParams: { durationSeconds: 10 },
        outputDir: '',
      },
      providerKind: 'xai',
      modelId: mediaManifest!.modelId,
      capability: 'video.reference_to_video',
      manifest: mediaManifest,
      manifestCapability: referenceToVideo,
      mode: 'canvas',
    })

    expect(imageResult.blockingIssues).toEqual([])
    expect(referenceResult.blockingIssues).toEqual([])
  })

  it('validates Google image transport before adapter execution', () => {
    const cap = capability({
      id: 'image.edit',
      label: '图片编辑',
      input: { required: ['prompt', 'image'], maxImages: 3 },
      output: { types: ['image'] },
      paramSchema: { type: 'object', properties: {} },
    })
    const mediaManifest = manifest('google-generative-ai', 'gemini-image', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_edit',
        capability: 'image.edit',
        prompt: 'edit',
        inputFiles: [{ type: 'image', url: 'https://example.com/input.png' }],
        outputDir: '',
      },
      providerKind: 'google-generative-ai',
      modelId: 'gemini-image',
      capability: 'image.edit',
      manifest: mediaManifest,
      manifestCapability: cap,
    })

    expect(
      result.blockingIssues.some((issue) => issue.message.includes('dataUrl 或本地文件路径')),
    ).toBe(true)
  })

  it('does not apply the Veo three-reference limit to Google image editing', () => {
    const mediaManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'google:gemini-3.1-flash-image',
    )
    const mediaCapability = mediaManifest?.capabilities.find(
      (entry) => entry.id === 'image.edit',
    )
    expect(mediaManifest).toBeDefined()
    expect(mediaCapability?.input.maxImages).toBe(8)

    const result = validateMediaRequest({
      input: {
        operation: 'image_edit',
        capability: 'image.edit',
        prompt: 'combine the references',
        inputFiles: Array.from({ length: 4 }, (_, index) => ({
          type: 'image' as const,
          role: 'reference' as const,
          dataUrl: `data:image/png;base64,AAAA${index}`,
          mimeType: 'image/png',
        })),
        outputDir: '',
      },
      providerKind: 'google-generative-ai',
      modelId: mediaManifest!.modelId,
      capability: 'image.edit',
      manifest: mediaManifest,
      manifestCapability: mediaCapability,
      mode: 'canvas',
    })

    expect(result.blockingIssues).toEqual([])
  })

  it('rejects malformed media data URLs', () => {
    const cap = capability()
    const mediaManifest = manifest('custom', 'video-model', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'animate',
        inputFiles: [{ type: 'image', dataUrl: 'not-a-data-url' }],
        outputDir: '',
      },
      providerKind: 'custom',
      modelId: 'video-model',
      capability: 'video.image_to_video',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'canvas',
    })

    expect(
      result.blockingIssues.some((issue) => issue.path.join('.') === 'inputFiles.0.dataUrl'),
    ).toBe(true)
  })

  it('reports prompt reference thresholds as warnings and never as blocking issues', () => {
    const cap = capability({
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
    })
    const mediaManifest: MediaModelManifest = {
      ...manifest('custom', 'token-limited-image', cap),
      safety: {
        maxPromptLength: 4,
        promptLengthUnit: 'tokens',
        promptOverflowBehavior: 'truncate',
      },
    }
    const result = validateMediaRequest({
      input: {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: '一段明显超过参考阈值的提示词',
        outputDir: '',
      },
      providerKind: 'custom',
      modelId: mediaManifest.modelId,
      capability: 'image.generate',
      manifest: mediaManifest,
      manifestCapability: cap,
      mode: 'adapter',
    })

    expect(result.blockingIssues).toEqual([])
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'out_of_range',
          message: expect.stringContaining('本地不会阻断请求'),
        }),
      ]),
    )
  })

  it('keeps APIMart image transport rules in its provider validator', () => {
    const cap = capability({
      id: 'image.edit',
      label: '图片编辑',
      input: { required: ['prompt', 'image'], maxImages: 3 },
      output: { types: ['image'] },
      paramSchema: { type: 'object', properties: {} },
    })
    const mediaManifest = manifest('apimart', 'gpt-image-2', cap)
    const result = validateMediaRequest({
      input: {
        operation: 'image_edit',
        capability: 'image.edit',
        prompt: 'edit',
        inputFiles: [{ type: 'image', url: 'safe-file://canvas/input.png' }],
        outputDir: '',
      },
      providerKind: 'apimart',
      modelId: 'gpt-image-2',
      capability: 'image.edit',
      manifest: mediaManifest,
      manifestCapability: cap,
    })

    expect(
      result.blockingIssues.some((issue) =>
        issue.message.includes('公网图片 URL、dataUrl 或本地文件路径'),
      ),
    ).toBe(true)
  })
})
