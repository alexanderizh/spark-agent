/**
 * @module media-model-catalog.service
 *
 * 多媒体模型能力清单服务。
 *
 * 负责把内置 manifest seed 到 SQLite，并提供按 provider/capability 查询的稳定入口。
 * 画布、MCP 工具和 Provider 配置页后续都应读取这里，而不是各自硬编码模型参数。
 */

import type {
  MediaModelManifest,
  ProviderMediaModelRef,
} from '@spark/protocol'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  MediaModelManifestSchema,
  mediaManifestCapabilities,
} from '@spark/protocol'
import type {
  MediaModelManifestRepository,
  MediaModelManifestRow,
  MediaProviderModelRow,
} from '@spark/storage'

export interface MediaModelCatalogItem {
  id: string
  providerKind: string
  modelId: string
  displayName: string
  enabled: boolean
  builtIn: boolean
  capabilities: string[]
  domains: string[]
  sourceUrls: string[]
}

export interface MediaProviderModelItem extends MediaModelCatalogItem {
  providerProfileId: string
  effectiveModelId: string
  defaults: Record<string, unknown>
}

export class MediaModelCatalogService {
  constructor(private readonly repo: MediaModelManifestRepository) {
    this.repo.ensureSchema()
  }

  seedBuiltinManifests(): MediaModelManifest[] {
    const seeded: MediaModelManifest[] = []
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      const parsed = MediaModelManifestSchema.parse(manifest)
      this.repo.upsert({
        id: parsed.id,
        providerKind: parsed.providerKind,
        modelId: parsed.modelId,
        displayName: parsed.displayName,
        version: parsed.version ?? null,
        manifestJson: JSON.stringify(parsed),
        builtIn: true,
        enabled: true,
        sourceUrlsJson: JSON.stringify(parsed.docs.sourceUrls),
        lastCheckedAt: parsed.docs.lastCheckedAt ?? null,
      })
      seeded.push(parsed)
    }
    return seeded
  }

  list(filters?: { providerKind?: string; enabledOnly?: boolean; capability?: string }): MediaModelCatalogItem[] {
    const repoFilters: { providerKind?: string; enabledOnly?: boolean } = {}
    if (filters?.providerKind !== undefined) repoFilters.providerKind = filters.providerKind
    if (filters?.enabledOnly !== undefined) repoFilters.enabledOnly = filters.enabledOnly
    return this.repo
      .list(repoFilters)
      .map(rowToCatalogItem)
      .filter((item) => filters?.capability == null || item.capabilities.includes(filters.capability))
  }

  describe(id: string): MediaModelManifest | null {
    const row = this.repo.getById(id)
    if (!row) return null
    return rowToManifest(row)
  }

  upsert(manifest: MediaModelManifest, options?: { builtIn?: boolean; enabled?: boolean }): MediaModelManifest {
    const parsed = MediaModelManifestSchema.parse(manifest)
    this.repo.upsert({
      id: parsed.id,
      providerKind: parsed.providerKind,
      modelId: parsed.modelId,
      displayName: parsed.displayName,
      version: parsed.version ?? null,
      manifestJson: JSON.stringify(parsed),
      builtIn: options?.builtIn === true,
      enabled: options?.enabled !== false,
      sourceUrlsJson: JSON.stringify(parsed.docs.sourceUrls),
      lastCheckedAt: parsed.docs.lastCheckedAt ?? null,
    })
    return parsed
  }

  linkProviderModels(providerProfileId: string, refs: ProviderMediaModelRef[]): MediaProviderModelItem[] {
    for (const ref of refs) {
      this.repo.upsertProviderModel({
        providerProfileId,
        manifestId: ref.manifestId,
        modelId: ref.modelId ?? null,
        enabled: ref.enabled !== false,
        defaultsJson: JSON.stringify(ref.defaults ?? {}),
      })
    }
    return this.listProviderModels(providerProfileId)
  }

  listProviderModels(providerProfileId: string, options?: { enabledOnly?: boolean; capability?: string }): MediaProviderModelItem[] {
    return this.repo
      .listProviderModels(providerProfileId)
      .filter((row) => options?.enabledOnly !== true || row.enabled === 1)
      .map((row) => providerRowToItem(this.repo, row))
      .filter((item): item is MediaProviderModelItem => item != null)
      .filter((item) => options?.capability == null || item.capabilities.includes(options.capability))
  }
}

function rowToManifest(row: MediaModelManifestRow): MediaModelManifest {
  return MediaModelManifestSchema.parse(JSON.parse(row.manifest_json))
}

function manifestToCatalogItem(manifest: MediaModelManifest): MediaModelCatalogItem {
  return {
    id: manifest.id,
    providerKind: manifest.providerKind,
    modelId: manifest.modelId,
    displayName: manifest.displayName,
    enabled: true,
    builtIn: true,
    capabilities: mediaManifestCapabilities(manifest),
    domains: manifest.domains,
    sourceUrls: manifest.docs.sourceUrls,
  }
}

function rowToCatalogItem(row: MediaModelManifestRow): MediaModelCatalogItem {
  const manifest = rowToManifest(row)
  return {
    ...manifestToCatalogItem(manifest),
    enabled: row.enabled === 1,
    builtIn: row.built_in === 1,
  }
}

function parseObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function providerRowToItem(
  repo: MediaModelManifestRepository,
  row: MediaProviderModelRow,
): MediaProviderModelItem | null {
  const manifestRow = repo.getById(row.manifest_id)
  if (!manifestRow || manifestRow.enabled !== 1) return null
  const manifest = rowToManifest(manifestRow)
  const base = manifestToCatalogItem(manifest)
  return {
    ...base,
    enabled: row.enabled === 1,
    builtIn: manifestRow.built_in === 1,
    providerProfileId: row.provider_profile_id,
    effectiveModelId: row.model_id ?? manifest.modelId,
    defaults: parseObject(row.defaults_json),
  }
}
