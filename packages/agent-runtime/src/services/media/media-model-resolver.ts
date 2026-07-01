/**
 * @module media-model-resolver
 *
 * 把一个 Provider profile 解析成「画布 / MCP 可用的媒体模型清单」。
 *
 * 解析顺序：
 *  1. 优先按 profile.mediaModelRefs 解析。每条 ref 先查目录 manifest；查不到
 *     （典型是用户手填的自定义模型，manifestId 以 `custom:` 开头）则克隆一个同
 *     providerKind 的代表性内置 manifest 合成出来，使其仍可在画布里被选择并配置
 *     参数。真正发请求时由原生 adapter 按 modelId 调用，与此合成结果无关。
 *  2. 只有当 profile 完全没有配置 mediaModelRefs 时，才回退到按 defaultModel /
 *     modelIds 猜测内置 manifest（兼容尚未迁移到 mediaModelRefs 的旧数据）。
 *
 * 关键点：一旦 profile 配置了 mediaModelRefs，解析结果就严格以 refs 为准，绝不再
 * 用 modelIds 去补内置模型——否则会把用户没勾选的内置模型混进画布列表。
 */

import type { MediaDomain, MediaModelManifest, ProviderMediaModelRef } from '@spark/protocol'
import type { MediaModelCatalogService } from './media-model-catalog.service.js'

/** 解析所需的 profile 字段子集（与 ProviderProfile 兼容）。 */
export interface MediaProfileLike {
  mediaModelRefs?: ProviderMediaModelRef[] | undefined
  modelIds?: string[] | undefined
  defaultModel?: string | undefined
  mediaProvider?: string | null | undefined
  imageProvider?: string | null | undefined
  provider?: string | undefined
  modelType?: string | undefined
  mediaCapabilities?: string[] | undefined
}

export interface ResolvedMediaModel {
  manifest: MediaModelManifest
  effectiveModelId: string
  enabled: boolean
  defaults?: Record<string, unknown> | undefined
  /** 该 manifest 是否为自定义 ref 合成（非目录内置） */
  synthesized: boolean
}

export interface MediaModelResolveFilters {
  capability?: string | undefined
  providerKind?: string | undefined
  enabledOnly?: boolean | undefined
}

const CUSTOM_MANIFEST_PREFIX = 'custom:'

export function mediaProviderKindCandidates(profile: MediaProfileLike): string[] {
  const candidates = new Set<string>()
  for (const value of [profile.mediaProvider, profile.imageProvider, profile.provider]) {
    if (typeof value !== 'string' || value.trim().length === 0) continue
    const normalized = value.trim()
    const lower = normalized.toLowerCase()
    candidates.add(normalized)
    if (lower.includes('openai')) candidates.add('openai')
    if (lower.includes('google') || lower.includes('gemini') || lower.includes('veo'))
      candidates.add('google')
    if (lower.includes('volc') || lower.includes('seed')) candidates.add('volcengine')
  }
  return [...candidates]
}

/** 从 profile 推断主域（image / video / audio），用于挑选合成时的基准 manifest。 */
export function mediaDomainForProfile(profile: MediaProfileLike): MediaDomain | undefined {
  const caps = profile.mediaCapabilities ?? []
  if (caps.some((cap) => cap.startsWith('image'))) return 'image'
  if (caps.some((cap) => cap.startsWith('video'))) return 'video'
  if (caps.some((cap) => cap.startsWith('audio'))) return 'audio'
  switch (profile.modelType) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'voice':
    case 'audio':
      return 'audio'
    default:
      return undefined
  }
}

function stripCustomPrefix(manifestId: string): string {
  return manifestId.startsWith(CUSTOM_MANIFEST_PREFIX)
    ? manifestId.slice(CUSTOM_MANIFEST_PREFIX.length)
    : manifestId
}

/**
 * 为目录中查不到的（自定义）ref 合成一个仅供 UI 使用的 manifest：克隆一个同
 * providerKind 的内置 manifest，覆盖 id / modelId / displayName。
 * 基准 manifest 优先匹配同域，再优先 modelId 是 ref.modelId 前缀者（最长前缀优先）。
 */
