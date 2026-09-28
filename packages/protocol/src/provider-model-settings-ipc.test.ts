import { describe, expect, it } from 'vitest'
import { IpcSchemaRegistry } from './schemas/index.js'

/**
 * 回归背景：main 进程的 typedIpcHandle 会用 IpcSchemaRegistry 的 zod schema
 * `parse(request)`，zod 对象默认**剥离**未声明字段。若新字段只加了 TS 类型而没加
 * schema，请求会带着字段出去、被静默剥掉，功能看起来「保存成功但没生效」。
 * 这里锁定 provider:update / provider:create 的字段声明。
 */
describe('provider IPC schema · 模型级设置', () => {
  const PROVIDER_ID = '11111111-1111-4111-8111-111111111111'

  const update = IpcSchemaRegistry['provider:update']
  const create = IpcSchemaRegistry['provider:create']

  it('provider:update 保留 modelSettings（推理默认/显隐/模型级上下文）', () => {
    const parsed = update.parse({
      id: '11111111-1111-4111-8111-111111111111',
      modelSettings: {
        'glm-5.3': { reasoningEffort: 'high', hidden: true, contextWindow: 400_000 },
        'glm-5.3-flash': { reasoningEffort: 'low' },
        'reset-model': {},
      },
    }) as { modelSettings?: Record<string, unknown> }
    expect(parsed.modelSettings).toEqual({
      'glm-5.3': { reasoningEffort: 'high', hidden: true, contextWindow: 400_000 },
      'glm-5.3-flash': { reasoningEffort: 'low' },
      'reset-model': {},
    })
  })

  it('provider:update 保留 modelContextWindows 与其它既有字段', () => {
    const parsed = update.parse({
      id: '11111111-1111-4111-8111-111111111111',
      enabled: false,
      modelContextWindows: { 'glm-5.3': 1_000_000 },
    }) as { enabled?: boolean; modelContextWindows?: Record<string, number> }
    expect(parsed.enabled).toBe(false)
    expect(parsed.modelContextWindows).toEqual({ 'glm-5.3': 1_000_000 })
  })

  it('provider:update 拒绝非法档位 / 越界窗口 / 未知子字段（strict）', () => {
    expect(() =>
      update.parse({ id: '11111111-1111-4111-8111-111111111111', modelSettings: { m: { reasoningEffort: 'ultra' } } }),
    ).toThrow()
    expect(() =>
      update.parse({ id: '11111111-1111-4111-8111-111111111111', modelSettings: { m: { contextWindow: 512 } } }),
    ).toThrow()
    expect(() =>
      update.parse({ id: '11111111-1111-4111-8111-111111111111', modelSettings: { m: { unexpected: true } } }),
    ).toThrow()
  })

  it('provider:create 同样保留 modelSettings', () => {
    const parsed = create.parse({
      name: '新建渠道',
      provider: 'openai',
      defaultModel: 'glm-5.3',
      modelIds: ['glm-5.3'],
      apiKey: 'sk-test',
      modelSettings: { 'glm-5.3': { reasoningEffort: 'medium', contextWindow: 400_000 } },
    }) as { modelSettings?: Record<string, unknown> }
    expect(parsed.modelSettings).toEqual({
      'glm-5.3': { reasoningEffort: 'medium', contextWindow: 400_000 },
    })
  })
})
