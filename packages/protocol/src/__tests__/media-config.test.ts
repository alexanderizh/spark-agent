import { describe, expect, it } from 'vitest'
import { mergeDynamicParamOptions, type MediaDynamicParamOption } from '../media-config.js'

/**
 * 渠道动态参数候选（如智谱音色目录）并入 manifest 参数 schema 的契约。
 *
 * 这里的 key 名是跨模块契约：`examples` 由 `schemaFields` 取为候选值，
 * `x-template-labels` 由 `schemaFields` 取为 `field.enumLabels`，再被画布参数控件
 * 与快速创作消费。改 key 名不会报错、只会让可读名静默消失，因此用测试锁住。
 */
describe('mergeDynamicParamOptions', () => {
  const voiceSchema = {
    type: 'object',
    properties: {
      voice: { type: 'string', examples: ['tongtong'], 'x-allow-custom': true, title: '音色' },
      speed: { type: 'number', minimum: 0.5, maximum: 2 },
    },
  }

  it('把候选写进 examples，用 x-template-labels 承载可读名', () => {
    const overrides: Record<string, MediaDynamicParamOption[]> = {
      voice: [
        { value: 'tongtong', label: '彤彤' },
        { value: 'voice_clone_1', label: '我的播客音色' },
      ],
    }
    const merged = mergeDynamicParamOptions(voiceSchema, overrides)
    const properties = merged.properties as Record<string, Record<string, unknown>>

    expect(properties.voice?.examples).toEqual(['tongtong', 'voice_clone_1'])
    expect(properties.voice?.['x-template-labels']).toEqual({
      tongtong: '彤彤',
      voice_clone_1: '我的播客音色',
    })
    // 未声明的参数不被新增
    expect(properties.cloned).toBeUndefined()
    // 原有字段保留
    expect(properties.voice?.title).toBe('音色')
    expect(properties.speed).toEqual({ type: 'number', minimum: 0.5, maximum: 2 })
  })

  it('label 与 value 相同（或缺失）时不写 label 表', () => {
    const merged = mergeDynamicParamOptions(voiceSchema, {
      voice: [{ value: 'jam' }, { value: 'kazi', label: 'kazi' }],
    })
    const properties = merged.properties as Record<string, Record<string, unknown>>
    expect(properties.voice?.examples).toEqual(['jam', 'kazi'])
    expect(properties.voice?.['x-template-labels']).toBeUndefined()
  })

  it('未同步、空候选或参数未声明时原样返回同一个引用', () => {
    expect(mergeDynamicParamOptions(voiceSchema, undefined)).toBe(voiceSchema)
    expect(mergeDynamicParamOptions(voiceSchema, { voice: [] })).toBe(voiceSchema)
    expect(mergeDynamicParamOptions(voiceSchema, { unknownParam: [{ value: 'x' }] })).toBe(
      voiceSchema,
    )
    expect(mergeDynamicParamOptions({ type: 'object' }, { voice: [{ value: 'x' }] })).toEqual({
      type: 'object',
    })
  })
})
