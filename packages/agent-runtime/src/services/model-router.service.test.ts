import { describe, expect, it } from 'vitest'
import { ModelRouterService } from './model-router.service.js'
import type { RoutingModelConfig } from '@spark/protocol'

const providers = [
  { id: 'anthropic-cheap', provider: 'anthropic', defaultModel: 'claude-haiku', modelIds: ['claude-haiku'], modelType: 'text' },
  { id: 'anthropic-main', provider: 'anthropic', defaultModel: 'claude-sonnet', modelIds: ['claude-sonnet'], modelType: 'text' },
  { id: 'anthropic-strong', provider: 'anthropic', defaultModel: 'claude-opus', modelIds: ['claude-opus'], modelType: 'text' },
  { id: 'openai-cheap', provider: 'openai', defaultModel: 'gpt-mini', modelIds: ['gpt-mini'], modelType: 'text' },
  { id: 'compatible-main', provider: 'openai-compatible', defaultModel: 'qwen-coder', modelIds: ['qwen-coder'], modelType: 'text' },
  { id: 'compatible-strong', provider: 'openai-compatible', defaultModel: 'strong-coder', modelIds: ['strong-coder'], modelType: 'text' },
  { id: 'compatible-media', provider: 'openai-compatible', defaultModel: 'image-model', modelIds: ['image-model'], modelType: 'image' },
] as const

