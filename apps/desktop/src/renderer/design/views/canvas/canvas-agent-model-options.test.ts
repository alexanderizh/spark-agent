import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  CANVAS_AUTO_ROUTER_MODEL_LABEL,
  buildCanvasAgentModelOptions,
  resolveCanvasAgentModelSelection,
} from './canvas-agent-model-options'

function profile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'provider' | 'name'>,
): ProviderProfile {
  return {
    defaultModel: '',
    modelIds: [],
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...partial,
  }
}

describe('canvas agent model options', () => {
  const claudeProvider = profile({
    id: 'anthropic-provider',
    provider: 'anthropic',
    name: 'Claude SDK',
    defaultModel: 'claude-sonnet-4-5',
    modelIds: ['claude-sonnet-4-5'],
  })
  const codexProvider = profile({
    id: 'openai-provider',
    provider: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5', 'gpt-5-mini'],
  })
  const imageProvider = profile({
    id: 'image-provider',
    provider: 'openai-compatible',
    name: 'Image Provider',
    defaultModel: 'image-1',
    modelIds: ['image-1'],
    modelType: 'image',
  })
  const voiceProvider = profile({
    id: 'voice-provider',
    provider: 'openai-compatible',
    name: 'Voice Provider',
    defaultModel: 'voice-1',
    modelIds: ['voice-1'],
    modelType: 'voice',
  })
  const videoProvider = profile({
    id: 'video-provider',
    provider: 'openai-compatible',
    name: 'Video Provider',
    defaultModel: 'video-1',
    modelIds: ['video-1'],
    modelType: 'video',
  })
  // 重构后的 AutoRouter 行：provider_type='auto-router'，modelIds 恒空（执行模型由分流器逐轮决定）
  const autoRouterProvider = profile({
    id: 'router-1',
    provider: 'auto-router',
    providerType: 'auto-router',
    name: 'Claude Auto Router',
    defaultModel: '',
    modelIds: [],
    autoRouterConfig: {
      kind: 'auto-router',
      version: 1,
      adapter: 'claude',
      dispatcher: { providerProfileId: 'p-dispatch', modelId: 'dispatch-mini', timeoutMs: 8_000 },
      executors: [],
      fallbackIntensity: 'balanced',
      allowDecomposition: true,
      maxConcurrentSubtasks: 3,
      subagentIntensityMapping: true,
    },
  })

  it('builds one provider/model list that carries the hidden adapter per option', () => {
    const groups = buildCanvasAgentModelOptions([claudeProvider, codexProvider])

    expect(groups).toEqual([
      {
        provider: claudeProvider,
        adapter: 'claude-sdk',
        models: [{ modelId: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' }],
      },
      {
        provider: codexProvider,
        adapter: 'codex',
        models: [
          { modelId: 'gpt-5', label: 'gpt-5' },
          { modelId: 'gpt-5-mini', label: 'gpt-5-mini' },
        ],
      },
    ])
  })

  it('only exposes conversation providers in the canvas agent model selector', () => {
    const groups = buildCanvasAgentModelOptions([
      claudeProvider,
      imageProvider,
      voiceProvider,
      videoProvider,
      codexProvider,
    ])

    expect(groups.map((group) => group.provider.id)).toEqual([
      'anthropic-provider',
      'openai-provider',
    ])
  })

  it('exposes AutoRouter as a selectable group with a single explanatory entry', () => {
    // Phase 4 入口闭环回归：router 行 modelIds 恒空，若被 models.length>0 过滤掉，
    // 画布 agent 就根本选不到 router。
    const groups = buildCanvasAgentModelOptions([claudeProvider, autoRouterProvider])

    const routerGroup = groups.find((group) => group.provider.id === 'router-1')
    expect(routerGroup).toBeDefined()
    expect(routerGroup?.adapter).toBe('claude-sdk')
    expect(routerGroup?.models).toEqual([
      { modelId: '', label: CANVAS_AUTO_ROUTER_MODEL_LABEL },
    ])
  })

  it('resolves router selection to an empty model id (dispatcher decides per turn)', () => {
    const selection = resolveCanvasAgentModelSelection({
      providers: [claudeProvider, autoRouterProvider],
      providerId: 'router-1',
      // 存量节点可能带着旧模型 id 过来，选中 router 后必须被清空
      modelId: 'claude-sonnet-4-5',
      fallbackAdapter: 'codex',
    })

    expect(selection.providerId).toBe('router-1')
    expect(selection.modelId).toBe('')
    expect(selection.adapter).toBe('claude-sdk')
  })

  it('resolves provider, model, and adapter from a single model selection', () => {
    const selection = resolveCanvasAgentModelSelection({
      providers: [claudeProvider, codexProvider],
      providerId: 'openai-provider',
      modelId: 'gpt-5-mini',
      fallbackAdapter: 'claude-sdk',
    })

    expect(selection).toEqual({
      provider: codexProvider,
      providerId: 'openai-provider',
      modelId: 'gpt-5-mini',
      adapter: 'codex',
    })
  })
})
