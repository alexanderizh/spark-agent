import type { ProviderProfileRow } from '@spark/storage'
import { describe, expect, it } from 'vitest'
import { buildComputerDecisionModelConfig } from './computer-decision-model.js'

const PROVIDER: ProviderProfileRow = {
  id: 'provider-1',
  provider_type: 'openai-compatible',
  name: 'Vision Provider',
  config_json: JSON.stringify({
    defaultModel: 'vision-default',
    apiEndpoint: 'https://example.test/v1',
    codexApiKind: 'responses',
    maxTokens: 8_192,
  }),
  enabled: 1,
  keystore_ref: 'provider-key',
  is_default: 1,
  created_at: '2026-07-28T00:00:00.000Z',
  updated_at: '2026-07-28T00:00:00.000Z',
}

describe('buildComputerDecisionModelConfig', () => {
  it('binds the current Agent provider and model to a vision JSON decision call', () => {
    expect(
      buildComputerDecisionModelConfig({
        provider: PROVIDER,
        model: 'vision-current',
        apiKey: 'secret',
      }),
    ).toEqual({
      providerProfileId: 'provider-1',
      providerType: 'openai-compatible',
      apiKind: 'responses',
      apiKey: 'secret',
      apiEndpoint: 'https://example.test/v1',
      model: 'vision-current',
      maxTokens: 8_192,
    })
  })

  it('rejects disabled, local CLI, keyless, and model-less providers', () => {
    for (const input of [
      { provider: { ...PROVIDER, enabled: 0 }, model: 'vision', apiKey: 'secret' },
      { provider: { ...PROVIDER, id: 'local-codex-cli' }, model: 'vision', apiKey: '' },
      { provider: PROVIDER, model: 'vision', apiKey: '' },
      { provider: PROVIDER, model: '', apiKey: 'secret' },
    ]) {
      expect(() => buildComputerDecisionModelConfig(input)).toThrow()
    }
  })
})
