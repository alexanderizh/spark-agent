// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  canvasParameterHistoryScope,
  readCanvasParameterHistory,
  recordCanvasCustomParameterHistory,
} from './canvasParameterHistory'
import type { SchemaField } from './canvasParameterPresentation'

const customSizeField: SchemaField = {
  name: 'size',
  title: '尺寸',
  type: 'string',
  enumValues: ['1K', '2K'],
  allowCustom: true,
  pattern: '^\\d+\\s*[xX]\\s*\\d+$',
}

const widthField: SchemaField = {
  name: 'width',
  title: '宽度',
  type: 'integer',
  enumValues: ['1024', '1280'],
  allowCustom: true,
  minimum: 512,
  maximum: 2048,
  multipleOf: 8,
}

describe('canvasParameterHistory', () => {
  beforeEach(() => window.localStorage.clear())

  it('stores only model-compatible custom values and keeps newest first', () => {
    const scope = canvasParameterHistoryScope({
      operation: 'text_to_image',
      modelKey: 'provider::manifest::model',
      capabilityId: 'image.generate',
    })
    recordCanvasCustomParameterHistory(scope, [customSizeField], { size: '2560x1440' })
    recordCanvasCustomParameterHistory(scope, [customSizeField], { size: 'not-a-size' })
    recordCanvasCustomParameterHistory(scope, [customSizeField], { size: '1920 x 1080' })

    expect(readCanvasParameterHistory(scope, 'size')).toEqual(['1920 x 1080', '2560x1440'])
  })

  it('validates numeric history against range and multipleOf', () => {
    const scope = canvasParameterHistoryScope({ operation: 'text_to_image', modelKey: 'model-a' })
    recordCanvasCustomParameterHistory(scope, [widthField], { width: 1536 })
    recordCanvasCustomParameterHistory(scope, [widthField], { width: 1537 })
    recordCanvasCustomParameterHistory(scope, [widthField], { width: 2560 })

    expect(readCanvasParameterHistory(scope, 'width')).toEqual(['1536'])
  })

  it('does not share values between models', () => {
    const first = canvasParameterHistoryScope({ operation: 'text_to_image', modelKey: 'model-a' })
    const second = canvasParameterHistoryScope({ operation: 'text_to_image', modelKey: 'model-b' })
    recordCanvasCustomParameterHistory(first, [customSizeField], { size: '2560x1440' })

    expect(readCanvasParameterHistory(second, 'size')).toEqual([])
  })
})
