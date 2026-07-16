import { describe, expect, it } from 'vitest'
import type { MediaModelCapabilityManifest, MediaModelManifest } from '@spark/protocol'
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

  it('enforces xAI reference image and extension duration limits', () => {
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
        inputFiles: Array.from({ length: 8 }, (_, index) => ({
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
    expect(
      referenceResult.blockingIssues.some((issue) => issue.message.includes('最多支持 7 张')),
    ).toBe(true)

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

  it('rejects xAI video prompts longer than the provider limit before submission', () => {
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

    expect(
      result.blockingIssues.some(
        (issue) => issue.code === 'out_of_range' && issue.message.includes('4096'),
      ),
    ).toBe(true)
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
