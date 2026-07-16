import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./canvasMediaContract', () => ({
  pruneModelParamsForCanvas: vi.fn(),
}))

import { pruneModelParamsForCanvas } from './canvasMediaContract'
import {
  CanvasTaskValidationError,
  validateCanvasMediaTaskSubmission,
  validateCanvasTextTaskSubmission,
} from './canvasTaskSubmissionValidation'

const mockedPrune = vi.mocked(pruneModelParamsForCanvas)

describe('canvasTaskSubmissionValidation', () => {
  beforeEach(() => {
    mockedPrune.mockReset()
    mockedPrune.mockResolvedValue({
      modelParams: {},
      droppedParams: [],
      warnings: [],
      validationIssues: [],
    })
  })

  it('blocks missing operation inputs before creating an optimistic task', async () => {
    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'image_to_video',
        prompt: 'animate',
        inputNodeIds: [],
        inputFiles: [],
      }),
    ).rejects.toMatchObject({
      name: 'CanvasTaskValidationError',
      message: '请至少选择一张输入图片',
    })
    expect(mockedPrune).not.toHaveBeenCalled()
  })

  it('passes the final prompt, model and materialized inputs to provider validation', async () => {
    mockedPrune.mockResolvedValue({
      modelParams: { duration: 8 },
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      resolvedManifestId: 'xai:grok-imagine-video',
      resolvedProviderProfileId: 'provider-1',
      resolvedModelId: 'grok-imagine-video',
    })
    const result = await validateCanvasMediaTaskSubmission({
      operation: 'image_to_video',
      prompt: 'animate',
      manifestId: 'xai:grok-imagine-video',
      providerProfileId: 'provider-1',
      modelId: 'grok-imagine-video',
      modelParams: { durationSeconds: 8 },
      inputFiles: [
        {
          type: 'image',
          role: 'first_frame',
          dataUrl: 'data:image/png;base64,AAAA',
          mimeType: 'image/png',
        },
      ],
    })

    expect(mockedPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'image_to_video',
        prompt: 'animate',
        modelId: 'grok-imagine-video',
        validateSubmission: true,
      }),
    )
    expect(result.modelParams).toEqual({ duration: 8 })
    expect(result).toMatchObject({
      manifestId: 'xai:grok-imagine-video',
      providerProfileId: 'provider-1',
      modelId: 'grok-imagine-video',
    })
  })

  it('throws structured provider validation issues', async () => {
    mockedPrune.mockResolvedValue({
      modelParams: {},
      droppedParams: [],
      warnings: [],
      validationIssues: [
        {
          severity: 'error',
          code: 'out_of_range',
          message: 'duration is invalid',
          path: ['modelParams', 'durationSeconds'],
        },
      ],
    })

    const promise = validateCanvasMediaTaskSubmission({
      operation: 'text_to_video',
      prompt: 'animate',
      manifestId: 'xai:grok-imagine-video',
    })
    await expect(promise).rejects.toBeInstanceOf(CanvasTaskValidationError)
    await expect(promise).rejects.toMatchObject({ message: 'duration is invalid' })
  })

  it('blocks submission when no enabled model can be validated', async () => {
    mockedPrune.mockResolvedValue({
      modelParams: {},
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: '未找到已启用的媒体模型',
    })

    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'text_to_video',
        prompt: 'animate',
      }),
    ).rejects.toMatchObject({
      name: 'CanvasTaskValidationError',
      message: expect.stringContaining('未找到已启用的媒体模型'),
    })
  })

  it('validates common text model parameters', () => {
    expect(() =>
      validateCanvasTextTaskSubmission({
        operation: 'text_generate',
        prompt: 'write',
        modelParams: { temperature: 3, maxTokens: 0 },
      }),
    ).toThrow(CanvasTaskValidationError)
  })

  it('accepts compiled text from a prompt document', () => {
    expect(() =>
      validateCanvasTextTaskSubmission({
        operation: 'text_generate',
        prompt: '',
        compiledUserText: '已经编译完成的用户文本',
      }),
    ).not.toThrow()
  })

  it('accepts markdown response format used by text presets', () => {
    expect(() =>
      validateCanvasTextTaskSubmission({
        operation: 'text_generate',
        prompt: 'write',
        modelParams: { responseFormat: 'markdown' },
      }),
    ).not.toThrow()
  })

  it('rejects non-string response formats', () => {
    expect(() =>
      validateCanvasTextTaskSubmission({
        operation: 'text_generate',
        prompt: 'write',
        modelParams: { responseFormat: 123 },
      }),
    ).toThrow('responseFormat 必须是字符串')
  })
})