export function synthesizeMediaManifestForRef(
  profile: MediaProfileLike,
  ref: ProviderMediaModelRef,
  catalog: MediaModelCatalogService,
  filters?: MediaModelResolveFilters,
): MediaModelManifest | null {
  const modelId = (ref.modelId ?? '').trim() || stripCustomPrefix(ref.manifestId)
  if (!modelId) return null

  const bases: MediaModelManifest[] = []
  const seenBase = new Set<string>()
  for (const providerKind of mediaProviderKindCandidates(profile)) {
    for (const item of catalog.list({ providerKind, enabledOnly: false })) {
      if (seenBase.has(item.id)) continue
      seenBase.add(item.id)
      const base = catalog.describe(item.id)
      if (!base) continue
      if (
        filters?.capability != null &&
        !base.capabilities.some((cap) => cap.id === filters.capability)
      )
        continue
      bases.push(base)
    }
  }
  if (bases.length === 0) return null

  const preferredDomain = mediaDomainForProfile(profile)
  const domainPool = preferredDomain
    ? bases.filter((base) => base.domains.includes(preferredDomain))
    : []
  const pool = domainPool.length > 0 ? domainPool : bases

  let best = pool[0] as MediaModelManifest
  let bestPrefixLen = -1
  for (const base of pool) {
    if (modelId.startsWith(base.modelId) && base.modelId.length > bestPrefixLen) {
      best = base
      bestPrefixLen = base.modelId.length
    }
  }

  return {
    ...best,
    id: ref.manifestId,
    modelId,
    displayName: modelId,
  }
}

/**
 * 解析 profile 的媒体模型清单。详见模块头注释的两段式解析顺序。
 */
export function resolveProfileMediaModels(
  profile: MediaProfileLike,
  catalog: MediaModelCatalogService,
  filters?: MediaModelResolveFilters,
): ResolvedMediaModel[] {
  const resolved: ResolvedMediaModel[] = []
  const seen = new Set<string>()
  const capabilityMatches = (manifest: MediaModelManifest): boolean =>
    filters?.capability == null ||
    manifest.capabilities.some((capability) => capability.id === filters.capability)
  const providerKindMatches = (manifest: MediaModelManifest): boolean =>
    filters?.providerKind == null || manifest.providerKind === filters.providerKind

  const refs = profile.mediaModelRefs ?? []
  for (const ref of refs) {
    if (filters?.enabledOnly !== false && ref.enabled === false) continue
    const catalogManifest = ref.manifest == null ? catalog.describe(ref.manifestId) : null
    const manifest =
      ref.manifest ??
      catalogManifest ??
      synthesizeMediaManifestForRef(profile, ref, catalog, filters)
    if (!manifest || !capabilityMatches(manifest) || !providerKindMatches(manifest)) continue
    if (seen.has(manifest.id)) continue
    seen.add(manifest.id)
    const synthesized =
      ref.manifest == null &&
      catalogManifest == null &&
      manifest.id.startsWith(CUSTOM_MANIFEST_PREFIX)
    resolved.push({
      manifest,
      effectiveModelId: ref.modelId ?? manifest.modelId,
      enabled: ref.enabled !== false,
      defaults: ref.defaults,
      synthesized,
    })
  }

  // 一旦配置过 mediaModelRefs，就严格以 refs 为准，不再用 modelIds 回退补内置模型。
  if (refs.length > 0) return resolved

  const modelIds = new Set(
    [profile.defaultModel ?? '', ...(profile.modelIds ?? [])].filter(
      (value) => value.trim().length > 0,
    ),
  )
  for (const providerKind of mediaProviderKindCandidates(profile)) {
    for (const item of catalog.list({
      providerKind,
      enabledOnly: filters?.enabledOnly !== false,
    })) {
      if (seen.has(item.id)) continue
      if (modelIds.size > 0 && !modelIds.has(item.modelId)) continue
      const manifest = catalog.describe(item.id)
      if (!manifest || !capabilityMatches(manifest) || !providerKindMatches(manifest)) continue
      seen.add(manifest.id)
      resolved.push({
        manifest,
        effectiveModelId: manifest.modelId,
        enabled: item.enabled,
        defaults: undefined,
        synthesized: false,
      })
    }
  }
  return resolved
}
