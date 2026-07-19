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

  it('classifies generic file inputs by MIME type during basic validation', async () => {
    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'video_edit',
        prompt: 'restyle',
        inputFiles: [
          {
            type: 'file',
            role: 'input',
            mimeType: 'video/mp4',
            url: 'https://example.com/input.mp4',
          },
        ],
      }),
    ).resolves.toMatchObject({ operation: 'video_edit' })

    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'image_to_video',
        prompt: 'animate',
        inputFiles: [
          {
            type: 'file',
            role: 'reference',
            mimeType: 'video/mp4',
            url: 'https://example.com/reference.mp4',
          },
        ],
      }),
    ).rejects.toMatchObject({ message: '请至少选择一张输入图片' })
  })

  it('passes the final prompt, model and materialized inputs to provider validation', async () => {
    mockedPrune.mockResolvedValue({
      modelParams: { durationSeconds: 8 },
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
    expect(result.modelParams).toEqual({ durationSeconds: 8 })
    expect(result).toMatchObject({
      manifestId: 'xai:grok-imagine-video',
      providerProfileId: 'provider-1',
      modelId: 'grok-imagine-video',
    })
  })

  it('preflights the composed provider prompt without overwriting the authored user prompt', async () => {
    const result = await validateCanvasMediaTaskSubmission({
      operation: 'text_to_image',
      prompt: '用户画面要求',
      systemPrompt: '内置构图约束',
    })

    expect(mockedPrune).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '内置构图约束\n\n用户画面要求' }),
    )
    expect(result.prompt).toBe('用户画面要求')
    expect(result.systemPrompt).toBe('内置构图约束')
  })

  it('accepts a media task when the effective prompt comes from system or compiled text', async () => {
    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'text_to_image',
        prompt: '',
        systemPrompt: '完整的内置出图指令',
      }),
    ).resolves.toMatchObject({ systemPrompt: '完整的内置出图指令' })

    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'text_to_image',
        prompt: '',
        compiledUserText: '来自引用节点的已编译文本',
      }),
    ).resolves.toMatchObject({ compiledUserText: '来自引用节点的已编译文本' })
  })

  it('keeps provider validation issues advisory instead of blocking submission', async () => {
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

    const result = await validateCanvasMediaTaskSubmission({
      operation: 'text_to_video',
      prompt: 'animate',
      manifestId: 'xai:grok-imagine-video',
    })
    expect(result.modelParamWarnings).toEqual([
      { code: 'out_of_range', message: 'duration is invalid' },
    ])
  })

  it('still blocks malformed local input payloads before model validation', async () => {
    await expect(
      validateCanvasMediaTaskSubmission({
        operation: 'image_to_image',
        prompt: 'restyle',
        inputFiles: [{ type: 'image', dataUrl: 'invalid' }],
      }),
    ).rejects.toMatchObject({
      name: 'CanvasTaskValidationError',
      message: expect.stringContaining('dataUrl 格式无效'),
    })
    expect(mockedPrune).not.toHaveBeenCalled()
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
