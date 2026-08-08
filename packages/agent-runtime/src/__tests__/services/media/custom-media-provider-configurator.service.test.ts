import { describe, expect, it, vi } from 'vitest'
import {
  createBasicCustomMediaManifest,
  type MediaModelManifest,
  type ProviderProfile,
} from '@spark/protocol'
import {
  CustomMediaProviderConfiguratorService,
  type CustomMediaProviderDraftInput,
  type CustomMediaProviderStore,
} from '../../../services/media/custom-media-provider-configurator.service.js'

const SECRET = 'sk-test-secret-never-return'

describe('CustomMediaProviderConfiguratorService', () => {
  it('returns a channel-unique starter manifest and an evidence-first workflow', () => {
    const service = new CustomMediaProviderConfiguratorService(store())
    const guide = service.createGuide({
      modelId: 'same-model-name',
      domain: 'video',
      mode: 'async_polling',
    })

    expect(guide.workflow).toEqual(expect.arrayContaining([expect.stringContaining('fetch_url')]))
    expect((guide.starterManifest as MediaModelManifest).id).toMatch(
      /^custom:same-model-name:[a-z0-9-]{8,}$/,
    )
  })

  it('validates and previews a manifest without exposing the placeholder credential', async () => {
    const service = new CustomMediaProviderConfiguratorService(store())
    const result = await service.validate(draft())

    expect(result.valid).toBe(true)
    expect(result.summary).toMatchObject({ modelCount: 1, capabilityCount: 2 })
    expect(result.previews).toHaveLength(2)
    expect(result.previews[0]?.headers.authorization).toBe('[REDACTED]')
  })

  it('rejects deterministic manifest ids and duplicate model ids on create', async () => {
    const invalid = manifest('same-model')
    invalid.id = 'custom:same-model'
    const second = manifest('same-model')
    const service = new CustomMediaProviderConfiguratorService(store())

    const result = await service.validate({
      ...draft(),
      models: [
        { modelId: 'same-model', manifest: invalid },
        { modelId: 'same-model', manifest: second },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['manifest_id_not_channel_unique', 'duplicate_model_id']),
    )
  })

  it('requires a provider name, official documentation and a matching enabled default model', async () => {
    const invalidManifest = manifest('different-model')
    invalidManifest.docs.sourceUrls = []
    const service = new CustomMediaProviderConfiguratorService(store())

    const result = await service.validate({
      ...draft(),
      name: ' ',
      models: [{ modelId: 'same-model', enabled: false, manifest: invalidManifest }],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'provider_name_required',
        'manifest_model_id_mismatch',
        'documentation_evidence_missing',
        'default_model_disabled',
      ]),
    )
  })

  it('rejects a manifest id already owned by another provider', async () => {
    const conflictingManifest = manifest('same-model')
    const service = new CustomMediaProviderConfiguratorService(
      store({
        listProviders: vi.fn(async () => [
          profile({
            id: 'other-provider',
            mediaModelRefs: [
              {
                manifestId: conflictingManifest.id,
                modelId: 'other-model',
                enabled: true,
                adapterMode: 'template',
                manifest: { ...conflictingManifest, modelId: 'other-model' },
              },
            ],
          }),
        ]),
      }),
    )

    const result = await service.validate({
      ...draft(),
      models: [{ modelId: 'same-model', manifest: conflictingManifest }],
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'manifest_id_conflicts_with_provider',
          severity: 'error',
        }),
      ]),
    )
  })

  it('creates through ProviderService-compatible persistence with media fields and Keychain input', async () => {
    const createProvider = vi.fn(async (params: Record<string, unknown>) =>
      profile({
        name: String(params.name),
        defaultModel: String(params.defaultModel),
        modelIds: params.modelIds as string[],
        apiEndpoint: String(params.apiEndpoint),
        keystoreRef: 'spark-provider-keychain-ref',
        mediaCapabilities: params.mediaCapabilities as NonNullable<
          ProviderProfile['mediaCapabilities']
        >,
        mediaModelRefs: params.mediaModelRefs as NonNullable<ProviderProfile['mediaModelRefs']>,
      }),
    )
    const service = new CustomMediaProviderConfiguratorService(store({ createProvider }))

    const result = await service.configure({ ...draft(), apiKey: SECRET })

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiKey: SECRET,
        mediaProvider: 'custom',
        mediaApiType: 'auto',
        imageProvider: 'custom',
        modelIds: ['same-model'],
        mediaCapabilities: ['image.generate', 'image.edit'],
      }),
    )
    expect(result.created).toBe(true)
    expect(result.provider.hasApiKey).toBe(true)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('discovers /models through the production ProviderService path', async () => {
    const fetchModels = vi.fn(async () => [
      { id: 'image-a', name: 'Image A' },
      { id: 'video-b', name: 'Video B' },
    ])
    const service = new CustomMediaProviderConfiguratorService(store({ fetchModels }))

    const result = await service.discoverModels({
      apiEndpoint: 'https://channel.example/v1',
      apiKey: SECRET,
      modelsUrl: '/models',
    })

    expect(result.count).toBe(2)
    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiEndpoint: 'https://channel.example/v1',
        apiKey: SECRET,
        modelsUrl: '/models',
      }),
    )
  })

  it('preserves the existing provider protocol when updating without an override', async () => {
    const updateProvider = vi.fn(async () => profile({ provider: 'anthropic' }))
    const service = new CustomMediaProviderConfiguratorService(
      store({
        listProviders: vi.fn(async () => [profile({ provider: 'anthropic' })]),
        updateProvider,
      }),
    )
    const updateDraft = draft()
    delete updateDraft.name

    await service.configure({
      ...updateDraft,
      providerId: 'provider-custom',
    })

    expect(updateProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-custom', provider: 'anthropic' }),
    )
  })

  it('requires explicit consent before a real paid diagnostic request', async () => {
    const invoke = vi.fn()
    const service = new CustomMediaProviderConfiguratorService(
      store({
        listProviders: vi.fn(async () => [profile()]),
        getProviderApiKey: vi.fn(async () => SECRET),
      }),
      { invoke },
    )

    const result = await service.diagnose({
      providerId: 'provider-custom',
      execute: {
        modelId: 'same-model',
        capabilityId: 'image.generate',
        prompt: 'test',
        confirmExecute: false,
      },
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(result.stages.find((stage) => stage.stage === 'invoke')).toMatchObject({ ok: false })
  })

  it('returns a redacted structured result for a real diagnostic invocation', async () => {
    const invoke = vi.fn(async () => ({
      providerProfileId: 'provider-custom',
      output: {
        provider: 'custom',
        model: 'same-model',
        mode: 'sync' as const,
        assets: [{ type: 'image' as const, url: 'https://cdn.example/output.png' }],
        requestCall: {
          method: 'POST',
          url: 'https://channel.example/v1/images/generations?token=secret-query',
          headers: { authorization: `Bearer ${SECRET}` },
        },
        rawResponse: { token: SECRET, data: [{ url: 'https://cdn.example/output.png' }] },
      },
    }))
    const service = new CustomMediaProviderConfiguratorService(
      store({
        listProviders: vi.fn(async () => [profile()]),
        getProviderApiKey: vi.fn(async () => SECRET),
      }),
      { invoke },
    )

    const result = await service.diagnose({
      providerId: 'provider-custom',
      execute: {
        modelId: 'same-model',
        capabilityId: 'image.generate',
        prompt: 'test',
        confirmExecute: true,
      },
    })

    expect(invoke).toHaveBeenCalledOnce()
    expect(result.stages.find((stage) => stage.stage === 'invoke')).toMatchObject({ ok: true })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain('secret-query')
    expect(JSON.stringify(result)).toContain('[REDACTED]')
  })
})

