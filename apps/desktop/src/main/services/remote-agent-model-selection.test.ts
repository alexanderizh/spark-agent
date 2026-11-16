import { describe, expect, it } from 'vitest'
import type { RemoteAgentModelCatalogResponse } from '@spark/protocol'
import {
  RemoteAgentModelSelectionError,
  resolveRemoteAgentModelSelection,
} from './remote-agent-model-selection.js'

const catalog: RemoteAgentModelCatalogResponse = {
  agents: [],
  providers: [
    {
      id: 'provider-a',
      name: 'Provider A',
      providerType: 'openai',
      isAutoRouter: false,
      models: [{ id: 'model-a', name: 'Model A' }],
    },
    {
      id: 'router',
      name: 'Router',
      providerType: 'auto-router',
      isAutoRouter: true,
      models: [],
    },
  ],
}

describe('resolveRemoteAgentModelSelection', () => {
  it('accepts a listed provider/model and provider default', () => {
    expect(
      resolveRemoteAgentModelSelection(
        { providerProfileId: 'provider-a', modelId: 'model-a' },
        catalog,
      ),
    ).toEqual({
      providerProfileId: 'provider-a',
      modelId: 'model-a',
    })
    expect(
      resolveRemoteAgentModelSelection({ providerProfileId: 'provider-a', modelId: null }, catalog),
    ).toEqual({
      providerProfileId: 'provider-a',
      modelId: null,
    })
  })

  it('accepts automatic routing only without a concrete model', () => {
    expect(
      resolveRemoteAgentModelSelection({ providerProfileId: 'router', modelId: null }, catalog),
    ).toEqual({
      providerProfileId: 'router',
      modelId: null,
    })
    expect(() =>
      resolveRemoteAgentModelSelection(
        { providerProfileId: 'router', modelId: 'model-a' },
        catalog,
      ),
    ).toThrow(RemoteAgentModelSelectionError)
  })

  it('rejects missing providers and models not listed under the selected provider', () => {
    expect(() =>
      resolveRemoteAgentModelSelection({ providerProfileId: 'missing', modelId: null }, catalog),
    ).toThrow(RemoteAgentModelSelectionError)
    expect(() =>
      resolveRemoteAgentModelSelection(
        { providerProfileId: 'provider-a', modelId: 'model-b' },
        catalog,
      ),
    ).toThrow(RemoteAgentModelSelectionError)
  })
})
