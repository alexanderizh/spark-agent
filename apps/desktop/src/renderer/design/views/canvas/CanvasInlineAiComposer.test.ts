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
  mergeSchemaFields,
  normalizeModelParamsForSubmit,
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
    const fields = mergeSchemaFields(
      [field('size')],
      [field('aspect_ratio'), field('quality')],
    )

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
    const fields = mergeSchemaFields(
      [field('aspect_ratio')],
      [field('size'), field('quality')],
    )

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
      updateModelParamDraftValue(
        { size: '1024x1024', aspect_ratio: '' },
        'aspect_ratio',
        '16:9',
      ),
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