function draft(): CustomMediaProviderDraftInput {
  return {
    name: '自定义媒体渠道',
    apiEndpoint: 'https://channel.example/v1',
    defaultModel: 'same-model',
    models: [{ modelId: 'same-model', manifest: manifest('same-model') }],
  }
}

function manifest(modelId: string): MediaModelManifest {
  return {
    ...createBasicCustomMediaManifest({ modelId, modelType: 'image', mode: 'sync' }),
    contractVersion: 2,
    adapterMode: 'template',
    docs: {
      sourceUrls: ['https://channel.example/docs/images'],
      lastCheckedAt: '2026-08-08',
    },
  }
}

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const mediaManifest = manifest('same-model')
  return {
    id: 'provider-custom',
    name: '自定义媒体渠道',
    provider: 'openai',
    enabled: true,
    defaultModel: 'same-model',
    modelIds: ['same-model'],
    apiEndpoint: 'https://channel.example/v1',
    modelType: 'image',
    imageProvider: 'custom',
    imageApiType: 'auto',
    mediaProvider: 'custom',
    mediaApiType: 'auto',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      {
        manifestId: mediaManifest.id,
        modelId: 'same-model',
        enabled: true,
        adapterMode: 'template',
        manifest: mediaManifest,
      },
    ],
    keystoreRef: 'spark-provider-keychain-ref',
    isDefault: false,
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

function store(overrides: Partial<CustomMediaProviderStore> = {}): CustomMediaProviderStore {
  return {
    createProvider: vi.fn(async () => profile()),
    updateProvider: vi.fn(async () => profile()),
    listProviders: vi.fn(async () => []),
    getProviderApiKey: vi.fn(async () => ''),
    fetchModels: vi.fn(async () => []),
    ...overrides,
  } as CustomMediaProviderStore
}
