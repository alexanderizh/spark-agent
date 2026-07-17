import { describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({
  Button: 'button',
  Checkbox: 'input',
  Input: 'input',
  Select: 'select',
  Tag: 'span',
}))
vi.mock('../../Icons', () => ({ Icons: new Proxy({}, { get: () => () => null }) }))
vi.mock('@spark/protocol', () => ({ capabilityForOperation: () => [] }))
vi.mock('./canvas.api', () => ({ canvasApi: { listMediaModels: vi.fn() } }))

import {
  isModelParamCoveredByFields,
  mergeSchemaFields,
  nodeDefaultModelParams,
  normalizeModelParamsForSubmit,
  readModelParamDraftValue,
  resolveInitialModelParamDraftValue,
  schemaFields,
  updateModelParamDraftValue,
  type SchemaField,
} from './CanvasInlineAiComposer'

const field = (name: string): SchemaField => ({
  name,
  title: name,
  type: 'string',
  enumValues: [],
})

describe('CanvasInlineAiComposer image dimension params', () => {
  it('shows and submits only size when the model schema accepts size', () => {
    const fields = mergeSchemaFields([field('size')], [field('aspect_ratio'), field('quality')])

    expect(fields.map((item) => item.name)).toEqual(['size'])
    expect(
      normalizeModelParamsForSubmit(
        { size: '1024x1024', aspect_ratio: '1:1', quality: 'high' },
        {},
        fields,
      ),
    ).toEqual({ size: '1024x1024', quality: 'high' })
  })

  it('shows and submits only aspect_ratio when the model schema accepts aspect_ratio', () => {
    const fields = mergeSchemaFields([field('aspect_ratio')], [field('size'), field('quality')])

    expect(fields.map((item) => item.name)).toEqual(['aspect_ratio'])
    expect(
      normalizeModelParamsForSubmit(
        { size: '1024x1024', aspect_ratio: '16:9', quality: 'standard' },
        {},
        fields,
      ),
    ).toEqual({ aspect_ratio: '16:9', quality: 'standard' })
  })

  it('uses operation suggestions only when the selected model has no parameter schema', () => {
    const fields = mergeSchemaFields([], [field('size'), field('aspect_ratio'), field('quality')])

    expect(fields.map((item) => item.name)).toEqual(['size', 'aspect_ratio', 'quality'])
  })

  it('clears the alternate image dimension draft when selecting size or aspect ratio', () => {
    expect(
      updateModelParamDraftValue(
        { size: '', ratio: '1:1', aspect_ratio: '1:1', aspectRatio: '1:1' },
        'size',
        '1536x1024',
      ),
    ).toEqual({ size: '1536x1024', ratio: '', aspect_ratio: '', aspectRatio: '' })

    expect(
      updateModelParamDraftValue({ size: '1024x1024', aspect_ratio: '' }, 'aspect_ratio', '16:9'),
    ).toEqual({ size: '', aspect_ratio: '16:9' })

    expect(updateModelParamDraftValue({ size: '2K', ratio: '' }, 'ratio', '9:16')).toEqual({
      size: '',
      ratio: '9:16',
    })
  })

  it('cleans submitted defaults when both size and aspect_ratio are present', () => {
    const fields = mergeSchemaFields([field('size'), field('aspect_ratio')])

    expect(
      normalizeModelParamsForSubmit(
        { size: '1024x1024', aspect_ratio: '16:9' },
        { size: '1024x1024' },
        fields,
      ),
    ).toEqual({ aspect_ratio: '16:9' })

    expect(
      normalizeModelParamsForSubmit(
        { size: '1536x1024', aspect_ratio: '1:1' },
        { aspect_ratio: '1:1' },
        fields,
      ),
    ).toEqual({ size: '1536x1024' })

    expect(
      normalizeModelParamsForSubmit(
        { size: '2K', ratio: '9:16', aspectRatio: '1:1' },
        { size: '2K' },
        [field('ratio')],
      ),
    ).toEqual({ ratio: '9:16' })
  })
})

