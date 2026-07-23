import type { CanvasMediaModelSummary, ProviderProfile } from '@spark/protocol'

import { filterProvidersForVisibleUi } from '../../../utils/auto-router-ui'
import { mediaModelKey } from '../canvasModelPickerModel'
import type {
  CanvasAcceptanceModelTarget,
  CanvasAcceptanceTargetKind,
} from './canvasAcceptanceTypes'

export function textTargetKey(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId])
}

export function listTextTargetOptions(providers: readonly ProviderProfile[]) {
  return filterProvidersForVisibleUi(providers).flatMap((provider) =>
    Array.from(new Set([provider.defaultModel, ...provider.modelIds].filter(Boolean))).map(
      (modelId) => ({
        label: `${provider.name} · ${modelId}`,
        value: textTargetKey(provider.id, modelId),
      }),
    ),
  )
}

export function buildTextTarget(
  provider: ProviderProfile | undefined,
  modelId: string,
): CanvasAcceptanceModelTarget | undefined {
  if (!provider || !modelId) return undefined
  return {
    kind: 'text',
    providerProfileId: provider.id,
    providerName: provider.name,
    modelId,
    displayName: modelId,
    capabilities: [],
  }
}

export function buildTextTargets(
  providers: readonly ProviderProfile[],
  selectedKeys: readonly string[],
): CanvasAcceptanceModelTarget[] {
  return selectedKeys.flatMap((key) => {
    try {
      const parsed = JSON.parse(key) as unknown
      if (!Array.isArray(parsed) || parsed.length !== 2) return []
      const [providerId, modelId] = parsed
      if (typeof providerId !== 'string' || typeof modelId !== 'string') return []
      const target = buildTextTarget(
        providers.find((provider) => provider.id === providerId),
        modelId,
      )
      return target ? [target] : []
    } catch {
      return []
    }
  })
}

export function buildMediaTarget(
  kind: CanvasAcceptanceTargetKind,
  models: readonly CanvasMediaModelSummary[],
  selectedKey: string,
): CanvasAcceptanceModelTarget | undefined {
  if (!selectedKey || kind === 'text') return undefined
  const model = models.find((item) => mediaModelKey(item) === selectedKey)
  if (!model?.providerProfileId) return undefined
  return {
    kind,
    providerProfileId: model.providerProfileId,
    providerName: model.providerName ?? model.providerKind,
    modelId: model.effectiveModelId,
    displayName: model.displayName,
    manifestId: model.manifestId,
    providerKind: model.providerKind,
    capabilities: model.capabilities.map((capability) => capability.id),
  }
}

export function buildMediaTargets(
  kind: CanvasAcceptanceTargetKind,
  models: readonly CanvasMediaModelSummary[],
  selectedKeys: readonly string[],
): CanvasAcceptanceModelTarget[] {
  return selectedKeys.flatMap((key) => {
    const target = buildMediaTarget(kind, models, key)
    return target ? [target] : []
  })
}

export function firstModelKey(
  models: readonly CanvasMediaModelSummary[],
  kind: CanvasAcceptanceTargetKind,
): string {
  const model = models.find(
    (item) => item.providerProfileId && modelMatchesKind(item, kind),
  )
  return model ? mediaModelKey(model) : ''
}

export function modelMatchesKind(
  model: CanvasMediaModelSummary,
  kind: CanvasAcceptanceTargetKind,
): boolean {
  const capabilities = new Set(model.capabilities.map((capability) => capability.id))
  if (kind === 'image') return capabilities.has('image.generate') || capabilities.has('image.edit')
  if (kind === 'video') {
    return Array.from(capabilities).some((capability) => capability.startsWith('video.'))
  }
  if (kind === 'audio') {
    return capabilities.has('audio.speech') || capabilities.has('audio.transcription')
  }
  return false
}
