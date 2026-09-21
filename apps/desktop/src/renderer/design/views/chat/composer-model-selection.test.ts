import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE, createDefaultAutoRouterConfig } from '@spark/protocol'
import {
  hasExecutableComposerModel,
  resolveComposerModelVisibility,
} from './composer-model-selection'

describe('hasExecutableComposerModel', () => {
  it('requires a model id for a normal provider', () => {
    expect(hasExecutableComposerModel({ providerType: 'anthropic' }, '')).toBe(false)
    expect(hasExecutableComposerModel({ providerType: 'anthropic' }, 'claude-sonnet')).toBe(true)
  })

  it('allows a configured Autorouter without a model id', () => {
    expect(
      hasExecutableComposerModel(
        {
          providerType: AUTO_ROUTER_PROVIDER_TYPE,
          autoRouterConfig: createDefaultAutoRouterConfig('claude'),
        },
        '',
      ),
    ).toBe(true)
  })

  it('rejects an invalid Autorouter without a route config', () => {
    expect(hasExecutableComposerModel({ providerType: AUTO_ROUTER_PROVIDER_TYPE }, '')).toBe(false)
  })
})

function profile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>,
): ProviderProfile {
  return {
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    ...partial,
  } as ProviderProfile
}

function routerProfile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>,
  adapter: 'claude' | 'codex' = 'claude',
): ProviderProfile {
  return profile({
    provider: 'auto-router',
    providerType: AUTO_ROUTER_PROVIDER_TYPE,
    autoRouterConfig: createDefaultAutoRouterConfig(adapter),
    ...partial,
  })
}

const anthropicChannel = profile({
  id: 'ch-anthropic',
  name: 'Anthropic 渠道',
  provider: 'anthropic',
})
const openaiResponsesChannel = profile({
  id: 'ch-openai-responses',
  name: 'OpenAI Responses 渠道',
  provider: 'openai',
  codexApiKind: 'responses',
})
const openaiChatChannel = profile({
  id: 'ch-openai-chat',
  name: 'OpenAI Chat 渠道',
  provider: 'openai',
  codexApiKind: 'chat',
})
const mediaChannel = profile({
  id: 'ch-media',
  name: '图片渠道',
  provider: 'openai',
  modelType: 'image',
})
const claudeRouter = routerProfile({ id: 'router-claude', name: 'Claude 路由' }, 'claude')
const codexRouter = routerProfile({ id: 'router-codex', name: 'Codex 路由' }, 'codex')
const disabledClaudeRouter = routerProfile(
  { id: 'router-disabled', name: '停用路由', enabled: false },
  'claude',
)
const allProviders = [
  anthropicChannel,
  openaiResponsesChannel,
  openaiChatChannel,
  mediaChannel,
  claudeRouter,
  codexRouter,
  disabledClaudeRouter,
]

function visibleIds(providers: ProviderProfile[]): string[] {
  return providers.map((provider) => provider.id)
}

describe('resolveComposerModelVisibility', () => {
  it('全部对话渠道与两种引擎的启用路由都可见（历史会话可跨引擎切换）', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders })
    expect(visibleIds(visibility.conversationalProviders)).toEqual([
      'ch-anthropic',
      'ch-openai-responses',
      'ch-openai-chat',
    ])
    expect(visibleIds(visibility.autoRouterProviders)).toEqual(['router-claude', 'router-codex'])
  })

  it('多媒体生成渠道被过滤，不进入对话渠道分组', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders })
    expect(visibleIds(visibility.conversationalProviders)).not.toContain('ch-media')
    expect(visibleIds(visibility.autoRouterProviders)).not.toContain('ch-media')
  })

  it('停用的路由不可见', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders })
    expect(visibleIds(visibility.autoRouterProviders)).not.toContain('router-disabled')
  })
})