describe('CanvasInlineAiComposer node default model params', () => {
  const node = (
    modelParams?: Record<string, unknown>,
  ): { data: { modelParams?: Record<string, unknown> } } => ({
    data: modelParams ? { modelParams } : {},
  })

  it('回填节点持久化的、且在草稿可见字段内的默认参数（如身份板 16:9）', () => {
    const fields = [field('aspect_ratio'), field('quality')]
    const result = nodeDefaultModelParams(
      [node({ aspect_ratio: '16:9', resolution: '2k' })],
      fields,
    )
    expect(result).toEqual({ aspect_ratio: '16:9' })
  })

  it('忽略不在可见字段内的参数，避免塞进面板', () => {
    const result = nodeDefaultModelParams([node({ unknown_param: 'x' })], [field('aspect_ratio')])
    expect(result).toEqual({})
  })

  it('跳过无 modelParams 的节点，取首个有值的节点', () => {
    expect(
      nodeDefaultModelParams([node(), node({ aspect_ratio: '16:9' })], [field('aspect_ratio')]),
    ).toEqual({ aspect_ratio: '16:9' })
  })

  it('reads aliased aspect ratio defaults across aspect_ratio and aspectRatio', () => {
    expect(readModelParamDraftValue({ aspect_ratio: '2:1' }, 'aspectRatio')).toBe('2:1')
    expect(readModelParamDraftValue({ aspectRatio: '2:1' }, 'aspect_ratio')).toBe('2:1')
    expect(readModelParamDraftValue({ ratio: '16:9' }, 'aspectRatio')).toBe('16:9')
    expect(readModelParamDraftValue({ aspect_ratio: '9:16' }, 'ratio')).toBe('9:16')
    expect(nodeDefaultModelParams([node({ ratio: '4:3' })], [field('aspectRatio')])).toEqual({
      aspectRatio: '4:3',
    })
  })

  it('reads and covers persisted duration aliases as the same form field', () => {
    expect(readModelParamDraftValue({ duration: 3 }, 'durationSeconds')).toBe('3')
    expect(readModelParamDraftValue({ durationSeconds: 3 }, 'duration')).toBe('3')
    expect(isModelParamCoveredByFields('duration', [field('durationSeconds')])).toBe(true)
    expect(isModelParamCoveredByFields('durationSeconds', [field('duration')])).toBe(true)
  })

  it('reads common provider snake_case fields through canonical canvas names', () => {
    expect(readModelParamDraftValue({ generate_audio: true }, 'generateAudio')).toBe('true')
    expect(readModelParamDraftValue({ prompt_extend: false }, 'promptExtend')).toBe('false')
    expect(readModelParamDraftValue({ enable_search: true }, 'searchEnabled')).toBe('true')
    expect(readModelParamDraftValue({ response_format: 'url' }, 'responseFormat')).toBe('url')
    expect(readModelParamDraftValue({ sample_rate: 24_000 }, 'sampleRate')).toBe('24000')
  })

  it('preserves JSON Schema patterns for custom value validation', () => {
    expect(
      schemaFields({
        properties: {
          size: {
            type: 'string',
            enum: ['2K', '4K'],
            'x-allow-custom': true,
            pattern: '^\\d+x\\d+$',
          },
        },
      })[0],
    ).toMatchObject({
      allowCustom: true,
      pattern: '^\\d+x\\d+$',
    })
  })

  it('falls back to the model default when a persisted value is incompatible', () => {
    expect(
      resolveInitialModelParamDraftValue({
        operation: 'image_edit',
        field: {
          ...field('size'),
          enumValues: ['2K', '4K'],
          allowCustom: true,
          pattern: '^\\d+x\\d+$',
        },
        fieldName: 'size',
        presetParams: {},
        existingParams: { size: '2:1' },
        defaultParams: { size: '2K' },
      }),
    ).toBe('2K')
  })

  it('treats aliased aspect ratio params as covered by form fields', () => {
    expect(isModelParamCoveredByFields('aspect_ratio', [field('aspectRatio')])).toBe(true)
    expect(isModelParamCoveredByFields('aspectRatio', [field('aspect_ratio')])).toBe(true)
    expect(isModelParamCoveredByFields('ratio', [field('aspectRatio')])).toBe(true)
    expect(isModelParamCoveredByFields('aspect_ratio', [field('ratio')])).toBe(true)
  })

  it('treats panorama aspect ratio params as covered when the schema exposes size', () => {
    expect(
      isModelParamCoveredByFields('aspect_ratio', [
        { ...field('size'), enumValues: ['1:1', '16:9', '2:1'] },
      ]),
    ).toBe(true)
  })

  it('forces panorama aspect ratio init to preset 2:1 ahead of model default 1:1', () => {
    expect(
      resolveInitialModelParamDraftValue({
        operation: 'panorama_360',
        field: field('aspectRatio'),
        fieldName: 'aspectRatio',
        presetParams: { aspect_ratio: '2:1' },
        existingParams: {},
        defaultParams: { aspectRatio: '1:1' },
      }),
    ).toBe('2:1')
  })

  it('maps panorama preset 2:1 to a dynamic size field when the model schema uses size', () => {
    expect(
      resolveInitialModelParamDraftValue({
        operation: 'panorama_360',
        field: { ...field('size'), enumValues: ['1:1', '16:9', '2:1'] },
        fieldName: 'size',
        presetParams: { aspect_ratio: '2:1' },
        existingParams: { size: '1:1' },
        defaultParams: { size: '1:1' },
      }),
    ).toBe('2:1')
  })

  it('maps panorama preset 2:1 to matching dimensions when size enums are width x height', () => {
    expect(
      resolveInitialModelParamDraftValue({
        operation: 'panorama_360',
        field: { ...field('size'), enumValues: ['1024x1024', '2048x1024'] },
        fieldName: 'size',
        presetParams: { aspect_ratio: '2:1' },
        existingParams: { size: '1024x1024' },
        defaultParams: { size: '1024x1024' },
      }),
    ).toBe('2048x1024')
  })
})
