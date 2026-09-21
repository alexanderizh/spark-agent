import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  getProviderAdapterKind,
  isProviderCompatibleWithAdapter,
} from './provider-adapter'

/**
 * AutoRouter 行的引擎推断（P7 回归）。
 *
 * router 行的 provider 字段是 'auto-router'（既不等于 'anthropic'），若不显式分支就会
 * 被判成 codex：会话侧「选中 provider 即校准引擎」的协调逻辑会把 claude 会话的
 * agentAdapter 改成 codex，运行时随即判 adapterMismatch，claude 档位执行器全部失配。
 */

function profile(partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>): ProviderProfile {
  return {
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    supportsMillionContext: false,
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...partial,
  } as ProviderProfile
}

function routerProfile(adapter: 'claude' | 'codex'): ProviderProfile {
  return profile({
    id: `router-${adapter}`,
    name: `路由-${adapter}`,
    provider: 'auto-router',
    providerType: 'auto-router',
    autoRouterConfig: {
      kind: 'auto-router',
      version: 1,
      adapter,
      dispatcher: { providerProfileId: 'p-dispatch', modelId: 'm', timeoutMs: 8_000 },
      executors: [],
      fallbackIntensity: 'balanced',
      allowDecomposition: true,
      maxConcurrentSubtasks: 3,
      subagentIntensityMapping: true,
    },
  })
}

describe('getProviderAdapterKind', () => {
  it('普通渠道按协议推断（anthropic → claude-sdk，其余 → codex）', () => {
    expect(getProviderAdapterKind(profile({ id: 'a', name: 'A' }))).toBe('claude-sdk')
    expect(
      getProviderAdapterKind(profile({ id: 'b', name: 'B', provider: 'openai' })),
    ).toBe('codex')
  })

  it('AutoRouter 行按声明 adapter 返回，绝不因 provider 字段判成 codex（P7 回归）', () => {
    expect(getProviderAdapterKind(routerProfile('claude'))).toBe('claude-sdk')
    expect(getProviderAdapterKind(routerProfile('codex'))).toBe('codex')
  })

  it('router 配置缺失（无效配置行）→ 保守回落 claude-sdk，与 agent-execution-config 口径一致', () => {
    const broken = profile({ id: 'broken', name: 'Broken', provider: 'auto-router', providerType: 'auto-router' })
    expect(getProviderAdapterKind(broken)).toBe('claude-sdk')
  })
})

describe('isProviderCompatibleWithAdapter', () => {
  it('claude 会话认 claude router，codex 会话认 codex router（防跨引擎无效组合）', () => {
    expect(isProviderCompatibleWithAdapter(routerProfile('claude'), 'claude-sdk')).toBe(true)
    expect(isProviderCompatibleWithAdapter(routerProfile('claude'), 'codex')).toBe(false)
    expect(isProviderCompatibleWithAdapter(routerProfile('codex'), 'codex')).toBe(true)
    expect(isProviderCompatibleWithAdapter(routerProfile('codex'), 'claude')).toBe(false)
  })

  it('router 配置缺失 → 一律不兼容（避免把无效行选进会话）', () => {
    const broken = profile({ id: 'broken', name: 'Broken', provider: 'auto-router', providerType: 'auto-router' })
    expect(isProviderCompatibleWithAdapter(broken, 'claude-sdk')).toBe(false)
  })
})
