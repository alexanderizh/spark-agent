import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderService } from '../../services/provider.service.js'

// Mock keystore
vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  deleteSecret: vi.fn(),
  maskSecret: (s: string) => s.slice(0, 4) + '****',
}))

// Mock logger
vi.mock('@spark/shared', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))

import * as keystore from '@spark/shared/keystore'

function makeRepo() {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    create: vi.fn((params) => {
      const row = {
        id: params.id,
        provider_type: params.providerType,
        name: params.name,
        config_json: JSON.stringify(params.config),
        enabled: 1,
        keystore_ref: params.keystoreRef,
        is_default: params.isDefault ? 1 : 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      rows.set(params.id, row)
      return row
    }),
    get: vi.fn((id: string) => rows.get(id) ?? null),
    listAll: vi.fn(() => [...rows.values()]),
    update: vi.fn(),
    delete: vi.fn((id: string) => { rows.delete(id); return true }),
    setDefault: vi.fn(),
    findByProviderType: vi.fn(() => []),
    getDefault: vi.fn(() => null),
  }
}

describe('ProviderService', () => {
  let repo: ReturnType<typeof makeRepo>
  let service: ProviderService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    repo = makeRepo()
    service = new ProviderService(repo as never)
  })

  it('createProvider stores apiKey in keystore, not in returned profile', async () => {
    const profile = await service.createProvider({
      name: 'My Anthropic',
      provider: 'anthropic',
      defaultModel: 'claude-opus-4-6',
      modelIds: ['claude-opus-4-6', 'claude-sonnet-4-20250514'],
      apiKey: 'sk-ant-secret',
    })

    expect(keystore.setSecret).toHaveBeenCalledOnce()
    expect(profile).not.toHaveProperty('apiKey')
    expect(profile.keystoreRef).toContain('anthropic-')
    expect(profile.name).toBe('My Anthropic')
    expect(profile.defaultModel).toBe('claude-opus-4-6')
    expect(profile.modelIds).toEqual(['claude-opus-4-6', 'claude-sonnet-4-20250514'])
  })

  it('createProvider accepts legacy model field for backward compatibility', async () => {
    const profile = await service.createProvider({
      name: 'Legacy OpenAI',
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: 'sk-legacy',
    })

    expect(profile.provider).toBe('openai')
    expect(profile.defaultModel).toBe('gpt-4o-mini')
    expect(profile.modelIds).toEqual(['gpt-4o-mini'])
  })

  it('createProvider stores custom apiEndpoint in config and returned profile', async () => {
    const profile = await service.createProvider({
      name: 'OpenAI Compatible',
      provider: 'openai',
      defaultModel: 'gpt-4o-mini',
      modelIds: ['gpt-4o-mini', 'gpt-4.1'],
      apiEndpoint: 'https://api.example.com/v1',
      apiKey: 'sk-openai-local',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        defaultModel: 'gpt-4o-mini',
        modelIds: ['gpt-4o-mini', 'gpt-4.1'],
        apiEndpoint: 'https://api.example.com/v1',
      },
    }))
    expect(profile.apiEndpoint).toBe('https://api.example.com/v1')
  })

  it('deleteProvider removes from keystore and repo', async () => {
    // seed a row
    repo.rows.set('id-1', {
      id: 'id-1',
      provider_type: 'openai',
      name: 'Test',
      config_json: '{"defaultModel":"gpt-4","modelIds":["gpt-4"]}',
      enabled: 1,
      keystore_ref: 'openai-id-1',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.deleteProvider('id-1')

    expect(keystore.deleteSecret).toHaveBeenCalledWith('openai-id-1')
    expect(repo.delete).toHaveBeenCalledWith('id-1')
  })

  it('updateProvider with apiKey updates keystore', async () => {
    repo.rows.set('id-2', {
      id: 'id-2',
      provider_type: 'openai',
      name: 'Old',
      config_json: '{"defaultModel":"gpt-3.5","modelIds":["gpt-3.5"]}',
      enabled: 1,
      keystore_ref: 'openai-id-2',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-2', apiKey: 'new-key' })

    expect(keystore.setSecret).toHaveBeenCalledWith('openai-id-2', 'new-key')
  })

  it('updateProvider without apiKey does NOT call keystore', async () => {
    repo.rows.set('id-3', {
      id: 'id-3',
      provider_type: 'openai',
      name: 'Old',
      config_json: '{"defaultModel":"gpt-3.5","modelIds":["gpt-3.5"]}',
      enabled: 1,
      keystore_ref: 'openai-id-3',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-3', name: 'New Name' })

    expect(keystore.setSecret).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith('id-3', { name: 'New Name' })
  })

  it('updateProvider merges apiEndpoint and model IDs into existing config', async () => {
    repo.rows.set('id-5', {
      id: 'id-5',
      provider_type: 'openai',
      name: 'Compat',
      config_json: '{"defaultModel":"mixtral","modelIds":["mixtral"]}',
      enabled: 1,
      keystore_ref: 'compat-id-5',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({
      id: 'id-5',
      apiEndpoint: 'https://api.example.com/v1',
      defaultModel: 'gpt-4.1',
      modelIds: ['gpt-4.1', 'gpt-4o-mini'],
    })

    expect(repo.update).toHaveBeenCalledWith('id-5', {
      config: {
        defaultModel: 'gpt-4.1',
        modelIds: ['gpt-4.1', 'gpt-4o-mini'],
        apiEndpoint: 'https://api.example.com/v1',
      },
    })
  })

  it('updateProvider accepts legacy model field for backward compatibility', async () => {
    repo.rows.set('id-legacy', {
      id: 'id-legacy',
      provider_type: 'deepseek',
      name: 'Legacy',
      config_json: '{"defaultModel":"deepseek-chat","modelIds":["deepseek-chat"]}',
      enabled: 1,
      keystore_ref: 'legacy-id',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-legacy', model: 'deepseek-reasoner' })

    expect(repo.update).toHaveBeenCalledWith('id-legacy', {
      config: {
        defaultModel: 'deepseek-reasoner',
        modelIds: ['deepseek-reasoner', 'deepseek-chat'],
      },
    })
  })

  it('updateProvider clears apiEndpoint when null is passed', async () => {
    repo.rows.set('id-6', {
      id: 'id-6',
      provider_type: 'openai',
      name: 'Compat',
      config_json: '{"defaultModel":"gpt-4o","modelIds":["gpt-4o"],"apiEndpoint":"https://api.example.com/v1"}',
      enabled: 1,
      keystore_ref: 'openai-id-6',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-6', apiEndpoint: null })

    expect(repo.update).toHaveBeenCalledWith('id-6', {
      config: {
        defaultModel: 'gpt-4o',
        modelIds: ['gpt-4o'],
      },
    })
  })

  it('createProvider with isDefault calls setDefault', async () => {
    await service.createProvider({
      name: 'Default Provider',
      provider: 'anthropic',
      defaultModel: 'claude-opus-4-6',
      modelIds: ['claude-opus-4-6'],
      apiKey: 'sk-ant-key',
      isDefault: true,
    })

    expect(repo.setDefault).toHaveBeenCalledOnce()
  })

  it('listProviders returns profiles without apiKey', async () => {
    repo.rows.set('id-4', {
      id: 'id-4',
      provider_type: 'anthropic',
      name: 'Test',
      config_json: '{"defaultModel":"claude-3","modelIds":["claude-3","claude-3-haiku"]}',
      enabled: 1,
      keystore_ref: 'anthropic-id-4',
      is_default: 0,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    })

    const profiles = await service.listProviders()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).not.toHaveProperty('apiKey')
    expect(profiles[0]!.id).toBe('id-4')
    expect(profiles[0]!.defaultModel).toBe('claude-3')
    expect(profiles[0]!.modelIds).toEqual(['claude-3', 'claude-3-haiku'])
  })

  it('healthCheck validates Anthropic-compatible providers with a minimal messages request', async () => {
    repo.rows.set('id-anthropic-compatible', {
      id: 'id-anthropic-compatible',
      provider_type: 'anthropic',
      name: 'Tencent Coding Plan',
      config_json: '{"defaultModel":"glm-5","modelIds":["glm-5"],"apiEndpoint":"https://api.lkeap.cloud.tencent.com/coding/anthropic"}',
      enabled: 1,
      keystore_ref: 'anthropic-id-anthropic-compatible',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test' as never)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await service.healthCheck('id-anthropic-compatible')

    expect(result.healthy).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.lkeap.cloud.tencent.com/coding/anthropic/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-test',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'glm-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      }),
    )
  })
})
