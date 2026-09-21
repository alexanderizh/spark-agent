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

const anthropicChannel = profile({ id: 'ch-anthropic', name: 'Anthropic 渠道', provider: 'anthropic' })
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
  it('空会话（filterAdapter=null）：全部对话渠道与两种引擎的启用路由都可见，选中即校准引擎', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders, filterAdapter: null })
    expect(visibleIds(visibility.conversationalProviders)).toEqual([
      'ch-anthropic',
      'ch-openai-responses',
      'ch-openai-chat',
    ])
    expect(visibleIds(visibility.autoRouterProviders)).toEqual(['router-claude', 'router-codex'])
  })

  it('历史 claude 会话：anthropic 渠道 + claude 路由可见，openai 渠道与 codex 路由隐藏', () => {
    const visibility = resolveComposerModelVisibility({
      providers: allProviders,
      filterAdapter: 'claude-sdk',
    })
    expect(visibleIds(visibility.conversationalProviders)).toEqual(['ch-anthropic'])
    expect(visibleIds(visibility.autoRouterProviders)).toEqual(['router-claude'])
  })

  it('历史 codex 会话：openai 系渠道 + codex 路由可见，anthropic 渠道与 claude 路由隐藏', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders, filterAdapter: 'codex' })
    expect(visibleIds(visibility.conversationalProviders)).toEqual([
      'ch-openai-responses',
      'ch-openai-chat',
    ])
    expect(visibleIds(visibility.autoRouterProviders)).toEqual(['router-codex'])
  })

  it('历史 spark 会话：执行器可用渠道可见（chat-completions 除外），路由一律不可见', () => {
    const visibility = resolveComposerModelVisibility({ providers: allProviders, filterAdapter: 'spark' })
    expect(visibleIds(visibility.conversationalProviders)).toEqual([
      'ch-anthropic',
      'ch-openai-responses',
    ])
    expect(visibleIds(visibility.autoRouterProviders)).toEqual([])
  })

  it('绑定项无条件保留：spark 会话绑定的 claude 路由、claude 会话绑定的 openai 渠道均不被隐藏', () => {
    const sparkBoundRouter = resolveComposerModelVisibility({
      providers: allProviders,
      filterAdapter: 'spark',
      boundProviderId: 'router-claude',
    })
    expect(visibleIds(sparkBoundRouter.autoRouterProviders)).toEqual(['router-claude'])

    const claudeBoundOpenai = resolveComposerModelVisibility({
      providers: allProviders,
      filterAdapter: 'claude-sdk',
      boundProviderId: 'ch-openai-responses',
    })
    expect(visibleIds(claudeBoundOpenai.conversationalProviders)).toEqual([
      'ch-anthropic',
      'ch-openai-responses',
    ])
  })

  it('停用的路由在任何场景都不可见（含空会话与绑定保底）', () => {
    const draft = resolveComposerModelVisibility({ providers: allProviders, filterAdapter: null })
    expect(visibleIds(draft.autoRouterProviders)).not.toContain('router-disabled')

    const bound = resolveComposerModelVisibility({
      providers: allProviders,
      filterAdapter: 'claude-sdk',
      boundProviderId: 'router-disabled',
    })
    expect(visibleIds(bound.autoRouterProviders)).not.toContain('router-disabled')
  })
})
