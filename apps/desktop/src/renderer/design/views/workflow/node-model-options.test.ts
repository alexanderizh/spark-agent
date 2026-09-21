import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  buildAgentBindingPatch,
  buildProviderModelIndex,
  buildProviderPatch,
  buildReasoningEffortPatch,
  collectModelIds,
  nodeReasoningEffortDescription,
  nodeReasoningEffortLabel,
  normalizeNodeReasoningEffort,
  providerModelIds,
  rawNodeReasoningEffort,
  resolveNodeModelSelectState,
  resolveNodeProviderId,
  shouldResetModelForProvider,
} from './node-model-options'

function provider(id: string, defaultModel: string, modelIds: string[] = []): ProviderProfile {
  return {
    id,
    name: id,
    provider: 'anthropic',
    defaultModel,
    modelIds,
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  }
}

const providers = [
  provider('provider-a', 'a-default', ['a-default', 'a-fast', 'a-strong']),
  provider('provider-b', 'b-default', ['b-mini']),
]
const agents = [
  { id: 'agent-a', providerProfileId: 'provider-a' },
  { id: 'agent-b', providerProfileId: 'provider-b' },
  { id: 'agent-no-provider', providerProfileId: null },
]
const index = buildProviderModelIndex(providers)
const allModelIds = collectModelIds(index)

describe('workflow node provider/model linkage', () => {
  it('keeps the default model in the channel model list and de-duplicates it', () => {
    expect(providerModelIds(provider('p', 'm1', ['m1', 'm2', 'm2', '']))).toEqual(['m1', 'm2'])
  })

  it('collects every channel model once for the unknown-provider fallback', () => {
    expect(allModelIds).toEqual(['a-default', 'a-fast', 'a-strong', 'b-default', 'b-mini'])
  })

  it('resolves the effective provider from config first, then the bound agent', () => {
    expect(resolveNodeProviderId('provider-a', 'provider-b')).toBe('provider-a')
    expect(resolveNodeProviderId(null, 'provider-b')).toBe('provider-b')
    expect(resolveNodeProviderId('', null)).toBe('')
    expect(resolveNodeProviderId(undefined, undefined)).toBe('')
  })

  it('narrows model candidates to the selected channel', () => {
    const state = resolveNodeModelSelectState({
      providerModelIndex: index,
      allModelIds,
      configProviderProfileId: 'provider-b',
      boundAgentProviderId: null,
      currentModelId: 'b-mini',
    })

    expect(state.scope).toBe('provider')
    expect(state.providerId).toBe('provider-b')
    expect(state.modelIds).toEqual(['b-default', 'b-mini'])
    expect(state.staleModelId).toBeNull()
  })

  it('narrows to the bound agent channel when the node inherits the provider', () => {
    const state = resolveNodeModelSelectState({
      providerModelIndex: index,
      allModelIds,
      configProviderProfileId: null,
      boundAgentProviderId: 'provider-b',
      currentModelId: 'b-mini',
    })

    expect(state.scope).toBe('provider')
    expect(state.providerId).toBe('provider-b')
    expect(state.modelIds).toEqual(['b-default', 'b-mini'])
  })

  it('falls back to every channel model when the provider is unknown', () => {
    const state = resolveNodeModelSelectState({
      providerModelIndex: index,
      allModelIds,
      configProviderProfileId: null,
      boundAgentProviderId: null,
      currentModelId: 'a-fast',
    })

    expect(state.scope).toBe('all')
    expect(state.providerId).toBe('')
    expect(state.modelIds).toEqual(allModelIds)
    // 渠道未知时不做臆测：已保存模型保持可选，不标记为异常。
    expect(state.staleModelId).toBeNull()
  })

  it('falls back to every channel model when the saved provider no longer exists', () => {
    const state = resolveNodeModelSelectState({
      providerModelIndex: index,
      allModelIds,
      configProviderProfileId: 'removed-provider',
      boundAgentProviderId: null,
      currentModelId: 'a-fast',
    })

    expect(state.scope).toBe('all')
    expect(state.modelIds).toEqual(allModelIds)
    expect(state.staleModelId).toBeNull()
  })

  it('flags a saved model that does not belong to the selected channel', () => {
    const state = resolveNodeModelSelectState({
      providerModelIndex: index,
      allModelIds,
      configProviderProfileId: 'provider-b',
      boundAgentProviderId: null,
      currentModelId: 'a-fast',
    })

    expect(state.modelIds).toEqual(['b-default', 'b-mini'])
    expect(state.staleModelId).toBe('a-fast')
  })

  it('flags the saved model when the selected channel has no models at all', () => {
    const emptyIndex = buildProviderModelIndex([provider('provider-empty', '', [])])
    const state = resolveNodeModelSelectState({
      providerModelIndex: emptyIndex,
      allModelIds: collectModelIds(emptyIndex),
      configProviderProfileId: 'provider-empty',
      boundAgentProviderId: null,
      currentModelId: 'a-fast',
    })

    expect(state.scope).toBe('provider')
    expect(state.modelIds).toEqual([])
    expect(state.staleModelId).toBe('a-fast')
  })

  it('resets the model only when the next channel cannot serve it', () => {
    expect(
      shouldResetModelForProvider({
        providerModelIndex: index,
        nextProviderId: 'provider-b',
        currentModelId: 'a-fast',
      }),
    ).toBe(true)
    expect(
      shouldResetModelForProvider({
        providerModelIndex: index,
        nextProviderId: 'provider-a',
        currentModelId: 'a-fast',
      }),
    ).toBe(false)
    // 继承渠道 / 渠道未知 / 未选模型：保留原值，不猜测。
    expect(
      shouldResetModelForProvider({
        providerModelIndex: index,
        nextProviderId: '',
        currentModelId: 'a-fast',
      }),
    ).toBe(false)
    expect(
      shouldResetModelForProvider({
        providerModelIndex: index,
        nextProviderId: 'removed-provider',
        currentModelId: 'a-fast',
      }),
    ).toBe(false)
    expect(
      shouldResetModelForProvider({
        providerModelIndex: index,
        nextProviderId: 'provider-b',
        currentModelId: null,
      }),
    ).toBe(false)
  })

  it('builds a provider patch that clears an incompatible model', () => {
    expect(
      buildProviderPatch({
        providerModelIndex: index,
        configModelId: 'a-fast',
        nextProviderId: 'provider-b',
      }),
    ).toEqual({ providerProfileId: 'provider-b', modelId: null })

    expect(
      buildProviderPatch({
        providerModelIndex: index,
        configModelId: 'a-fast',
        nextProviderId: 'provider-a',
      }),
    ).toEqual({ providerProfileId: 'provider-a' })

    // 选回「继承 Agent」不清空模型：渠道交回 Agent，无法判定归属。
    expect(
      buildProviderPatch({
        providerModelIndex: index,
        configModelId: 'a-fast',
        nextProviderId: '',
      }),
    ).toEqual({ providerProfileId: null })
  })

  it('re-checks the model when the inherited agent binding changes', () => {
    const base = { agents, providerModelIndex: index, configProviderProfileId: null }

    // 新 Agent 的渠道装不下原模型：清空，回落继承。
    expect(
      buildAgentBindingPatch({ ...base, configModelId: 'a-fast', nextAgentId: 'agent-b' }),
    ).toEqual({ agentId: 'agent-b', modelId: null })

    // 新 Agent 的渠道能承接原模型：保持不动。
    expect(
      buildAgentBindingPatch({ ...base, configModelId: 'b-mini', nextAgentId: 'agent-b' }),
    ).toEqual({ agentId: 'agent-b' })

    // 节点已显式固定渠道：换 Agent 不改渠道，模型不动。
    expect(
      buildAgentBindingPatch({
        ...base,
        configProviderProfileId: 'provider-a',
        configModelId: 'a-fast',
        nextAgentId: 'agent-b',
      }),
    ).toEqual({ agentId: 'agent-b' })

    // 新 Agent 未配置渠道（渠道未知）/ 解绑 Agent（回落宿主）：不做臆测，保留模型。
    expect(
      buildAgentBindingPatch({
        ...base,
        configModelId: 'a-fast',
        nextAgentId: 'agent-no-provider',
      }),
    ).toEqual({ agentId: 'agent-no-provider' })
    expect(buildAgentBindingPatch({ ...base, configModelId: 'a-fast', nextAgentId: '' })).toEqual({
      agentId: null,
    })
  })
})

