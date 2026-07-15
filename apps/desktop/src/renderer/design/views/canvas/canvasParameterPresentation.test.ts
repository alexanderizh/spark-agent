import { describe, expect, it } from 'vitest'
import {
  aspectRatioShape,
  parameterSummaryValue,
  partitionParameterFields,
  presentField,
  type SchemaField,
} from './canvasParameterPresentation'

function field(
  name: string,
  enumValues: string[] = [],
  type = 'string',
  extra: Partial<SchemaField> = {},
): SchemaField {
  return {
    name,
    title: name,
    type,
    enumValues,
    ...extra,
  }
}

describe('canvasParameterPresentation', () => {
  it('maps high-frequency schema aliases to dedicated controls', () => {
    expect(presentField(field('aspect_ratio', ['1:1', '16:9']))).toMatchObject({
      control: 'aspect-ratio',
      tier: 'common',
    })
    expect(presentField(field('resolution', ['1K', '2K', '4K']))).toMatchObject({
      control: 'resolution',
      tier: 'common',
    })
    expect(presentField(field('n', ['1', '2', '4']))).toMatchObject({
      control: 'count',
      tier: 'common',
      unit: '张',
    })
    expect(presentField(field('durationSeconds', ['5', '8', '10']))).toMatchObject({
      control: 'duration',
      tier: 'common',
      unit: '秒',
    })
  })

  it('keeps operational and unknown fields in advanced settings', () => {
    expect(presentField(field('searchEnabled', [], 'boolean'))).toMatchObject({
      control: 'boolean',
      tier: 'advanced',
    })
    expect(presentField(field('seed', [], 'integer'))).toMatchObject({
      control: 'number',
      tier: 'advanced',
    })
    expect(presentField(field('private_mode', ['fast', 'slow']))).toMatchObject({
      control: 'enum',
      tier: 'advanced',
    })
  })

  it('recognizes ratio-like size fields including pixel canvas dimensions', () => {
    expect(presentField(field('size', ['1:1', '16:9']))).toMatchObject({
      control: 'aspect-ratio',
    })
    expect(presentField(field('size', ['1024x1024', '1536x1024']))).toMatchObject({
      control: 'aspect-ratio',
    })
  })

  it('normalizes visual ratio shapes and adaptive values', () => {
    expect(aspectRatioShape('16:9')).toEqual({ width: 32, height: 18 })
    expect(aspectRatioShape('9:16')).toEqual({ width: 18, height: 32 })
    expect(aspectRatioShape('adaptive')).toEqual({ width: 24, height: 18, adaptive: true })
    expect(aspectRatioShape('1536x1024')).toEqual({ width: 32, height: 21 })
    expect(aspectRatioShape('not-a-ratio')).toEqual({ width: 24, height: 18 })
  })

  it('partitions fields in schema order and formats summaries', () => {
    const partition = partitionParameterFields([
      field('aspect_ratio', ['1:1', '16:9']),
      field('resolution', ['1K', '2K']),
      field('n', ['1', '2']),
      field('seed', [], 'integer'),
    ])
    expect(partition.common.map((item) => item.field.name)).toEqual([
      'aspect_ratio',
      'resolution',
      'n',
    ])
    expect(partition.advanced.map((item) => item.field.name)).toEqual(['seed'])
    expect(parameterSummaryValue(partition.common[2]!, '2')).toBe('2张')
  })
})
