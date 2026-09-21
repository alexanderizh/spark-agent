import { describe, expect, it } from 'vitest'
import type { AutoRouterConfig, ProviderProfile } from '@spark/protocol'
import { createDefaultAutoRouterConfig } from '@spark/protocol'

import {
  buildAutoRouterHoverCardModel,
  formatAutoRouterTimeout,
} from './auto-router-hover-card-model'

function provider(id: string, name: string): ProviderProfile {
  return {
    id,
    name,
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  }
}

function config(patch: Partial<AutoRouterConfig> = {}): AutoRouterConfig {
  return {
    ...createDefaultAutoRouterConfig('claude'),
    dispatcher: {
      providerProfileId: 'dispatcher-provider',
      modelId: 'gpt-5-mini',
      timeoutMs: 8_000,
    },
    ...patch,
  }
}

const providers: ProviderProfile[] = [
  provider('dispatcher-provider', '分流渠道'),
  provider('p-high', '强模型渠道'),
  provider('p-balanced', '日常渠道'),
]

describe('formatAutoRouterTimeout', () => {
  it('renders seconds from 1s up, milliseconds below', () => {
    expect(formatAutoRouterTimeout(8000)).toBe('8s')
    expect(formatAutoRouterTimeout(8500)).toBe('8.5s')
    expect(formatAutoRouterTimeout(800)).toBe('800ms')
  })

  it('falls back to a placeholder for invalid values', () => {
    expect(formatAutoRouterTimeout(0)).toBe('未配置超时')
    expect(formatAutoRouterTimeout(Number.NaN)).toBe('未配置超时')
  })
})

describe('buildAutoRouterHoverCardModel', () => {
  it('reports a single error line when the config is invalid', () => {
    const model = buildAutoRouterHoverCardModel({ name: '默认路由', config: null, providers })
    expect(model.error).not.toBeNull()
    expect(model.rows).toEqual([])
    expect(model.footer).toBe('')
  })

  it('maps dispatcher row, three intensity rows and footer from the config', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '默认路由',
      config: config({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'p-high',
            modelId: 'claude-opus-4-6',
            intensity: 'high',
            enabled: true,
            reasoningEffort: 'xhigh',
          },
          {
            id: 'e2',
            providerProfileId: 'p-balanced',
            modelId: 'claude-sonnet-4-5',
            intensity: 'balanced',
            enabled: true,
          },
        ],
      }),
      providers,
    })

    expect(model.name).toBe('默认路由')
    expect(model.adapterLabel).toBe('Claude 引擎')
    expect(model.error).toBeNull()
    expect(model.rows.map((row) => row.label)).toEqual(['分流器', '高', '平衡', '低'])

    const [dispatcher, high, balanced, low] = model.rows
    expect(dispatcher?.modelLabel).toBe('gpt-5-mini')
    expect(dispatcher?.providerLabel).toBe('分流渠道')
    expect(dispatcher?.meta).toBe('8s')
    expect(dispatcher?.dotColor).toBeNull()

    expect(high?.modelLabel).toBe('claude-opus-4-6')
    expect(high?.providerLabel).toBe('强模型渠道')
    expect(high?.meta).toBe('推理 xhigh')
    expect(high?.isFallback).toBe(false)
    expect(high?.dotColor).not.toBeNull()

    expect(balanced?.modelLabel).toBe('claude-sonnet-4-5')
    expect(balanced?.meta).toBeNull()

    // 「低」档没有启用条目：走兜底强度（平衡）
    expect(low?.modelLabel).toBe('未配置')
    expect(low?.providerLabel).toBeNull()
    expect(low?.isFallback).toBe(true)
    expect(low?.meta).toBe('走兜底「平衡」')

    expect(model.footer).toBe('兜底 平衡 · 拆分 ≤3 · 子代理映射 开')
  })

  it('counts spare and disabled entries of the same intensity at the row tail', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '多条目路由',
      config: config({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'p-high',
            modelId: 'first',
            intensity: 'high',
            enabled: true,
          },
          {
            id: 'e2',
            providerProfileId: 'p-high',
            modelId: 'second',
            intensity: 'high',
            enabled: true,
          },
          {
            id: 'e3',
            providerProfileId: 'p-high',
            modelId: 'third',
            intensity: 'high',
            enabled: false,
          },
        ],
      }),
      providers,
    })

    const high = model.rows.find((row) => row.key === 'intensity:high')
    // 取第一个启用条目，其余按备用 / 停用计数
    expect(high?.modelLabel).toBe('first')
    expect(high?.meta).toBe('+1 备用 · +1 停用')
  })

  it('keeps the fallback hint accurate when no executor is enabled at all', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '空路由',
      config: config({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'p-high',
            modelId: 'first',
            intensity: 'high',
            enabled: false,
          },
        ],
      }),
      providers,
    })
    // 分流器行不受执行器影响，三个强度档位都走不到任何启用条目
    expect(model.rows.slice(1).every((row) => row.isFallback)).toBe(true)
    expect(model.rows.slice(1).every((row) => row.meta === '无启用执行模型')).toBe(true)
  })

  it('omits the provider label when the referenced channel is gone', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '路由',
      config: config({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'deleted-provider',
            modelId: 'claude-sonnet-4-5',
            intensity: 'balanced',
            enabled: true,
          },
        ],
      }),
      providers,
    })
    const balanced = model.rows.find((row) => row.key === 'intensity:balanced')
    expect(balanced?.modelLabel).toBe('claude-sonnet-4-5')
    expect(balanced?.providerLabel).toBeNull()
  })

  it('reflects decomposition and subagent mapping switches', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '路由',
      config: config({ allowDecomposition: false, subagentIntensityMapping: false }),
      providers,
    })
    expect(model.footer).toBe('兜底 平衡 · 不拆分 · 子代理映射 关')
  })

  it('labels the codex adapter', () => {
    const model = buildAutoRouterHoverCardModel({
      name: '路由',
      config: config({ adapter: 'codex' }),
      providers,
    })
    expect(model.adapterLabel).toBe('Codex 引擎')
  })
})
