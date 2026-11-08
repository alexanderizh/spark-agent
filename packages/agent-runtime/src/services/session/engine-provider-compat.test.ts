import { describe, expect, it } from 'vitest'
import { assertEngineProviderCompatible } from './session-pure-utils.js'
import {
  isConversationalProviderRow,
  isEngineProviderCompatible,
  pickMemberProviderFallbackRow,
  resolveIncompatibleMemberInheritedProviderRow,
} from './member-provider-compat.js'
import type { ProviderProfileRow } from '@spark/storage'

function providerRow(overrides: Partial<ProviderProfileRow>): ProviderProfileRow {
  return {
    id: 'p-1',
    provider_type: 'openai',
    name: '测试渠道',
    config_json: '{}',
    enabled: 1,
    keystore_ref: null,
    is_default: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isEngineProviderCompatible', () => {
  it('codex 引擎只兼容 OpenAI 系协议渠道', () => {
    expect(
      isEngineProviderCompatible({ adapterKind: 'codex', providerType: 'anthropic' }),
    ).toBe(false)
    expect(isEngineProviderCompatible({ adapterKind: 'codex', providerType: 'openai' })).toBe(true)
  })

  it('claude / claude-sdk 引擎只兼容 Anthropic 协议渠道', () => {
    expect(
      isEngineProviderCompatible({ adapterKind: 'claude-sdk', providerType: 'anthropic' }),
    ).toBe(true)
    expect(
      isEngineProviderCompatible({ adapterKind: 'claude-sdk', providerType: 'openai' }),
    ).toBe(false)
    expect(isEngineProviderCompatible({ adapterKind: 'claude', providerType: 'openai' })).toBe(
      false,
    )
  })

  it('spark 引擎走 CLI 桥双协议，不受限', () => {
    expect(isEngineProviderCompatible({ adapterKind: 'spark', providerType: 'anthropic' })).toBe(
      true,
    )
    expect(isEngineProviderCompatible({ adapterKind: 'spark', providerType: 'openai' })).toBe(true)
  })
})

describe('assertEngineProviderCompatible', () => {
  it('兼容组合直接通过', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude-sdk',
        providerType: 'anthropic',
        providerName: '任意',
      }),
    ).not.toThrow()
  })

  it('不兼容组合抛错并携带团队模式自救指引', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude-sdk',
        providerType: 'openai',
        providerName: '代理官方 codex',
      }),
    ).toThrowError(/团队模式.*Agent 管理/)
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'codex',
        providerType: 'anthropic',
        providerName: '官方 Claude',
      }),
    ).toThrowError(/团队模式.*Agent 管理/)
  })
})

describe('isConversationalProviderRow', () => {
  it('排除多媒体生成渠道与向量渠道', () => {
    expect(isConversationalProviderRow(providerRow({ config_json: '{"modelType":"image"}' }))).toBe(
      false,
    )
    expect(isConversationalProviderRow(providerRow({ config_json: '{"modelType":"voice"}' }))).toBe(
      false,
    )
    expect(isConversationalProviderRow(providerRow({ config_json: '{"modelType":"video"}' }))).toBe(
      false,
    )
    expect(
      isConversationalProviderRow(providerRow({ config_json: '{"codexApiKind":"embedding"}' })),
    ).toBe(false)
  })

  it('保留文本/多模态理解渠道，脏 config 视为文本渠道', () => {
    expect(isConversationalProviderRow(providerRow({}))).toBe(true)
    expect(
      isConversationalProviderRow(providerRow({ config_json: '{"modelType":"multimodal"}' })),
    ).toBe(true)
    expect(
      isConversationalProviderRow(providerRow({ config_json: '{"modelType":"text"}' })),
    ).toBe(true)
    expect(isConversationalProviderRow(providerRow({ config_json: 'not-json' }))).toBe(true)
  })
})

describe('pickMemberProviderFallbackRow', () => {
  it('按成员引擎过滤协议，默认渠道优先', () => {
    const rows = [
      providerRow({ id: 'openai-1', provider_type: 'openai', is_default: 1 }),
      providerRow({ id: 'anth-1', provider_type: 'anthropic', is_default: 0 }),
    ]
    expect(pickMemberProviderFallbackRow(rows, 'codex')?.id).toBe('openai-1')
    expect(pickMemberProviderFallbackRow(rows, 'claude-sdk')?.id).toBe('anth-1')
  })

  it('无默认渠道时取首个兼容渠道', () => {
    const rows = [
      providerRow({ id: 'anth-1', provider_type: 'anthropic', is_default: 0 }),
      providerRow({ id: 'openai-1', provider_type: 'openai', is_default: 0 }),
    ]
    expect(pickMemberProviderFallbackRow(rows, 'codex')?.id).toBe('openai-1')
  })

  it('排除禁用、AutoRouter、多媒体与向量渠道', () => {
    const rows = [
      providerRow({ id: 'disabled', provider_type: 'openai', enabled: 0, is_default: 1 }),
      providerRow({ id: 'router', provider_type: 'auto-router', is_default: 1 }),
      providerRow({ id: 'media', provider_type: 'openai', config_json: '{"modelType":"image"}' }),
      providerRow({
        id: 'embed',
        provider_type: 'openai',
        config_json: '{"codexApiKind":"embedding"}',
      }),
      providerRow({ id: 'ok', provider_type: 'openai', is_default: 0 }),
    ]
    expect(pickMemberProviderFallbackRow(rows, 'codex')?.id).toBe('ok')
  })

  it('没有任何兼容渠道时返回 null', () => {
    const rows = [providerRow({ id: 'openai-1', provider_type: 'openai' })]
    expect(pickMemberProviderFallbackRow(rows, 'claude-sdk')).toBeNull()
    expect(pickMemberProviderFallbackRow([], 'codex')).toBeNull()
  })
})

describe('resolveIncompatibleMemberInheritedProviderRow', () => {
  it('returns the compatible fallback provider', () => {
    const inheritedProvider = providerRow({ id: 'anthropic', provider_type: 'anthropic' })
    const fallbackProvider = providerRow({ id: 'openai', provider_type: 'openai' })
    expect(
      resolveIncompatibleMemberInheritedProviderRow({
        inheritedProvider,
        rows: [inheritedProvider, fallbackProvider],
        adapterKind: 'codex',
        memberName: 'worker',
      }),
    ).toBe(fallbackProvider)
  })

  it('explains how to recover when no compatible provider exists', () => {
    const inheritedProvider = providerRow({ id: 'anthropic', provider_type: 'anthropic' })
    expect(() =>
      resolveIncompatibleMemberInheritedProviderRow({
        inheritedProvider,
        rows: [inheritedProvider],
        adapterKind: 'codex',
        memberName: 'worker',
      }),
    ).toThrowError(/worker.*继承的会话渠道.*没有可用的兼容渠道/)
  })
})
