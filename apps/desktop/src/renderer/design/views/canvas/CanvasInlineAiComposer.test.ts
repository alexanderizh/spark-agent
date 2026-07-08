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

    expect(fields.map((item) => item.name)).toEqual(['size', 'quality'])
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

    expect(fields.map((item) => item.name)).toEqual(['aspect_ratio', 'quality'])
    expect(
      normalizeModelParamsForSubmit(
        { size: '1024x1024', aspect_ratio: '16:9', quality: 'standard' },
        {},
        fields,
      ),
    ).toEqual({ aspect_ratio: '16:9', quality: 'standard' })
  })

  it('clears the alternate image dimension draft when selecting size or aspect ratio', () => {
    expect(
      updateModelParamDraftValue(
        { size: '', aspect_ratio: '1:1', aspectRatio: '1:1' },
        'size',
        '1536x1024',
      ),
    ).toEqual({ size: '1536x1024', aspect_ratio: '', aspectRatio: '' })

    expect(
      updateModelParamDraftValue({ size: '1024x1024', aspect_ratio: '' }, 'aspect_ratio', '16:9'),
    ).toEqual({ size: '', aspect_ratio: '16:9' })
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
  })

  it('treats aliased aspect ratio params as covered by form fields', () => {
    expect(isModelParamCoveredByFields('aspect_ratio', [field('aspectRatio')])).toBe(true)
    expect(isModelParamCoveredByFields('aspectRatio', [field('aspect_ratio')])).toBe(true)
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
