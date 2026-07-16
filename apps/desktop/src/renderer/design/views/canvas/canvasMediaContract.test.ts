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
      prunedModelParams: { aspect_ratio: '16:9' },
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
    expect(result.modelParams).toEqual({ aspect_ratio: '16:9' })
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
    mockPruneResponse({ prunedModelParams: { duration: 8 } })

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
    expect(result.modelParams).toEqual({ duration: 8 })
    expect(result).toMatchObject({
      resolvedManifestId: 'xai:grok-imagine-video',
      resolvedProviderProfileId: 'profile-xai',
      resolvedModelId: 'grok-imagine-video',
    })
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
