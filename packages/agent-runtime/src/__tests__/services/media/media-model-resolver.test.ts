import { describe, expect, it } from 'vitest'
import type {
  MediaModelManifestRepository,
  MediaModelManifestRow,
  MediaProviderModelRow,
  UpsertMediaModelManifestParams,
  UpsertMediaProviderModelParams,
} from '@spark/storage'
import { MediaModelCatalogService } from '../../../services/media/media-model-catalog.service.js'
import {
  resolveProfileMediaModels,
  synthesizeMediaManifestForRef,
} from '../../../services/media/media-model-resolver.js'
import type { MediaModelManifest } from '@spark/protocol'

describe('resolveProfileMediaModels', () => {
  it('优先使用 ref 携带的完整 manifest，不再克隆目录模型', () => {
    const catalog = newCatalog()
    const manifest: MediaModelManifest = {
      id: 'custom:studio-video',
      providerKind: 'custom',
      modelId: 'studio-video-v1',
      displayName: 'Studio Video',
      domains: ['video'],
      capabilities: [{
        id: 'video.generate',
        label: '文生视频',
        input: { required: ['prompt'] },
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: { type: 'object', properties: { duration: { type: 'integer' } } },
      }],
      invocation: {
        mode: 'async_polling',
        endpoint: '/jobs',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: {
          kind: 'task_poll',
          taskIdPaths: ['id'],
          statusEndpoint: '/jobs/{{taskId}}',
          resultPaths: ['output.url'],
        },
        polling: {
          intervalMs: 1000,
          timeoutMs: 60_000,
          statusMap: { completed: 'succeeded', failed: 'failed' },
        },
      },
      docs: { sourceUrls: [] },
    }

    const models = resolveProfileMediaModels(
      {
        mediaProvider: 'custom',
        modelType: 'video',
        mediaModelRefs: [{ manifestId: manifest.id, modelId: manifest.modelId, manifest }],
      },
      catalog,
    )

    expect(models).toHaveLength(1)
    expect(models[0]?.manifest).toEqual(manifest)
    expect(models[0]?.synthesized).toBe(false)
  })

  it('解析自定义 ref（目录查不到）：合成同 providerKind 的 manifest，列表只含配置的那个', () => {
    const catalog = newCatalog()
    const models = resolveProfileMediaModels(
      {
        mediaProvider: 'apimart',
        modelType: 'image',
        defaultModel: 'gpt-image-2',
        // modelIds 被供应商模板预填，但不应再混进画布列表
        modelIds: ['gpt-image-2', 'gpt-image-1', 'imagen-4.0-apimart', 'gpt-image-2-official'],
        mediaCapabilities: ['image.generate', 'image.edit'],
        mediaModelRefs: [
          { manifestId: 'custom:gpt-image-2-official', modelId: 'gpt-image-2-official', enabled: true },
        ],
      },
      catalog,
    )

    expect(models).toHaveLength(1)
    expect(models[0]?.effectiveModelId).toBe('gpt-image-2-official')
    expect(models[0]?.manifest.id).toBe('custom:gpt-image-2-official')
    expect(models[0]?.synthesized).toBe(true)
    // 基准应优先选 modelId 为前缀的内置（gpt-image-2），从而继承其图片能力
    expect(models[0]?.manifest.domains).toContain('image')
    expect(models[0]?.manifest.capabilities.some((cap) => cap.id === 'image.generate')).toBe(true)
  })

  it('配置了 mediaModelRefs 时不再用 modelIds 回退补内置模型', () => {
    const catalog = newCatalog()
    const models = resolveProfileMediaModels(
      {
        mediaProvider: 'apimart',
        modelType: 'image',
        defaultModel: 'gpt-image-2',
        modelIds: ['gpt-image-2', 'gpt-image-1', 'imagen-4.0-apimart'],
        mediaModelRefs: [
          { manifestId: 'custom:gpt-image-2-official', modelId: 'gpt-image-2-official', enabled: true },
        ],
      },
      catalog,
    )

    const ids = models.map((model) => model.manifest.modelId)
    expect(ids).toEqual(['gpt-image-2-official'])
    expect(ids).not.toContain('gpt-image-2')
    expect(ids).not.toContain('gpt-image-1')
  })

  it('解析内置 ref：直接走目录 manifest', () => {
    const catalog = newCatalog()
    const models = resolveProfileMediaModels(
      {
        mediaProvider: 'apimart',
        mediaModelRefs: [
          { manifestId: 'apimart:gpt-image-2', modelId: 'gpt-image-2', enabled: true },
        ],
      },
      catalog,
    )

    expect(models).toHaveLength(1)
    expect(models[0]?.manifest.id).toBe('apimart:gpt-image-2')
    expect(models[0]?.synthesized).toBe(false)
  })

  it('完全没有 mediaModelRefs 时，按 modelIds 回退（兼容旧数据）', () => {
    const catalog = newCatalog()
    const models = resolveProfileMediaModels(
      {
        mediaProvider: 'apimart',
        defaultModel: 'gpt-image-2',
        modelIds: ['gpt-image-2'],
      },
      catalog,
    )

    expect(models.map((model) => model.manifest.modelId)).toContain('gpt-image-2')
  })
})