describe('ModelRouterService', () => {
  const service = new ModelRouterService()

  it('routes simple requests to the simple candidate', () => {
    const result = service.resolve({
      config: codexRouter(),
      providers,
      message: '帮我改一下错别字',
      estimatedTokens: 200,
    })

    expect(result).toMatchObject({
      providerProfileId: 'openai-cheap',
      modelId: 'gpt-mini',
      adapter: 'codex',
      matchedComplexity: 'simple',
      fallbackUsed: false,
      reasonCode: 'simple_task',
    })
  })

  it('routes code and multi-step requests to the complex candidate', () => {
    const result = service.resolve({
      config: codexRouter(),
      providers,
      message: '请实现这个功能，修改多个文件并补测试',
      estimatedTokens: 1000,
    })

    expect(result).toMatchObject({
      providerProfileId: 'compatible-strong',
      modelId: 'strong-coder',
      matchedComplexity: 'complex',
      reasonCode: 'complex_task',
    })
  })

  it('routes long context turns to the longContext candidate', () => {
    const result = service.resolve({
      config: {
        ...codexRouter(),
        candidates: {
          ...codexRouter().candidates,
          longContext: { providerProfileId: 'compatible-main', modelId: 'qwen-coder' },
        },
      },
      providers,
      message: '总结这段长上下文',
      estimatedTokens: 180_000,
    })

    expect(result).toMatchObject({
      providerProfileId: 'compatible-main',
      modelId: 'qwen-coder',
      matchedComplexity: 'longContext',
      reasonCode: 'long_context',
    })
  })

  it('falls back to the default candidate when the matched slot is missing', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {
          default: { providerProfileId: 'compatible-main', modelId: 'qwen-coder' },
        },
      },
      providers,
      message: '请实现这个功能，修改多个文件并补测试',
      estimatedTokens: 1000,
    })

    expect(result).toMatchObject({
      providerProfileId: 'compatible-main',
      modelId: 'qwen-coder',
      matchedComplexity: 'complex',
      fallbackUsed: true,
      reasonCode: 'complex_task',
    })
  })

  it('builds default candidates from same-format providers when a router card has no configured candidates', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {},
      },
      providers,
      message: '帮我解释一下',
      estimatedTokens: 100,
    })

    expect(result).toMatchObject({
      providerProfileId: 'openai-cheap',
      modelId: 'gpt-mini',
      adapter: 'codex',
      fallbackUsed: true,
      reasonCode: 'simple_task',
    })
  })

  it('does not use media providers when building default router candidates', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {},
      },
      providers: [providers[6], providers[4]],
      message: 'hello',
      estimatedTokens: 100,
    })

    expect(result.providerProfileId).toBe('compatible-main')
    expect(result.modelId).toBe('qwen-coder')
  })

  it('does not use built-in local CLI providers when building default router candidates', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {},
      },
      providers: [
        { id: 'local-codex-cli', provider: 'openai', defaultModel: 'codex cli', modelIds: ['codex cli'], modelType: 'text' },
        providers[4],
      ],
      message: 'hello',
      estimatedTokens: 100,
    })

    expect(result.providerProfileId).toBe('compatible-main')
    expect(result.modelId).toBe('qwen-coder')
  })

  it('uses the next valid candidate in a slot when earlier candidates are unavailable', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {
          default: [
            { providerProfileId: 'missing-provider', modelId: 'missing-model' },
            { providerProfileId: 'compatible-main', modelId: 'qwen-coder' },
          ],
        },
      },
      providers,
      message: '请解释一下这个问题',
      estimatedTokens: 1000,
    })

    expect(result).toMatchObject({
      providerProfileId: 'compatible-main',
      modelId: 'qwen-coder',
      matchedComplexity: 'simple',
      fallbackUsed: true,
    })
  })

  it('keeps Claude routers on Anthropic providers', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'claude',
        candidates: {
          default: { providerProfileId: 'compatible-main', modelId: 'qwen-coder' },
          complex: { providerProfileId: 'anthropic-strong', modelId: 'claude-opus' },
        },
      },
      providers,
      message: '请做一次深入代码审查',
      estimatedTokens: 1000,
    })

    expect(result).toMatchObject({
      providerProfileId: 'anthropic-strong',
      modelId: 'claude-opus',
      adapter: 'claude',
    })
  })

  it('rejects media candidates for Codex text routers', () => {
    const result = service.resolve({
      config: {
        kind: 'router',
        adapter: 'codex',
        candidates: {
          default: { providerProfileId: 'compatible-media', modelId: 'image-model' },
          simple: { providerProfileId: 'openai-cheap', modelId: 'gpt-mini' },
        },
      },
      providers,
      message: '普通问题',
      estimatedTokens: 100,
    })

    expect(result.providerProfileId).toBe('openai-cheap')
    expect(result.reasonCode).toBe('simple_task')
  })

  it('resolves a selected routing model card id to a concrete provider and model', () => {
    const result = service.resolveModelSelection({
      selectedModelId: 'router-codex',
      modelProfiles: [
        {
          id: 'router-codex',
          provider_id: 'codex-auto-router',
          name: 'Auto Codex',
          enabled: 1,
          config_json: JSON.stringify(codexRouter()),
          created_at: '',
          updated_at: '',
        },
      ],
      providers,
      message: '请实现这个功能并补测试',
      estimatedTokens: 1000,
    })

    expect(result).toMatchObject({
      routingModelProfileId: 'router-codex',
      providerProfileId: 'compatible-strong',
      modelId: 'strong-coder',
      adapter: 'codex',
      matchedComplexity: 'complex',
    })
  })

  it('returns null when the selected model id is not a routing model card', () => {
    const result = service.resolveModelSelection({
      selectedModelId: 'qwen-coder',
      modelProfiles: [
        {
          id: 'router-codex',
          provider_id: 'codex-auto-router',
          name: 'Auto Codex',
          enabled: 1,
          config_json: JSON.stringify(codexRouter()),
          created_at: '',
          updated_at: '',
        },
      ],
      providers,
      message: 'hello',
      estimatedTokens: 100,
    })

    expect(result).toBeNull()
  })
})

function codexRouter(): RoutingModelConfig {
  return {
    kind: 'router',
    adapter: 'codex',
    candidates: {
      simple: { providerProfileId: 'openai-cheap', modelId: 'gpt-mini' },
      default: { providerProfileId: 'compatible-main', modelId: 'qwen-coder' },
      complex: { providerProfileId: 'compatible-strong', modelId: 'strong-coder' },
    },
  }
}
