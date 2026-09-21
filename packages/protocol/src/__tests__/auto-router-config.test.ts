import { describe, expect, it } from 'vitest'

import {
  AUTO_ROUTER_PROVIDER_TYPE,
  AutoRouterConfigSchema,
  LEGACY_CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  LEGACY_CODEX_AUTO_ROUTER_PROVIDER_ID,
  createDefaultAutoRouterConfig,
  findExecutorByIntensity,
  isAutoRouterProviderProfile,
  isConversationalProviderCandidate,
  isLegacyAutoRouterProviderId,
  isProviderAllowedForAutoRouter,
  parseAutoRouterConfig,
} from '../auto-router-config.js'

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'auto-router',
    adapter: 'claude',
    dispatcher: { providerProfileId: 'p1', modelId: 'm1' },
    executors: [
      { id: 'e1', providerProfileId: 'p1', modelId: 'm1', intensity: 'high' },
      { id: 'e2', providerProfileId: 'p2', modelId: 'm2', intensity: 'balanced' },
      { id: 'e3', providerProfileId: 'p3', modelId: 'm3', intensity: 'low', enabled: false },
    ],
    ...overrides,
  }
}

describe('AutoRouterConfigSchema', () => {
  it('合法配置通过并补全默认值', () => {
    const parsed = AutoRouterConfigSchema.parse(validConfig())
    expect(parsed.version).toBe(1)
    expect(parsed.dispatcher.timeoutMs).toBe(30_000)
    expect(parsed.fallbackIntensity).toBe('balanced')
    expect(parsed.allowDecomposition).toBe(true)
    expect(parsed.maxConcurrentSubtasks).toBe(3)
    expect(parsed.subagentIntensityMapping).toBe(true)
    expect(parsed.executors[2]?.enabled).toBe(false)
  })

  it('缺 dispatcher 或 executors 条目非法时报错', () => {
    expect(AutoRouterConfigSchema.safeParse({ kind: 'auto-router' }).success).toBe(false)
    expect(
      AutoRouterConfigSchema.safeParse(validConfig({ dispatcher: { providerProfileId: '', modelId: 'm' } }))
        .success,
    ).toBe(false)
    expect(
      AutoRouterConfigSchema.safeParse(
        validConfig({
          executors: [{ id: 'e1', providerProfileId: 'p1', modelId: 'm1', intensity: 'ultra' }],
        }),
      ).success,
    ).toBe(false)
  })

  it('决策超时支持到 120s 并拒绝超限值', () => {
    expect(
      AutoRouterConfigSchema.safeParse(
        validConfig({ dispatcher: { providerProfileId: 'p1', modelId: 'm1', timeoutMs: 120_000 } }),
      ).success,
    ).toBe(true)
    expect(
      AutoRouterConfigSchema.safeParse(
        validConfig({ dispatcher: { providerProfileId: 'p1', modelId: 'm1', timeoutMs: 120_001 } }),
      ).success,
    ).toBe(false)
  })

  it('kind 不是 auto-router 时拒绝（与其他 config 判别字段互斥）', () => {
    expect(AutoRouterConfigSchema.safeParse(validConfig({ kind: 'router' })).success).toBe(false)
  })

  it('执行器推理强度：显式值合法、非法值拒绝、缺省/存量数据兼容（向后兼容）', () => {
    // 显式配置通过并保留
    const withEffort = AutoRouterConfigSchema.parse(
      validConfig({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'p1',
            modelId: 'm1',
            intensity: 'high',
            reasoningEffort: 'xhigh',
          },
        ],
      }),
    )
    expect(withEffort.executors[0]?.reasoningEffort).toBe('xhigh')
    // null（UI「跟随会话」哨兵落库形态）也合法
    const withNull = AutoRouterConfigSchema.parse(
      validConfig({
        executors: [
          {
            id: 'e1',
            providerProfileId: 'p1',
            modelId: 'm1',
            intensity: 'high',
            reasoningEffort: null,
          },
        ],
      }),
    )
    expect(withNull.executors[0]?.reasoningEffort).toBeNull()
    // 非法值拒绝
    expect(
      AutoRouterConfigSchema.safeParse(
        validConfig({
          executors: [
            {
              id: 'e1',
              providerProfileId: 'p1',
              modelId: 'm1',
              intensity: 'high',
              reasoningEffort: 'ultra',
            },
          ],
        }),
      ).success,
    ).toBe(false)
    // 既有存量数据（无该字段）解析不受影响
    const legacy = AutoRouterConfigSchema.parse(validConfig())
    expect(legacy.executors[0]?.reasoningEffort).toBeUndefined()
  })
})