describe('workflow node reasoning effort', () => {
  it('normalizes the saved effort: enum passes through, empty/unknown become null (inherit)', () => {
    for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(normalizeNodeReasoningEffort(effort)).toBe(effort)
    }
    expect(normalizeNodeReasoningEffort('')).toBeNull()
    expect(normalizeNodeReasoningEffort(undefined)).toBeNull()
    expect(normalizeNodeReasoningEffort('ultra')).toBeNull()
  })

  it('keeps the raw string so callers can tell unset apart from an invalid legacy value', () => {
    expect(rawNodeReasoningEffort(undefined)).toBe('')
    expect(rawNodeReasoningEffort(null)).toBe('')
    expect(rawNodeReasoningEffort('  xhigh ')).toBe('xhigh')
    expect(rawNodeReasoningEffort('ultra')).toBe('ultra')
  })

  it('builds an undefined patch for inherit — null would fail the strict config schema', () => {
    const patch = buildReasoningEffortPatch('')
    expect(patch).toEqual({ reasoningEffort: undefined })
    expect('reasoningEffort' in patch).toBe(true)
    // 经 IPC/DB 的 JSON 序列化后 key 消失，等价于「未配置」。
    expect(JSON.parse(JSON.stringify(patch))).toEqual({})
  })

  it('builds a value patch for a chosen level and drops unknown input to inherit', () => {
    expect(buildReasoningEffortPatch('xhigh')).toEqual({ reasoningEffort: 'xhigh' })
    expect(buildReasoningEffortPatch('ultra')).toEqual({ reasoningEffort: undefined })
  })

  it('exposes the shared label/description copy for every level', () => {
    expect(nodeReasoningEffortLabel('medium')).toBe('平衡')
    expect(nodeReasoningEffortLabel('max')).toBe('Max')
    expect(nodeReasoningEffortDescription('minimal')).toContain('最低推理强度')
  })
})
