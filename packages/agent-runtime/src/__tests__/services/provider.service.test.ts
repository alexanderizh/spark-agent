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
    repo = makeRepo()
    service = new ProviderService(repo as never)
  })

  it('createProvider stores apiKey in keystore, not in returned profile', async () => {
    const profile = await service.createProvider({
      name: 'My Anthropic',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'sk-ant-secret',
    })

    expect(keystore.setSecret).toHaveBeenCalledOnce()
    expect(profile).not.toHaveProperty('apiKey')
    expect(profile.keystoreRef).toContain('anthropic-')
    expect(profile.name).toBe('My Anthropic')
    expect(profile.model).toBe('claude-opus-4-6')
  })

  it('createProvider stores custom apiEndpoint in config and returned profile', async () => {
    const profile = await service.createProvider({
      name: 'Local Ollama',
      provider: 'ollama',
      model: 'llama3.2',
      apiEndpoint: 'http://localhost:11434/v1',
      apiKey: 'ollama-local',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        model: 'llama3.2',
        apiEndpoint: 'http://localhost:11434/v1',
      },
    }))
    expect(profile.apiEndpoint).toBe('http://localhost:11434/v1')
  })

  it('deleteProvider removes from keystore and repo', async () => {
    // seed a row
    repo.rows.set('id-1', {
      id: 'id-1',
      provider_type: 'openai',
      name: 'Test',
      config_json: '{"model":"gpt-4"}',
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
      config_json: '{"model":"gpt-3.5"}',
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
      config_json: '{"model":"gpt-3.5"}',
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

  it('updateProvider merges apiEndpoint into existing config', async () => {
    repo.rows.set('id-5', {
      id: 'id-5',
      provider_type: 'openai-compatible',
      name: 'Compat',
      config_json: '{"model":"mixtral"}',
      enabled: 1,
      keystore_ref: 'compat-id-5',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-5', apiEndpoint: 'https://api.example.com/v1' })

    expect(repo.update).toHaveBeenCalledWith('id-5', {
      config: {
        model: 'mixtral',
        apiEndpoint: 'https://api.example.com/v1',
      },
    })
  })

  it('updateProvider clears apiEndpoint when null is passed', async () => {
    repo.rows.set('id-6', {
      id: 'id-6',
      provider_type: 'ollama',
      name: 'Ollama',
      config_json: '{"model":"llama3.2","apiEndpoint":"http://localhost:11434/v1"}',
      enabled: 1,
      keystore_ref: 'ollama-id-6',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-6', apiEndpoint: null })

    expect(repo.update).toHaveBeenCalledWith('id-6', {
      config: {
        model: 'llama3.2',
      },
    })
  })

  it('createProvider with isDefault calls setDefault', async () => {
    await service.createProvider({
      name: 'Default Provider',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
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
      config_json: '{"model":"claude-3"}',
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
  })
})
