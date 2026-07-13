import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_PROVIDER_NAME,
  CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  CODEX_AUTO_ROUTER_PROVIDER_ID,
  createBasicCustomMediaManifest,
} from '@spark/protocol'
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
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Hoisted mock for node:util promisify — 让 isLocalCliAvailable 平台测试可控。
// 用 hoisted 可变 map，避免 vi.doMock + resetModules 的时序竞态（原 flaky 根因）。
const cliExecMock = vi.hoisted(() => ({
  /** 返回 true 表示该命令"存在"（--version 成功） */
  resolve: (_cmd: string): boolean => false,
}))
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>()
  return {
    ...actual,
    promisify: () => async (cmd: string) => {
      if (cliExecMock.resolve(cmd)) return { stdout: 'claude x.y.z\n', stderr: '' }
      const err = new Error(`ENOENT: ${cmd}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    },
  }
})

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
    update: vi.fn((id: string, patch: Record<string, unknown>) => {
      const current = rows.get(id)
      if (!current) return null
      const next = {
        ...current,
        ...(patch.providerType !== undefined && { provider_type: patch.providerType }),
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled ? 1 : 0 }),
        ...(patch.keystoreRef !== undefined && { keystore_ref: patch.keystoreRef }),
        ...(patch.config !== undefined && { config_json: JSON.stringify(patch.config) }),
      }
      rows.set(id, next)
      return next
    }),
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

    expect(profile.provider).toBe('openai-compatible')
    expect(profile.defaultModel).toBe('gpt-4o-mini')
    expect(profile.modelIds).toEqual(['gpt-4o-mini'])
  })

  it('preserves providerIcon through create, export, and import', async () => {
    const profile = await service.createProvider({
      name: 'Iconic Provider',
      provider: 'openai',
      defaultModel: 'gpt-5',
      modelIds: ['gpt-5'],
      providerIcon: { id: 'generic', style: 'mono' },
      apiKey: 'sk-iconic',
    })

    expect(profile.providerIcon).toEqual({ id: 'generic', style: 'mono' })

    const payload = await service.exportProviders([profile.id])
    expect(payload.profiles[0]?.providerIcon).toEqual({ id: 'generic', style: 'mono' })

    const importedRepo = makeRepo()
    const importedService = new ProviderService(importedRepo as never)
    const result = await importedService.importProviders(payload, 'merge')

    expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [] })
    expect(importedRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        providerIcon: { id: 'generic', style: 'mono' },
      }),
    }))
  })

  it('createProvider stores image provider routing fields', async () => {
    const profile = await service.createProvider({
      name: 'APIMart Images',
      provider: 'openai',
      defaultModel: 'gpt-image-2',
      modelIds: ['gpt-image-2'],
      apiEndpoint: 'https://api.apimart.ai/v1',
      apiKey: 'sk-image',
      modelType: 'image',
      imageProvider: 'apimart',
      imageApiType: 'async',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        defaultModel: 'gpt-image-2',
        modelIds: ['gpt-image-2'],
        apiEndpoint: 'https://api.apimart.ai/v1',
        modelType: 'image',
        imageProvider: 'apimart',
        imageApiType: 'async',
      }),
    }))
    expect(profile.modelType).toBe('image')
    expect(profile.imageProvider).toBe('apimart')
    expect(profile.imageApiType).toBe('async')
  })

  it('createProvider syncs image provider fields to media config', async () => {
    const profile = await service.createProvider({
      name: 'APIMart Images',
      provider: 'openai',
      defaultModel: 'gpt-image-2',
      modelIds: ['gpt-image-2'],
      apiEndpoint: 'https://api.apimart.ai/v1',
      apiKey: 'sk-image',
      modelType: 'image',
      imageProvider: 'apimart',
      imageApiType: 'async',
    })

    expect(profile.mediaProvider).toBe('apimart')
    expect(profile.mediaApiType).toBe('async')
    expect(profile.mediaCapabilities).toContain('image.generate')
  })

  it('createProvider stores APIMart video media config', async () => {
    const profile = await service.createProvider({
      name: 'APIMart VEO 3',
      provider: 'openai',
      defaultModel: 'veo3',
      modelIds: ['veo3'],
      apiEndpoint: 'https://api.apimart.ai/v1',
      apiKey: 'sk-video',
      modelType: 'video',
      mediaProvider: 'apimart',
      mediaApiType: 'async',
      mediaCapabilities: ['video.generate', 'video.image_to_video'],
      mediaDefaults: { video: { durationSeconds: 8 }, polling: { intervalMs: 6000 } },
    })

    expect(profile.modelType).toBe('video')
    expect(profile.mediaProvider).toBe('apimart')
    expect(profile.mediaApiType).toBe('async')
    expect(profile.mediaCapabilities).toEqual(['video.generate', 'video.image_to_video'])
    expect(profile.mediaDefaults?.video?.durationSeconds).toBe(8)
    expect(profile.mediaDefaults?.polling?.intervalMs).toBe(6000)
  })

  it('createProvider stores xAI voice media config without writing image-only fields', async () => {
    const profile = await service.createProvider({
      name: 'xAI TTS',
      provider: 'openai',
      defaultModel: 'grok-tts',
      modelIds: ['grok-tts'],
      apiEndpoint: 'https://api.x.ai/v1',
      apiKey: 'sk-voice',
      modelType: 'voice',
      mediaProvider: 'xai',
      mediaApiType: 'sync',
      mediaCapabilities: ['audio.speech'],
      mediaDefaults: { audio: { voice: 'alloy', format: 'mp3' } },
    })

    expect(profile.modelType).toBe('voice')
    expect(profile.mediaProvider).toBe('xai')
    expect(profile.mediaApiType).toBe('sync')
    expect(profile.mediaCapabilities).toEqual(['audio.speech'])
    expect(profile.mediaDefaults?.audio?.voice).toBe('alloy')
    // voice 模型不应写入 image-only 字段
    expect(profile.imageProvider).toBeUndefined()
    expect(profile.imageApiType).toBeUndefined()
  })

  it('updateProvider infers media config when switching modelType to image', async () => {
    repo.rows.set('id-image-switch', {
      id: 'id-image-switch',
      provider_type: 'openai',
      name: 'Switch',
      config_json: '{"defaultModel":"gpt-image-2","modelIds":["gpt-image-2"]}',
      enabled: 1,
      keystore_ref: 'openai-id-image-switch',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({
      id: 'id-image-switch',
      modelType: 'image',
      imageProvider: 'apimart',
      imageApiType: 'async',
    })

    expect(repo.update).toHaveBeenCalledWith('id-image-switch', expect.objectContaining({
      config: expect.objectContaining({
        modelType: 'image',
        imageProvider: 'apimart',
        mediaProvider: 'apimart',
        mediaApiType: 'async',
        mediaCapabilities: expect.arrayContaining(['image.generate']),
      }),
    }))
  })

  it('exportProviders roundtrips media config fields', async () => {
    await service.createProvider({
      name: 'APIMart Whisper',
      provider: 'openai',
      defaultModel: 'whisper-1',
      modelIds: ['whisper-1'],
      apiEndpoint: 'https://api.apimart.ai/v1',
      apiKey: 'sk-whisper',
      modelType: 'voice',
      mediaProvider: 'apimart',
      mediaApiType: 'sync',
      mediaCapabilities: ['audio.transcription'],
      mediaDefaults: { audio: { language: 'zh' } },
    })

    const payload = await service.exportProviders([])
    const profile = payload.profiles.find((item) => item.name === 'APIMart Whisper')
    expect(profile).toBeDefined()
    expect(profile!.mediaProvider).toBe('apimart')
    expect(profile!.mediaApiType).toBe('sync')
    expect(profile!.mediaCapabilities).toEqual(['audio.transcription'])
    expect(profile!.mediaDefaults?.audio?.language).toBe('zh')
  })

  it('preserves inline custom media manifests through create, list, and export', async () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-image-v1',
      modelType: 'image',
      mode: 'sync',
    })

    const profile = await service.createProvider({
      name: 'Studio Images',
      provider: 'openai',
      defaultModel: 'studio-image-v1',
      modelIds: ['studio-image-v1'],
      apiEndpoint: 'https://api.studio.example/v1',
      apiKey: 'sk-studio',
      modelType: 'image',
      mediaProvider: 'custom',
      mediaApiType: 'sync',
      mediaCapabilities: ['image.generate'],
      mediaModelRefs: [
        {
          manifestId: manifest.id,
          modelId: manifest.modelId,
          enabled: true,
          manifest,
        },
      ],
    })

    expect(profile.mediaModelRefs?.[0]?.manifest?.invocation.endpoint).toBe('/images/generations')

    const listed = await service.listProviders()
    expect(listed.find((item) => item.id === profile.id)?.mediaModelRefs?.[0]?.manifest?.id).toBe(manifest.id)

    const payload = await service.exportProviders([profile.id])
    expect(payload.profiles[0]?.mediaModelRefs?.[0]?.manifest?.capabilities[0]?.id).toBe('image.generate')
  })

  it('hides auto router providers when there are no routeable text model profiles', async () => {
    const listed = await service.listProviders()

    expect(listed.some((item) => item.id === CLAUDE_AUTO_ROUTER_PROVIDER_ID)).toBe(false)
    expect(listed.some((item) => item.id === CODEX_AUTO_ROUTER_PROVIDER_ID)).toBe(false)
  })

  it('shows only auto routers backed by routeable text providers', async () => {
    repo.rows.set('anthropic-text', {
      id: 'anthropic-text',
      provider_type: 'anthropic',
      name: 'Anthropic Text',
      config_json: JSON.stringify({
        defaultModel: 'claude-sonnet',
        modelIds: ['claude-sonnet'],
        modelType: 'text',
      }),
      enabled: 1,
      keystore_ref: 'anthropic-text-key',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })
    repo.rows.set('openai-image', {
      id: 'openai-image',
      provider_type: 'openai',
      name: 'OpenAI Image',
      config_json: JSON.stringify({
        defaultModel: 'gpt-image',
        modelIds: ['gpt-image'],
        modelType: 'image',
      }),
      enabled: 1,
      keystore_ref: 'openai-image-key',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    const listed = await service.listProviders()

    expect(listed.some((item) => item.id === CLAUDE_AUTO_ROUTER_PROVIDER_ID)).toBe(true)
    expect(listed.some((item) => item.id === CODEX_AUTO_ROUTER_PROVIDER_ID)).toBe(false)
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

  it('preserves openai-compatible provider kind for third-party Codex profiles', async () => {
    const profile = await service.createProvider({
      name: 'Third Party Codex',
      provider: 'openai-compatible',
      defaultModel: 'provider-coder',
      modelIds: ['provider-coder'],
      apiEndpoint: 'https://provider.example.com/v1',
      apiKey: 'sk-provider',
      codexApiKind: 'responses',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      providerType: 'openai-compatible',
      config: expect.objectContaining({
        codexApiKind: 'responses',
      }),
    }))
    expect(profile.provider).toBe('openai-compatible')

    const payload = await service.exportProviders([])
    expect(payload.profiles.find((item) => item.name === 'Third Party Codex')).toMatchObject({
      provider: 'openai-compatible',
      codexApiKind: 'responses',
      apiEndpoint: 'https://provider.example.com/v1',
    })
  })

  it('createProvider stores codexApiKind for OpenAI providers and returns it in profiles', async () => {
    const profile = await service.createProvider({
      name: 'OpenAI Codex',
      provider: 'openai',
      defaultModel: 'gpt-5-codex',
      modelIds: ['gpt-5-codex'],
      apiEndpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      codexApiKind: 'responses',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        defaultModel: 'gpt-5-codex',
        modelIds: ['gpt-5-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
      },
    }))
    expect(profile.codexApiKind).toBe('responses')
  })

  it('createProvider infers responses for Coding Plan OpenAI endpoints when codexApiKind is omitted', async () => {
    const profile = await service.createProvider({
      name: 'GLM Coding Plan',
      provider: 'openai',
      defaultModel: 'glm-5.2',
      modelIds: ['glm-5.2'],
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey: 'sk-glm',
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
        codexApiKind: 'responses',
      }),
    }))
    expect(profile.codexApiKind).toBe('responses')
  })

  it('createProvider stores provider-level 1M context support', async () => {
    const profile = await service.createProvider({
      name: 'Long Context',
      provider: 'openai',
      defaultModel: 'provider-default',
      apiKey: 'sk-openai',
      supportsMillionContext: true,
    })

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        defaultModel: 'provider-default',
        modelIds: ['provider-default'],
        supportsMillionContext: true,
      },
    }))
    expect(profile.supportsMillionContext).toBe(true)
  })

  it('updateProvider can disable provider-level 1M context support', async () => {
    repo.rows.set('id-long-context', {
      id: 'id-long-context',
      provider_type: 'openai',
      name: 'Long Context',
      config_json: '{"defaultModel":"provider-default","modelIds":["provider-default"],"supportsMillionContext":true}',
      enabled: 1,
      keystore_ref: 'openai-id-long-context',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-long-context', supportsMillionContext: false })

    expect(repo.update).toHaveBeenCalledWith('id-long-context', {
      config: {
        defaultModel: 'provider-default',
        modelIds: ['provider-default'],
        supportsMillionContext: false,
      },
    })
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

  it('getProviderApiKey returns the saved plaintext key for one editable provider', async () => {
    repo.rows.set('id-key-echo', {
      id: 'id-key-echo',
      provider_type: 'openai',
      name: 'Echo',
      config_json: '{"defaultModel":"gpt-5","modelIds":["gpt-5"]}',
      enabled: 1,
      keystore_ref: 'openai-id-key-echo',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })
    vi.mocked(keystore.getSecret).mockResolvedValueOnce('sk-plaintext-echo')

    await expect(service.getProviderApiKey('id-key-echo')).resolves.toBe('sk-plaintext-echo')
    expect(keystore.getSecret).toHaveBeenCalledWith('openai-id-key-echo')
  })

  it('getProviderApiKey returns an empty value when the provider has no credential ref', async () => {
    repo.rows.set('id-no-key', {
      id: 'id-no-key',
      provider_type: 'openai',
      name: 'No Key',
      config_json: '{"defaultModel":"gpt-5","modelIds":["gpt-5"]}',
      enabled: 1,
      keystore_ref: '',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await expect(service.getProviderApiKey('id-no-key')).resolves.toBe('')
    expect(keystore.getSecret).not.toHaveBeenCalled()
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

  it('updateProvider creates and persists a credential ref when adding a key to an old provider', async () => {
    repo.rows.set('id-key-added', {
      id: 'id-key-added',
      provider_type: 'openai',
      name: 'Pending Key',
      config_json: '{"defaultModel":"gpt-5","modelIds":["gpt-5"]}',
      enabled: 1,
      keystore_ref: '',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-key-added', apiKey: 'newly-added-key' })

    expect(keystore.setSecret).toHaveBeenCalledWith('openai-id-key-added', 'newly-added-key')
    expect(repo.update).toHaveBeenCalledWith('id-key-added', {
      keystoreRef: 'openai-id-key-added',
    })
    expect(repo.rows.get('id-key-added')?.keystore_ref).toBe('openai-id-key-added')
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

  it('updateProvider updates codexApiKind without changing model config', async () => {
    repo.rows.set('id-codex', {
      id: 'id-codex',
      provider_type: 'openai',
      name: 'OpenAI Codex',
      config_json: '{"defaultModel":"gpt-5-codex","modelIds":["gpt-5-codex"],"apiEndpoint":"https://api.openai.com/v1"}',
      enabled: 1,
      keystore_ref: 'openai-id-codex',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })

    await service.updateProvider({ id: 'id-codex', codexApiKind: 'responses' })

    expect(repo.update).toHaveBeenCalledWith('id-codex', {
      config: {
        defaultModel: 'gpt-5-codex',
        modelIds: ['gpt-5-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
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

    const realProfile = profiles.find((profile) => profile.id === 'id-4')
    const claudeRouter = profiles.find((profile) => profile.id === CLAUDE_AUTO_ROUTER_PROVIDER_ID)
    const codexRouter = profiles.find((profile) => profile.id === CODEX_AUTO_ROUTER_PROVIDER_ID)

    expect(realProfile).toBeDefined()
    expect(realProfile).not.toHaveProperty('apiKey')
    expect(realProfile!.defaultModel).toBe('claude-3')
    expect(realProfile!.modelIds).toEqual(['claude-3', 'claude-3-haiku'])
    expect(claudeRouter).toMatchObject({ id: CLAUDE_AUTO_ROUTER_PROVIDER_ID, provider: 'anthropic', keystoreRef: '' })
    expect(codexRouter).toBeUndefined()
  })

  it('normalizes the built-in local CLI provider model display config', async () => {
    repo.rows.set(LOCAL_CLI_PROVIDER_ID, {
      id: LOCAL_CLI_PROVIDER_ID,
      provider_type: 'anthropic',
      name: 'Local Claude CLI',
      config_json: '{"defaultModel":"claude-sonnet-4-5","modelIds":["claude-sonnet-4-5"]}',
      enabled: 1,
      keystore_ref: '',
      is_default: 0,
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
    })
    vi.spyOn(service, 'isLocalCliAvailable').mockResolvedValue(true)
    vi.spyOn(service, 'isLocalCodexCliAvailable').mockResolvedValue(false)

    const profiles = await service.listProviders()
    const ensured = await service.ensureLocalCliProvider()

    expect(profiles[0]).toMatchObject({
      id: LOCAL_CLI_PROVIDER_ID,
      name: LOCAL_CLI_PROVIDER_NAME,
      defaultModel: LOCAL_CLI_DEFAULT_MODEL,
      modelIds: [LOCAL_CLI_DEFAULT_MODEL],
    })
    expect(ensured.defaultModel).toBe(LOCAL_CLI_DEFAULT_MODEL)
    expect(repo.update).toHaveBeenCalledWith(LOCAL_CLI_PROVIDER_ID, {
      name: LOCAL_CLI_PROVIDER_NAME,
      config: expect.objectContaining({
        defaultModel: LOCAL_CLI_DEFAULT_MODEL,
        modelIds: [LOCAL_CLI_DEFAULT_MODEL],
      }),
    })
  })

  it('normalizes the built-in local Codex CLI provider model display config', async () => {
    repo.rows.set(LOCAL_CODEX_CLI_PROVIDER_ID, {
      id: LOCAL_CODEX_CLI_PROVIDER_ID,
      provider_type: 'openai',
      name: 'Local Codex CLI',
      config_json: '{"defaultModel":"gpt-5-codex","modelIds":["gpt-5-codex"]}',
      enabled: 1,
      keystore_ref: '',
      is_default: 0,
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
    })
    vi.spyOn(service, 'isLocalCliAvailable').mockResolvedValue(false)
    vi.spyOn(service, 'isLocalCodexCliAvailable').mockResolvedValue(true)

    const profiles = await service.listProviders()
    const ensured = await service.ensureLocalCodexCliProvider()

    expect(profiles[0]).toMatchObject({
      id: LOCAL_CODEX_CLI_PROVIDER_ID,
      name: LOCAL_CODEX_CLI_PROVIDER_NAME,
      provider: 'openai',
      defaultModel: LOCAL_CODEX_CLI_DEFAULT_MODEL,
      modelIds: [LOCAL_CODEX_CLI_DEFAULT_MODEL],
      codexApiKind: 'responses',
    })
    expect(ensured.defaultModel).toBe(LOCAL_CODEX_CLI_DEFAULT_MODEL)
    expect(repo.update).toHaveBeenCalledWith(LOCAL_CODEX_CLI_PROVIDER_ID, {
      name: LOCAL_CODEX_CLI_PROVIDER_NAME,
      config: expect.objectContaining({
        defaultModel: LOCAL_CODEX_CLI_DEFAULT_MODEL,
        modelIds: [LOCAL_CODEX_CLI_DEFAULT_MODEL],
        codexApiKind: 'responses',
      }),
    })
  })

  it('listProviders exposes stored codexApiKind', async () => {
    repo.rows.set('id-codex-profile', {
      id: 'id-codex-profile',
      provider_type: 'openai',
      name: 'Codex',
      config_json: '{"defaultModel":"gpt-5-codex","modelIds":["gpt-5-codex"],"codexApiKind":"responses"}',
      enabled: 1,
      keystore_ref: 'openai-id-codex-profile',
      is_default: 0,
      created_at: '2026-05-27',
      updated_at: '2026-05-27',
    })

    const profiles = await service.listProviders()

    expect(profiles[0]).toMatchObject({
      provider: 'openai',
      defaultModel: 'gpt-5-codex',
      codexApiKind: 'responses',
    })
  })

  it('listProviders infers responses for legacy Coding Plan OpenAI profiles without codexApiKind', async () => {
    repo.rows.set('id-legacy-coding-plan', {
      id: 'id-legacy-coding-plan',
      provider_type: 'openai',
      name: 'Legacy Coding Plan',
      config_json: '{"defaultModel":"glm-5.2","modelIds":["glm-5.2"],"apiEndpoint":"https://ark.cn-beijing.volces.com/api/coding"}',
      enabled: 1,
      keystore_ref: 'openai-id-legacy-coding-plan',
      is_default: 0,
      created_at: '2026-07-02',
      updated_at: '2026-07-02',
    })

    const profiles = await service.listProviders()

    expect(profiles[0]).toMatchObject({
      provider: 'openai',
      defaultModel: 'glm-5.2',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding',
      codexApiKind: 'responses',
    })
  })

  it('listProviders corrects legacy chat configs for Responses-only Coding Plan endpoints', async () => {
    repo.rows.set('id-legacy-chat-coding-plan', {
      id: 'id-legacy-chat-coding-plan',
      provider_type: 'openai',
      name: 'Legacy Chat Coding Plan',
      config_json: '{"defaultModel":"glm-5.2","modelIds":["glm-5.2"],"apiEndpoint":"https://open.bigmodel.cn/api/coding/paas/v4","codexApiKind":"chat"}',
      enabled: 1,
      keystore_ref: 'openai-id-legacy-chat-coding-plan',
      is_default: 0,
      created_at: '2026-07-02',
      updated_at: '2026-07-02',
    })

    const profiles = await service.listProviders()

    expect(profiles[0]).toMatchObject({
      provider: 'openai',
      defaultModel: 'glm-5.2',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      codexApiKind: 'responses',
    })
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

  it('testConnection validates OpenAI-compatible Chat Completions providers with the selected model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await service.testConnection({
      provider: 'openai-compatible',
      apiEndpoint: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      codexApiKind: 'chat',
      apiKey: 'sk-test',
    })

    expect(result.healthy).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      }),
    )
  })

  it('testConnection preserves versioned coding base URLs for Chat Completions providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await service.testConnection({
      provider: 'openai-compatible',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      defaultModel: 'glm-5.2',
      codexApiKind: 'chat',
      apiKey: 'sk-test',
    })

    expect(result.healthy).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions',
      expect.any(Object),
    )
  })

  it('testConnection validates OpenAI Responses providers with the selected model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await service.testConnection({
      provider: 'openai',
      apiEndpoint: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.5',
      codexApiKind: 'responses',
      apiKey: 'sk-test',
    })

    expect(result.healthy).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'gpt-5.5',
          input: 'ping',
          max_output_tokens: 1,
          stream: false,
        }),
      }),
    )
  })

  it('testConnection preserves versioned coding base URLs for Responses providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await service.testConnection({
      provider: 'openai',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      defaultModel: 'glm-5.2',
      codexApiKind: 'responses',
      apiKey: 'sk-test',
    })

    expect(result.healthy).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/coding/paas/v4/responses',
      expect.any(Object),
    )
  })

  it('fetchModels uses /models for versioned OpenAI-compatible base URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'glm-5.1', owned_by: 'zhipu' },
          { id: 'glm-5.2', owned_by: 'zhipu' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const models = await service.fetchModels({
      provider: 'openai',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey: 'sk-test',
    })

    expect(models).toEqual([
      { id: 'glm-5.1', ownedBy: 'zhipu' },
      { id: 'glm-5.2', ownedBy: 'zhipu' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-test' },
      }),
    )
  })

  it('fetchModels retries by stripping known Anthropic-compatible suffixes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'missing',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const models = await service.fetchModels({
      provider: 'openai-compatible',
      apiEndpoint: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-test',
    })

    expect(models).toEqual([{ id: 'deepseek-v4-flash', ownedBy: null }])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.deepseek.com/anthropic/v1/models',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.deepseek.com/v1/models',
      expect.any(Object),
    )
  })

  describe('isLocalCliAvailable platform behavior', () => {
    const realPlatform = process.platform

    function setPlatform(platform: string): void {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    }

    afterEach(() => {
      setPlatform(realPlatform)
      cliExecMock.resolve = () => false
      vi.resetModules()
    })

    it('windows: tries claude.cmd shim when bare claude is not in PATH', async () => {
      setPlatform('win32')
      // win32 下 tryCliVersion 走 execAsync(`${cmd} --version`)，命令是带参数的整串；
      // 用 includes 兼容 execFileAsync('claude.cmd') 和 execAsync('claude.cmd --version')
      cliExecMock.resolve = (cmd) => cmd.includes('claude.cmd')
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCliAvailable()

      expect(available).toBe(true)
    })

    it('windows: returns false when no claude shim variant is resolvable', async () => {
      setPlatform('win32')
      cliExecMock.resolve = () => false
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCliAvailable()

      expect(available).toBe(false)
    })

    it('unix: tries bare claude only', async () => {
      setPlatform('darwin')
      const seen: string[] = []
      cliExecMock.resolve = (cmd) => {
        seen.push(cmd)
        return cmd === 'claude'
      }
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCliAvailable()

      expect(available).toBe(true)
      expect(seen).toContain('claude')
      expect(seen).not.toContain('claude.cmd')
    })

    it('coalesces concurrent claude CLI availability checks and reuses the cached result', async () => {
      setPlatform('darwin')
      const seen: string[] = []
      cliExecMock.resolve = (cmd) => {
        seen.push(cmd)
        return cmd === 'claude'
      }
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      await expect(Promise.all([
        fresh.isLocalCliAvailable(),
        fresh.isLocalCliAvailable(),
      ])).resolves.toEqual([true, true])
      await expect(fresh.isLocalCliAvailable()).resolves.toBe(true)

      expect(seen.filter((cmd) => cmd === 'claude')).toHaveLength(1)
    })

    it('force refresh bypasses the cached CLI availability result', async () => {
      setPlatform('win32')
      cliExecMock.resolve = (cmd) => cmd.includes('claude.cmd')
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      await expect(fresh.isLocalCliAvailable()).resolves.toBe(true)
      cliExecMock.resolve = () => false
      await expect(fresh.isLocalCliAvailable()).resolves.toBe(true)
      await expect(fresh.isLocalCliAvailable({ forceRefresh: true })).resolves.toBe(false)
    })

    it('unix: falls back to login shell when bare claude and which both miss', async () => {
      // 复现最常见的现场：用户把 claude 装在 nvm/Volta/Hoembrew 等用户级目录，
      // 这些目录不在 GUI 进程的 PATH 里，所以 'claude' 和 `which claude` 都失败。
      // 新增的 login shell 兜底（/bin/zsh -lc 'command -v claude'）能解析到，
      // 之后还会对解析到的路径再跑一次 --version 验证。
      setPlatform('darwin')
      const seen: string[] = []
      cliExecMock.resolve = (cmd) => {
        seen.push(cmd)
        // bare 'claude' 失败（PATH 没这个命令）
        // 'which' 失败（which claude 找不到）
        // '/bin/zsh' 是 login shell 调用 → mock promisify 返回固定 stdout 'claude x.y.z\n'
        //   resolveCliFromLoginShell 取第一行 → 'claude x.y.z' 作为 loginResolved
        // 然后 tryCliVersion(loginResolved) 再次调用 execFile → cmd='claude x.y.z' → 验证通过
        if (cmd === 'claude') return false
        if (cmd === 'which') return false
        if (cmd === '/bin/zsh' || cmd === '/bin/bash') return true
        if (cmd === 'claude x.y.z') return true
        return false
      }
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCliAvailable()

      expect(available).toBe(true)
      // 验证确实走到了 login shell 分支
      expect(seen).toContain('/bin/zsh')
    })

    it('unix: returns false when all detection paths miss', async () => {
      setPlatform('darwin')
      cliExecMock.resolve = () => false
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCliAvailable()

      expect(available).toBe(false)
    })

    it('unix: codex CLI detection mirrors claude detection', async () => {
      setPlatform('darwin')
      const seen: string[] = []
      cliExecMock.resolve = (cmd) => {
        seen.push(cmd)
        if (cmd === 'codex') return false
        if (cmd === 'which') return false
        if (cmd === '/bin/zsh' || cmd === '/bin/bash') return true
        if (cmd === 'claude x.y.z') return true // mock promisify 固定返回这个
        return false
      }
      vi.resetModules()
      const { ProviderService: FreshProviderService } = await import('../../services/provider.service.js')
      const fresh = new FreshProviderService(repo as never)

      const available = await fresh.isLocalCodexCliAvailable()

      expect(available).toBe(true)
      expect(seen).toContain('/bin/zsh')
    })
  })

  it('creates an official managed provider without making it the default', async () => {
    const profile = await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5', 'deepseek-v4'],
      apiKey: 'sk-platform-secret',
    })

    expect(profile).toMatchObject({
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      apiEndpoint: 'https://newapi.example',
      managed: true,
      managedType: 'newapi',
      managedOwnerUserId: '42',
      isDefault: false,
    })
    expect(keystore.setSecret).toHaveBeenCalledWith(
      'newapi-spark-user-42-api-key',
      'sk-platform-secret',
    )
  })

  it('hides the managed platform provider after logout disables its credentials', async () => {
    await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5'],
      apiKey: 'sk-platform-secret',
    })

    expect((await service.listProviders()).map(profile => profile.id)).toContain('spark-platform-newapi')

    await service.disableManagedNewApiProvider('42')

    expect((await service.listProviders()).map(profile => profile.id)).not.toContain('spark-platform-newapi')
  })

  it('migrates an existing official provider from codex-chat to anthropic claude-sdk semantics', async () => {
    repo.rows.set('spark-platform-newapi', {
      id: 'spark-platform-newapi',
      provider_type: 'openai',
      name: 'Spark 平台官方模型',
      config_json: JSON.stringify({
        defaultModel: 'glm-4.5',
        modelIds: ['glm-4.5'],
        availableModelIds: ['glm-4.5'],
        apiEndpoint: 'https://newapi.example/v1',
        codexApiKind: 'chat',
        modelType: 'text',
        managed: true,
        managedType: 'newapi',
        managedOwnerUserId: '42',
        credentialState: 'ready',
      }),
      enabled: 1,
      keystore_ref: 'newapi-spark-user-42-api-key',
      is_default: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const profile = await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-4.5', 'deepseek-v4'],
      apiKey: 'sk-platform-secret',
    })

    expect(profile.provider).toBe('anthropic')
    expect(profile.name).toBe('Spark 平台模型')
    expect(profile.apiEndpoint).toBe('https://newapi.example')
    expect(profile).not.toHaveProperty('codexApiKind')
    expect(repo.update).toHaveBeenCalledWith('spark-platform-newapi', expect.objectContaining({
      providerType: 'anthropic',
      config: expect.objectContaining({ apiEndpoint: 'https://newapi.example' }),
    }))
  })

  it('preserves local managed model preferences when the platform model list refreshes', async () => {
    await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5', 'deepseek-v4', 'MiniMax-M3'],
      apiKey: 'sk-platform-secret',
    })
    await service.updateManagedNewApiModelPreferences({
      modelIds: ['deepseek-v4', 'MiniMax-M3'],
      defaultModel: 'MiniMax-M3',
    })

    const refreshed = await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5', 'deepseek-v4', 'MiniMax-M3', 'qwen3.6-plus'],
      apiKey: 'sk-platform-secret',
    })

    expect(refreshed.modelIds).toEqual(['MiniMax-M3', 'deepseek-v4'])
    expect(refreshed.defaultModel).toBe('MiniMax-M3')
    expect(refreshed.availableModelIds).toEqual([
      'glm-5',
      'deepseek-v4',
      'MiniMax-M3',
      'qwen3.6-plus',
    ])
  })

  it('requires at least one platform model to stay enabled', async () => {
    await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5'],
      apiKey: 'sk-platform-secret',
    })

    await expect(service.updateManagedNewApiModelPreferences({
      modelIds: [],
      defaultModel: '',
    })).rejects.toThrow('至少启用一个')
  })

  it('blocks editing and deleting an official managed provider', async () => {
    await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5'],
      apiKey: 'sk-platform-secret',
    })

    await expect(service.updateProvider({ id: 'spark-platform-newapi', name: 'hijacked' }))
      .rejects.toThrow('不能手动编辑')
    await expect(service.getProviderApiKey('spark-platform-newapi')).rejects.toThrow('不能读取凭据')
    await expect(service.deleteProvider('spark-platform-newapi')).rejects.toThrow('不能删除')
  })

  it('checks an official provider credential without consuming model quota', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-platform-secret')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await service.ensureManagedNewApiProvider({
      ownerUserId: '42',
      baseUrl: 'https://newapi.example',
      modelIds: ['glm-5'],
      apiKey: 'sk-platform-secret',
    })

    await expect(service.healthCheck('spark-platform-newapi')).resolves.toEqual({
      healthy: true,
      latencyMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
