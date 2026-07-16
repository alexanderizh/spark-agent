import { describe, expect, it } from 'vitest'
import type { SchemaField } from './canvasParameterPresentation'
import { mergeSeededModelParamDraft } from './canvasModelParamDraftState'

const sizeField: SchemaField = {
  name: 'size',
  title: '画幅',
  type: 'string',
  enumValues: ['2K', '4K'],
  allowCustom: true,
  pattern: '^\\d+\\s*[xX]\\s*\\d+$',
}

describe('model parameter draft compatibility', () => {
  it('falls back to the new model default when the old custom value is invalid', () => {
    expect(
      mergeSeededModelParamDraft({ size: '2:1' }, { size: '2K' }, [sizeField]),
    ).toEqual({ size: '2K' })
  })

  it('keeps a valid custom width-by-height value', () => {
    expect(
      mergeSeededModelParamDraft({ size: '2848x1600' }, { size: '2K' }, [sizeField]),
    ).toEqual({ size: '2848x1600' })
  })

  it('keeps an explicitly supported enum value', () => {
    expect(
      mergeSeededModelParamDraft({ size: '4K' }, { size: '2K' }, [sizeField]),
    ).toEqual({ size: '4K' })
  })

  it('keeps custom values when the schema has no format constraint', () => {
    expect(
      mergeSeededModelParamDraft(
        { size: 'provider-private' },
        { size: '2K' },
        [
          {
            name: 'size',
            title: '画幅',
            type: 'string',
            enumValues: ['2K', '4K'],
            allowCustom: true,
          },
        ],
      ),
    ).toEqual({ size: 'provider-private' })
  })
})
