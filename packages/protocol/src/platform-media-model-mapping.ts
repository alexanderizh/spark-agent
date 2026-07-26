import type { MediaModelManifest, ProviderMediaModelRef } from './media-model-manifest.js'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from './media-model-manifest.js'

export interface PlatformModelCatalogItem {
  modelId: string
  tags: string[]
}

export interface PlatformMediaCatalogIssue {
  modelId: string
  reason: 'missing_adapter_tag' | 'manifest_not_found' | 'multiple_adapter_tags'
  message: string
}

export interface PlatformModelCatalogMapping {
  textModelIds: string[]
  mediaModelRefs: ProviderMediaModelRef[]
  issues: PlatformMediaCatalogIssue[]
}

const PLATFORM_MODEL_TYPE_TAG = 'model:image'

const ADAPTER_ALIASES: Readonly<Record<string, string>> = {
  openai: 'openai-images',
  'openai-images': 'openai-images',
  volcengine: 'volcengine-ark',
  'volcengine-ark': 'volcengine-ark',
  ark: 'volcengine-ark',
  google: 'google-generative-ai',
  gemini: 'google-generative-ai',
  'google-generative-ai': 'google-generative-ai',
  xai: 'xai',
  bailian: 'bailian',
  apimart: 'apimart',
  agnes: 'agnes',
  omni: 'omni',
  midjourney: 'midjourney',
  'tencent-tokenhub': 'tencent-tokenhub',
}

/**
 * Converts the platform model catalog into the existing Provider model fields.
 * Text models stay in modelIds; `model:image` entries become template-backed
 * media refs and therefore never leak into the chat model picker.
 */
export function mapPlatformModelCatalog(
  items: readonly PlatformModelCatalogItem[],
  manifests: readonly MediaModelManifest[] = BUILTIN_MEDIA_MODEL_MANIFESTS,
): PlatformModelCatalogMapping {
  const textModelIds: string[] = []
  const mediaModelRefs: ProviderMediaModelRef[] = []
  const issues: PlatformMediaCatalogIssue[] = []
  const seenText = new Set<string>()
  const seenMedia = new Set<string>()

  for (const item of items) {
    const modelId = item.modelId.trim()
    if (!modelId) continue
    const tags = normalizeTags(item.tags)
    if (!tags.some((tag) => tag.toLowerCase() === PLATFORM_MODEL_TYPE_TAG)) {
      if (!seenText.has(modelId)) {
        seenText.add(modelId)
        textModelIds.push(modelId)
      }
      continue
    }

    const adapterTags = tags
      .map(parseAdapterTag)
      .filter((entry): entry is { providerKind: string; templateModelId: string } => entry != null)
    if (adapterTags.length === 0) {
      issues.push({
        modelId,
        reason: 'missing_adapter_tag',
        message: `平台图片模型 ${modelId} 缺少适配器标签`,
      })
      continue
    }
    if (adapterTags.length > 1) {
      issues.push({
        modelId,
        reason: 'multiple_adapter_tags',
        message: `平台图片模型 ${modelId} 配置了多个适配器标签`,
      })
      continue
    }

    const [mapping] = adapterTags
    if (!mapping) continue
    const template = manifests.find(
      (manifest) =>
        manifest.providerKind === mapping.providerKind &&
        manifest.modelId === mapping.templateModelId &&
        manifest.domains.includes('image'),
    )
    if (!template) {
      issues.push({
        modelId,
        reason: 'manifest_not_found',
        message: `平台图片模型 ${modelId} 找不到应用内模板 ${mapping.providerKind}:${mapping.templateModelId}`,
      })
      continue
    }
    if (seenMedia.has(modelId)) continue
    seenMedia.add(modelId)
    mediaModelRefs.push({
      manifestId: platformManifestId(modelId),
      modelId,
      templateManifestId: template.id,
      displayName: modelId,
      enabled: true,
    })
  }

  return { textModelIds, mediaModelRefs, issues }
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

function parseAdapterTag(tag: string): { providerKind: string; templateModelId: string } | null {
  const separator = tag.indexOf(':')
  if (separator <= 0 || separator === tag.length - 1) return null
  const alias = tag.slice(0, separator).toLowerCase()
  const providerKind = ADAPTER_ALIASES[alias]
  if (!providerKind) return null
  const templateModelId = tag.slice(separator + 1).trim()
  return templateModelId ? { providerKind, templateModelId } : null
}

function platformManifestId(modelId: string): string {
  const normalized = modelId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 110) || 'model'
  return `platform:${normalized}:${stableHash(modelId)}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
