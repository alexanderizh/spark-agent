import { describe, expect, it } from 'vitest'
import { AUTO_ROUTER_PROVIDER_TYPE, createDefaultAutoRouterConfig } from '@spark/protocol'
import { hasExecutableComposerModel } from './composer-model-selection'

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
