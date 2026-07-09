import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import { getProviderAdapterKind } from '../../utils/provider-adapter'

export interface CanvasAgentModelGroup {
  provider: ProviderProfile
  adapter: SessionAgentAdapter
  models: Array<{ modelId: string; label: string }>
}

export interface CanvasAgentModelSelection {
  provider: ProviderProfile | null
  providerId: string
  modelId: string
  adapter: SessionAgentAdapter
}

export function getCanvasAgentProviderModels(provider: ProviderProfile | undefined): string[] {
  if (provider == null) return []
  return Array.from(
    new Set(
      [
        provider.defaultModel,
        provider.haikuModel,
        provider.sonnetModel,
        provider.opusModel,
        ...provider.modelIds,
      ]
        .map((model) => model?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
  )
}

export function buildCanvasAgentModelOptions(
  providers: ProviderProfile[],
): CanvasAgentModelGroup[] {
  return providers
    .map((provider) => ({
      provider,
      adapter: getProviderAdapterKind(provider),
      models: getCanvasAgentProviderModels(provider).map((modelId) => ({
        modelId,
        label: modelId,
      })),
    }))
    .filter((group) => group.models.length > 0)
}

export function resolveCanvasAgentProviderModel(
  provider: ProviderProfile,
  preferredModelId: string | undefined,
): string {
  const models = getCanvasAgentProviderModels(provider)
  return preferredModelId != null && models.includes(preferredModelId)
    ? preferredModelId
    : (provider.defaultModel ?? models[0] ?? '')
}

export function resolveCanvasAgentModelSelection({
  providers,
  providerId,
  modelId,
  fallbackAdapter,
}: {
  providers: ProviderProfile[]
  providerId: string
  modelId: string
  fallbackAdapter: SessionAgentAdapter
}): CanvasAgentModelSelection {
  const provider = providers.find((item) => item.id === providerId) ?? null
  const adapter = provider != null ? getProviderAdapterKind(provider) : fallbackAdapter
  return {
    provider,
    providerId,
    modelId: provider != null ? resolveCanvasAgentProviderModel(provider, modelId) : modelId,
    adapter,
  }
}