describe('parseAutoRouterConfig', () => {
  it('null / 非法 JSON / 结构不符都返回 null 而不抛异常', () => {
    expect(parseAutoRouterConfig(null)).toBeNull()
    expect(parseAutoRouterConfig('not-json')).toBeNull()
    expect(parseAutoRouterConfig({ kind: 'other' })).toBeNull()
    expect(parseAutoRouterConfig(validConfig())).not.toBeNull()
  })
})

describe('isAutoRouterProviderProfile', () => {
  it('按 providerType / provider_type 字段识别 router 行', () => {
    expect(isAutoRouterProviderProfile({ providerType: AUTO_ROUTER_PROVIDER_TYPE })).toBe(true)
    expect(isAutoRouterProviderProfile({ provider_type: AUTO_ROUTER_PROVIDER_TYPE })).toBe(true)
    expect(isAutoRouterProviderProfile({ providerType: 'anthropic' })).toBe(false)
    expect(isAutoRouterProviderProfile(null)).toBe(false)
  })
})

describe('isLegacyAutoRouterProviderId', () => {
  it('仅识别两个旧魔法 id', () => {
    expect(isLegacyAutoRouterProviderId(LEGACY_CLAUDE_AUTO_ROUTER_PROVIDER_ID)).toBe(true)
    expect(isLegacyAutoRouterProviderId(LEGACY_CODEX_AUTO_ROUTER_PROVIDER_ID)).toBe(true)
    expect(isLegacyAutoRouterProviderId(AUTO_ROUTER_PROVIDER_TYPE)).toBe(false)
    expect(isLegacyAutoRouterProviderId('anthropic')).toBe(false)
    expect(isLegacyAutoRouterProviderId(null)).toBe(false)
  })
})

describe('findExecutorByIntensity', () => {
  it('取该强度第一个启用条目，停用条目被跳过', () => {
    const config = AutoRouterConfigSchema.parse(validConfig())
    expect(findExecutorByIntensity(config, 'high')?.id).toBe('e1')
    expect(findExecutorByIntensity(config, 'low')).toBeNull()
    expect(findExecutorByIntensity(config, 'balanced')?.modelId).toBe('m2')
  })
})

describe('isProviderAllowedForAutoRouter / isConversationalProviderCandidate', () => {
  it('claude 引擎仅认 anthropic 渠道', () => {
    expect(isProviderAllowedForAutoRouter('claude', { provider: 'anthropic' })).toBe(true)
    expect(isProviderAllowedForAutoRouter('claude', { provider: 'openai' })).toBe(false)
  })

  it('codex 引擎认 openai 系渠道', () => {
    expect(isProviderAllowedForAutoRouter('codex', { provider: 'openai' })).toBe(true)
    expect(isProviderAllowedForAutoRouter('codex', { provider: 'openai-compatible' })).toBe(true)
    expect(isProviderAllowedForAutoRouter('codex', { provider: 'deepseek' })).toBe(true)
    expect(isProviderAllowedForAutoRouter('codex', { provider: 'ollama' })).toBe(true)
    expect(isProviderAllowedForAutoRouter('codex', { provider: 'anthropic' })).toBe(false)
  })

  it('多媒体 / 向量渠道一律排除（multimodal 理解型 LLM 除外）', () => {
    expect(isConversationalProviderCandidate({ provider: 'anthropic', modelType: 'image' })).toBe(false)
    expect(isConversationalProviderCandidate({ provider: 'anthropic', modelType: 'voice' })).toBe(false)
    expect(isConversationalProviderCandidate({ provider: 'anthropic', modelType: 'video' })).toBe(false)
    expect(
      isConversationalProviderCandidate({ provider: 'openai', codexApiKind: 'embedding' }),
    ).toBe(false)
    expect(isConversationalProviderCandidate({ provider: 'anthropic', mediaProvider: 'minimax' })).toBe(false)
    expect(
      isConversationalProviderCandidate({ provider: 'anthropic', mediaCapabilities: ['image.generate'] }),
    ).toBe(false)
    expect(
      isConversationalProviderCandidate({ provider: 'anthropic', modelType: 'multimodal' }),
    ).toBe(true)
  })
})

describe('createDefaultAutoRouterConfig', () => {
  it('生成可编辑的空配置骨架：未填分流器时校验不通过（保存拦截），填入后通过', () => {
    const config = createDefaultAutoRouterConfig('codex')
    expect(config.adapter).toBe('codex')
    expect(config.executors).toEqual([])
    // 管理页新建表单的初始态（dispatcher 未选）不应通过校验
    expect(AutoRouterConfigSchema.safeParse(config).success).toBe(false)
    expect(
      AutoRouterConfigSchema.safeParse({
        ...config,
        dispatcher: { providerProfileId: 'p1', modelId: 'm1' },
      }).success,
    ).toBe(true)
  })
})
