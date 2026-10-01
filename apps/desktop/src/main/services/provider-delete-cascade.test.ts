import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from '@spark/protocol'

import {
  pickRebindFallbackProvider,
  resolveProviderRebindPlan,
  resolveRebindAdapter,
  resolveRebindModel,
} from './provider-delete-cascade.js'

function chatProvider(overrides: Partial<ProviderProfile> & { id: string }): ProviderProfile {
  return {
    name: overrides.id,
    provider: 'anthropic',
    providerType: 'anthropic',
    enabled: true,
    defaultModel: 'glm-5.3',
    modelIds: ['glm-5.3'],
    keystoreRef: '',
    isDefault: false,
    ...overrides,
  } as ProviderProfile
}

describe('pickRebindFallbackProvider', () => {
  it('默认位优先，其次第一个对话渠道', () => {
    const a = chatProvider({ id: 'a' })
    const b = chatProvider({ id: 'b', isDefault: true })
    expect(pickRebindFallbackProvider([a, b])?.id).toBe('b')
    expect(pickRebindFallbackProvider([a])?.id).toBe('a')
  })

  it('剔除多媒体/向量/禁用/auto-router 渠道，无对话渠道时返回 null', () => {
    const media = chatProvider({ id: 'img', modelType: 'image', isDefault: true })
    const embedding = chatProvider({ id: 'vec', codexApiKind: 'embedding' })
    const disabled = chatProvider({ id: 'off', enabled: false })
    const router = chatProvider({ id: 'router', providerType: 'auto-router', provider: 'auto-router' })
    expect(pickRebindFallbackProvider([media, embedding, disabled, router])).toBeNull()
    const chat = chatProvider({ id: 'chat' })
    expect(pickRebindFallbackProvider([media, embedding, chat])?.id).toBe('chat')
  })
})

describe('resolveRebindModel', () => {
  it('新渠道有同名模型则沿用，否则落渠道默认模型', () => {
    const fallback = chatProvider({ id: 'fb', defaultModel: 'glm-5.3', modelIds: ['glm-5.3', 'glm-5.3-flash'] })
    expect(resolveRebindModel('glm-5.3-flash', fallback)).toBe('glm-5.3-flash')
    expect(resolveRebindModel('deepseek-v4-flash', fallback)).toBe('glm-5.3')
    expect(resolveRebindModel(null, fallback)).toBe('glm-5.3')
  })
})

describe('resolveRebindAdapter', () => {
  it('引擎与重绑渠道协议不匹配时改落可用引擎', () => {
    const anthropicFallback = chatProvider({ id: 'fb-anthropic' })
    const openaiFallback = chatProvider({
      id: 'fb-openai',
      provider: 'openai',
      providerType: 'openai',
      codexApiKind: 'responses',
    })
    // codex 会话 → Anthropic 兜底渠道：改落 claude-sdk（否则下一轮撞引擎守卫）。
    expect(resolveRebindAdapter('codex', anthropicFallback)).toBe('claude-sdk')
    // claude 会话 → OpenAI 兜底渠道：改落 codex。
    expect(resolveRebindAdapter('claude-sdk', openaiFallback)).toBe('codex')
    expect(resolveRebindAdapter('claude', openaiFallback)).toBe('codex')
  })

  it('引擎兼容时返回 null（不动会话引擎与权限，归一化差异不算切换）', () => {
    const anthropicFallback = chatProvider({ id: 'fb-anthropic' })
    expect(resolveRebindAdapter('claude-sdk', anthropicFallback)).toBeNull()
    expect(resolveRebindAdapter('claude', anthropicFallback)).toBeNull()
    expect(resolveRebindAdapter('spark', anthropicFallback)).toBeNull()
    // 非法历史值按 claude-sdk 口径判定。
    expect(resolveRebindAdapter('legacy-junk', anthropicFallback)).toBeNull()
  })
})

describe('resolveProviderRebindPlan', () => {
  it('产出全部悬空会话的重绑计划（模型能沿用则沿用）', () => {
    const fallback = chatProvider({
      id: 'fb',
      defaultModel: 'glm-5.3',
      modelIds: ['glm-5.3', 'glm-5.3-flash'],
      isDefault: true,
    })
    const plan = resolveProviderRebindPlan({
      sessions: [
        { id: 's1', modelId: 'glm-5.3-flash', agentAdapter: 'claude-sdk' },
        { id: 's2', modelId: 'deleted-only-model', agentAdapter: 'claude-sdk' },
        { id: 's3', modelId: null, agentAdapter: 'claude-sdk' },
      ],
      providers: [fallback],
    })
    expect(plan.fallback?.id).toBe('fb')
    expect(plan.rebinds).toEqual([
      { sessionId: 's1', providerProfileId: 'fb', modelId: 'glm-5.3-flash' },
      { sessionId: 's2', providerProfileId: 'fb', modelId: 'glm-5.3' },
      { sessionId: 's3', providerProfileId: 'fb', modelId: 'glm-5.3' },
    ])
  })

  it('重绑兜底渠道与引擎协议冲突时，计划里带引擎校准', () => {
    const fallback = chatProvider({ id: 'fb', isDefault: true })
    const plan = resolveProviderRebindPlan({
      sessions: [{ id: 's1', modelId: 'm', agentAdapter: 'codex' }],
      providers: [fallback],
    })
    expect(plan.rebinds).toEqual([
      { sessionId: 's1', providerProfileId: 'fb', modelId: 'glm-5.3', agentAdapter: 'claude-sdk' },
    ])
  })

  it('无对话渠道或无悬空会话时返回空计划（保持原状，由 turn 报错引导）', () => {
    expect(
      resolveProviderRebindPlan({
        sessions: [],
        providers: [chatProvider({ id: 'a' })],
      }).rebinds,
    ).toEqual([])
    const empty = resolveProviderRebindPlan({
      sessions: [{ id: 's1', modelId: 'm', agentAdapter: 'codex' }],
      providers: [],
    })
    expect(empty.fallback).toBeNull()
    expect(empty.rebinds).toEqual([])
  })
})
