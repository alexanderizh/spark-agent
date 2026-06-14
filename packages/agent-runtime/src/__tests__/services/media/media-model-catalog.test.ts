import { describe, expect, it } from 'vitest'
import type {
  MediaModelManifestRepository,
  MediaModelManifestRow,
  MediaProviderModelRow,
  UpsertMediaModelManifestParams,
  UpsertMediaProviderModelParams,
} from '@spark/storage'
import { MediaModelCatalogService } from '../../../services/media/media-model-catalog.service.js'

describe('MediaModelCatalogService', () => {
  it('seeds built-in manifests and filters by capability', () => {
    const service = new MediaModelCatalogService(createRepo())
    const seeded = service.seedBuiltinManifests()

    expect(seeded.length).toBeGreaterThan(5)
    expect(service.describe('apimart:gpt-image-2')?.modelId).toBe('gpt-image-2')
    expect(service.list({ capability: 'video.image_to_video' }).length).toBeGreaterThan(1)
  })

  it('links provider profiles to manifest refs', () => {
    const service = new MediaModelCatalogService(createRepo())
    service.seedBuiltinManifests()

    const items = service.linkProviderModels('provider-1', [
      { manifestId: 'apimart:gpt-image-2', modelId: 'gpt-image-2', defaults: { size: '1024x1024' } },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.providerProfileId).toBe('provider-1')
    expect(items[0]?.capabilities).toContain('image.generate')
    expect(items[0]?.defaults).toMatchObject({ size: '1024x1024' })
  })
})

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
