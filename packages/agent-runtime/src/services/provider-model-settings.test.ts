import { describe, expect, it } from 'vitest'
import {
  isModelHiddenInPicker,
  resolveModelDefaultReasoningEffort,
} from './provider-model-settings.js'

describe('resolveModelDefaultReasoningEffort', () => {
  const source = {
    modelSettings: {
      'glm-5.3': { reasoningEffort: 'high' },
      hidden: { hidden: true },
      legacy: {},
    },
  } as unknown as Parameters<typeof resolveModelDefaultReasoningEffort>[0]

  it('读到该模型的合法默认档位', () => {
    expect(resolveModelDefaultReasoningEffort(source, 'glm-5.3')).toBe('high')
  })

  it('未配置推理默认（仅隐藏 / 空覆盖）时返回 undefined', () => {
    expect(resolveModelDefaultReasoningEffort(source, 'hidden')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(source, 'legacy')).toBeUndefined()
  })

  it('模型未配置 / 空 modelId / 空配置源一律 undefined（不猜测）', () => {
    expect(resolveModelDefaultReasoningEffort(source, 'unknown')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(source, '')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(source, '   ')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(source, null)).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(null, 'glm-5.3')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort(undefined, 'glm-5.3')).toBeUndefined()
    expect(resolveModelDefaultReasoningEffort({}, 'glm-5.3')).toBeUndefined()
  })

  it('非法档位（脏数据）返回 undefined，不回落成其它档位', () => {
    const dirty = { modelSettings: { m: { reasoningEffort: 'ultra' } } } as unknown as Parameters<
      typeof resolveModelDefaultReasoningEffort
    >[0]
    expect(resolveModelDefaultReasoningEffort(dirty, 'm')).toBeUndefined()
  })

  it('modelId 两侧空白被裁剪后仍能命中', () => {
    expect(resolveModelDefaultReasoningEffort(source, '  glm-5.3 ')).toBe('high')
  })
})

describe('isModelHiddenInPicker', () => {
  const source = {
    modelSettings: { m1: { hidden: true }, m2: { hidden: false }, m3: {} },
  } as unknown as Parameters<typeof isModelHiddenInPicker>[0]

  it('仅 hidden === true 视为隐藏', () => {
    expect(isModelHiddenInPicker(source, 'm1')).toBe(true)
    expect(isModelHiddenInPicker(source, 'm2')).toBe(false)
    expect(isModelHiddenInPicker(source, 'm3')).toBe(false)
    expect(isModelHiddenInPicker(source, 'unknown')).toBe(false)
    expect(isModelHiddenInPicker(source, '')).toBe(false)
    expect(isModelHiddenInPicker(null, 'm1')).toBe(false)
  })
})
