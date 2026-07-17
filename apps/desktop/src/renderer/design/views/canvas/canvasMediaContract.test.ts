import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./canvas.api', () => ({
  canvasApi: {
    listMediaModels: vi.fn(),
    pruneMediaModelParams: vi.fn(),
  },
}))

import { canvasApi } from './canvas.api'
import {
  pruneModelParamsForCanvas,
  summarizeDroppedParams,
} from './canvasMediaContract'
import type { CanvasMediaPruneModelParamsResponse } from '@spark/protocol'

function mockPruneResponse(response: Partial<CanvasMediaPruneModelParamsResponse>): void {
  ;(canvasApi.pruneMediaModelParams as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    prunedModelParams: {},
    droppedParams: [],
    warnings: [],
    validationIssues: [],
    ...response,
  })
}

describe('pruneModelParamsForCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns original modelParams when manifestId is missing', async () => {
    const result = await pruneModelParamsForCanvas({
      operation: 'text_to_image',
      modelParams: { aspectRatio: '16:9' },
    })
    expect(result.modelParams).toEqual({ aspectRatio: '16:9' })
    expect(result.droppedParams).toEqual([])
    expect(result.fallbackReason).toMatch(/manifestId/)
    expect(canvasApi.pruneMediaModelParams).not.toHaveBeenCalled()
  })

  it('invokes pruneMediaModelParams with derived capability from operation', async () => {
    mockPruneResponse({
      prunedModelParams: { aspectRatio: '16:9' },
      droppedParams: [{ name: 'output_format', reason: 'unsupported_by_model' }],
    })
    const result = await pruneModelParamsForCanvas({
      operation: 'text_to_image',
      manifestId: 'volcengine:doubao-seedream-4-0',
      modelParams: { aspectRatio: '16:9', output_format: 'png' },
    })
    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith({
      manifestId: 'volcengine:doubao-seedream-4-0',
      capabilityId: 'image.generate',
      modelParams: { aspectRatio: '16:9', output_format: 'png' },
    })
    expect(result.modelParams).toEqual({ aspectRatio: '16:9' })
    expect(result.droppedParams).toHaveLength(1)
    expect(result.droppedParams[0]?.name).toBe('output_format')
  })

  it('resolves an enabled model for final validation when manifestId is missing', async () => {
    ;(canvasApi.listMediaModels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      models: [
        {
          manifestId: 'xai:grok-imagine-video',
          providerProfileId: 'profile-xai',
          providerKind: 'xai',
          modelId: 'grok-imagine-video',
          effectiveModelId: 'grok-imagine-video',
          displayName: 'Grok Imagine Video',
          domains: ['video'],
          invocationMode: 'async',
          capabilities: [],
          sourceUrls: [],
          enabled: true,
        },
      ],
    })
    mockPruneResponse({ prunedModelParams: { durationSeconds: 8 } })

    const result = await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      prompt: 'animate',
      validateSubmission: true,
      modelParams: { durationSeconds: 8 },
      inputFiles: [{ type: 'image', dataUrl: 'data:image/png;base64,AA==' }],
    })

    expect(canvasApi.listMediaModels).toHaveBeenCalledWith({
      capability: 'video.image_to_video',
      enabledOnly: true,
    })
    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestId: 'xai:grok-imagine-video',
        providerProfileId: 'profile-xai',
        modelId: 'grok-imagine-video',
        validateSubmission: true,
      }),
    )
    expect(result.modelParams).toEqual({ durationSeconds: 8 })
    expect(result).toMatchObject({
      resolvedManifestId: 'xai:grok-imagine-video',
      resolvedProviderProfileId: 'profile-xai',
      resolvedModelId: 'grok-imagine-video',
    })
  })

  it('validates Grok multi-reference input with reference-to-video capability', async () => {
    ;(canvasApi.listMediaModels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      models: [
        {
          manifestId: 'xai:grok-imagine-video',
          providerProfileId: 'profile-xai',
          providerKind: 'xai',
          modelId: 'grok-imagine-video',
          effectiveModelId: 'grok-imagine-video',
          displayName: 'Grok Imagine Video',
          domains: ['video'],
          invocationMode: 'async',
          capabilities: [
            { id: 'video.image_to_video', label: '图生视频', input: { required: ['image'], maxImages: 1 }, output: { types: ['video'] }, paramSchema: {} },
            { id: 'video.reference_to_video', label: '多参考图生视频', input: { required: ['image'], maxImages: 7 }, output: { types: ['video'] }, paramSchema: {} },
          ],
          sourceUrls: [],
          enabled: true,
        },
      ],
    })
    mockPruneResponse({ prunedModelParams: {} })

    await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      manifestId: 'xai:grok-imagine-video',
      providerProfileId: 'profile-xai',
      modelId: 'grok-imagine-video',
      prompt: 'animate both references',
      validateSubmission: true,
      modelParams: {},
      inputFiles: [
        { type: 'image', role: 'reference', url: 'https://example.com/ref-1.png' },
        { type: 'image', role: 'reference', url: 'https://example.com/ref-2.png' },
      ],
    })

    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'video.reference_to_video' }),
    )
  })

  it('falls back to image-to-video discovery when no reference capability is available', async () => {
    ;(canvasApi.listMediaModels as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ models: [] })
      .mockResolvedValueOnce({
        models: [
          {
            manifestId: 'xai:grok-imagine-video-1.5',
            providerProfileId: 'profile-xai',
            providerKind: 'xai',
            modelId: 'grok-imagine-video-1.5',
            effectiveModelId: 'grok-imagine-video-1.5',
            displayName: 'Grok Imagine Video 1.5',
            domains: ['video'],
            invocationMode: 'async',
            capabilities: [
              { id: 'video.image_to_video', label: '图生视频', input: { required: ['image'], maxImages: 1 }, output: { types: ['video'] }, paramSchema: {} },
            ],
            sourceUrls: [],
            enabled: true,
          },
        ],
      })
    mockPruneResponse({ prunedModelParams: {} })

    const result = await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      prompt: 'animate this image',
      validateSubmission: true,
      modelParams: {},
      inputFiles: [
        { type: 'image', role: 'reference', url: 'https://example.com/ref.png' },
      ],
    })

    expect(canvasApi.listMediaModels).toHaveBeenNthCalledWith(1, {
      capability: 'video.reference_to_video',
      enabledOnly: true,
    })
    expect(canvasApi.listMediaModels).toHaveBeenNthCalledWith(2, {
      capability: 'video.image_to_video',
      enabledOnly: true,
    })
    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'video.image_to_video' }),
    )
    expect(result.fallbackReason).toBeUndefined()
  })

  it('discovers reference-to-video for multiple role-less images from legacy canvas data', async () => {
    ;(canvasApi.listMediaModels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      models: [
        {
          manifestId: 'xai:grok-imagine-video',
          providerProfileId: 'profile-xai',
          providerKind: 'xai',
          modelId: 'grok-imagine-video',
          effectiveModelId: 'grok-imagine-video',
          displayName: 'Grok Imagine Video',
          domains: ['video'],
          invocationMode: 'async',
          capabilities: [
            { id: 'video.image_to_video', label: '图生视频', input: { required: ['image'], maxImages: 1 }, output: { types: ['video'] }, paramSchema: {} },
            { id: 'video.reference_to_video', label: '参考图生视频', input: { required: ['prompt', 'image'], maxImages: 7 }, output: { types: ['video'] }, paramSchema: {} },
          ],
          sourceUrls: [],
          enabled: true,
        },
      ],
    })
    mockPruneResponse({ prunedModelParams: {} })

    await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      prompt: 'use both images',
      validateSubmission: true,
      modelParams: {},
      inputFiles: [
        { type: 'image', url: 'https://example.com/one.png' },
        { type: 'image', url: 'https://example.com/two.png' },
      ],
    })

    expect(canvasApi.listMediaModels).toHaveBeenCalledWith({
      capability: 'video.reference_to_video',
      enabledOnly: true,
    })
    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: 'video.reference_to_video' }),
    )
  })

  it('does not fall back to a different model when an explicit model is unavailable', async () => {
    ;(canvasApi.listMediaModels as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      models: [
        {
          manifestId: 'xai:grok-imagine-video',
          providerProfileId: 'profile-xai',
          providerKind: 'xai',
          modelId: 'grok-imagine-video',
          effectiveModelId: 'grok-imagine-video',
          displayName: 'Grok Imagine Video',
          domains: ['video'],
          invocationMode: 'async',
          capabilities: [],
          sourceUrls: [],
          enabled: true,
        },
      ],
    })

    const result = await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      modelId: 'missing-video-model',
      prompt: 'animate',
      validateSubmission: true,
      modelParams: {},
      inputFiles: [{ type: 'image', dataUrl: 'data:image/png;base64,AA==' }],
    })

    expect(result.fallbackReason).toMatch(/missing-video-model/)
    expect(canvasApi.pruneMediaModelParams).not.toHaveBeenCalled()
  })

  it('passes through providerProfileId and inputFiles when provided', async () => {
    mockPruneResponse({ prunedModelParams: {} })
    await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      manifestId: 'xai:grok-imagine-video',
      providerProfileId: 'profile-1',
      modelParams: { durationSeconds: 8 },
      inputFiles: [{ type: 'image', role: 'first_frame', fileId: 'file-1' }],
    })
    expect(canvasApi.pruneMediaModelParams).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestId: 'xai:grok-imagine-video',
        providerProfileId: 'profile-1',
        capabilityId: 'video.image_to_video',
        inputFiles: [{ type: 'image', role: 'first_frame', fileId: 'file-1' }],
      }),
    )
  })

  it('sends only a short dataUrl summary to validation IPC', async () => {
    mockPruneResponse({ prunedModelParams: {} })
    const base64 = 'A'.repeat(10_000)

    await pruneModelParamsForCanvas({
      operation: 'image_to_video',
      manifestId: 'xai:grok-imagine-video',
      modelParams: {},
      inputFiles: [
        {
          type: 'image',
          dataUrl: `data:image/png;base64,${base64}`,
        },
      ],
    })

    const request = vi.mocked(canvasApi.pruneMediaModelParams).mock.calls[0]?.[0]
    expect(request?.inputFiles?.[0]?.dataUrl).toBe(`data:image/png;base64,${'A'.repeat(32)}`)
  })

  it('propagates warnings and validationIssues from main process', async () => {
    mockPruneResponse({
      prunedModelParams: { quality: 'hd' },
      warnings: [{ code: 'missing_param_policy', message: '当前模型未声明 paramPolicy' }],
      validationIssues: [
        { severity: 'error', code: 'invalid_enum', path: ['quality'], message: 'quality is invalid' },
      ],
    })
    const result = await pruneModelParamsForCanvas({
      operation: 'text_to_image',
      manifestId: 'agnes:agnes-image-v2',
      modelParams: { quality: 'hd' },
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('missing_param_policy')
    expect(result.validationIssues).toHaveLength(1)
    expect(result.validationIssues[0]?.code).toBe('invalid_enum')
  })

  it('passes fallbackReason through when main process returns one', async () => {
    mockPruneResponse({
      prunedModelParams: { foo: 'bar' },
      fallbackReason: 'manifest custom:missing not found',
    })
    const result = await pruneModelParamsForCanvas({
      operation: 'text_to_image',
      manifestId: 'custom:missing',
      modelParams: { foo: 'bar' },
    })
    expect(result.fallbackReason).toBe('manifest custom:missing not found')
  })
})

describe('summarizeDroppedParams', () => {
  it('returns empty string for empty array', () => {
    expect(summarizeDroppedParams([])).toBe('')
  })

  it('formats name and reason for each entry', () => {
    const summary = summarizeDroppedParams([
      { name: 'output_format', reason: 'unsupported_by_model' },
      { name: 'searchEnabled', reason: 'forbidden_by_contract' },
    ])
    expect(summary).toBe('output_format (unsupported_by_model), searchEnabled (forbidden_by_contract)')
  })
})