describe('synthesizeMediaManifestForRef', () => {
  it('无任何同 providerKind 内置时返回 null', () => {
    const catalog = newCatalog()
    const manifest = synthesizeMediaManifestForRef(
      { mediaProvider: 'no-such-provider' },
      { manifestId: 'custom:foo', modelId: 'foo' },
      catalog,
    )
    expect(manifest).toBeNull()
  })
})

function newCatalog(): MediaModelCatalogService {
  const catalog = new MediaModelCatalogService(createRepo())
  catalog.seedBuiltinManifests()
  return catalog
}

function createRepo(): MediaModelManifestRepository {
  const manifests = new Map<string, MediaModelManifestRow>()
  const providerModels = new Map<string, MediaProviderModelRow>()
  let providerModelSeq = 0
  const now = () => new Date().toISOString()

  const repo = {
    ensureSchema(): void {},
    list(filters?: { providerKind?: string; enabledOnly?: boolean; builtIn?: boolean }): MediaModelManifestRow[] {
      return [...manifests.values()]
        .filter((row) => filters?.providerKind == null || row.provider_kind === filters.providerKind)
        .filter((row) => filters?.enabledOnly !== true || row.enabled === 1)
        .filter((row) => filters?.builtIn === undefined || row.built_in === (filters.builtIn ? 1 : 0))
        .sort((left, right) =>
          left.provider_kind.localeCompare(right.provider_kind) || left.display_name.localeCompare(right.display_name),
        )
    },
    getById(id: string): MediaModelManifestRow | null {
      return manifests.get(id) ?? null
    },
    upsert(params: UpsertMediaModelManifestParams): MediaModelManifestRow {
      const existing = manifests.get(params.id)
      const timestamp = now()
      const row: MediaModelManifestRow = {
        id: params.id,
        provider_kind: params.providerKind,
        model_id: params.modelId,
        display_name: params.displayName,
        version: params.version ?? null,
        manifest_json: params.manifestJson,
        built_in: params.builtIn === true ? 1 : 0,
        enabled: params.enabled === false ? 0 : 1,
        source_urls_json: params.sourceUrlsJson ?? '[]',
        last_checked_at: params.lastCheckedAt ?? null,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      }
      manifests.set(row.id, row)
      return row
    },
    listProviderModels(providerProfileId: string): MediaProviderModelRow[] {
      return [...providerModels.values()].filter((row) => row.provider_profile_id === providerProfileId)
    },
    upsertProviderModel(params: UpsertMediaProviderModelParams): MediaProviderModelRow {
      const key = `${params.providerProfileId}:${params.manifestId}`
      const existing = providerModels.get(key)
      const timestamp = now()
      const row: MediaProviderModelRow = {
        id: existing?.id ?? `provider-model-${++providerModelSeq}`,
        provider_profile_id: params.providerProfileId,
        manifest_id: params.manifestId,
        model_id: params.modelId ?? null,
        enabled: params.enabled === false ? 0 : 1,
        defaults_json: params.defaultsJson ?? '{}',
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      }
      providerModels.set(key, row)
      return row
    },
  }
  return repo as unknown as MediaModelManifestRepository
}
