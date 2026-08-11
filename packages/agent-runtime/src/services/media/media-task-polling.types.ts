import type {
  MediaCapabilityId,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaProviderKind,
} from '@spark/protocol'
import { capabilityForOperation } from '@spark/protocol'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from '@spark/protocol'
import { invocationProviderKind } from './media-router.service.js'
import type { MediaProviderProfile } from './media-router.service.js'
import type { MediaGenerateInput } from './media-adapter.types.js'
import { configuredMediaInterfaceTimeoutMs } from './media-timeout.js'

/**
 * A credential-free snapshot of the query contract used by a submitted task.
 * The API key is deliberately not part of this object; recovery resolves the
 * current key from the selected provider profile at the point of use.
 */
export type MediaTaskPollingStrategy =
  | 'manifest'
  | 'apimart'
  | 'agnes'
  | 'bailian'
  | 'google-generative-ai'
  | 'google-interactions'
  | 'midjourney'
  | 'minimax-hailuo'
  | 'openai-sora'
  | 'tencent-tokenhub'
  | 'volcengine-ark'
  | 'volcengine-speech'
  | 'xai'

export interface MediaTaskPollingDescriptor {
  version: 1
  providerKind: MediaProviderKind | string
  strategy: MediaTaskPollingStrategy
  capability: MediaCapabilityId | string | null
  modelId: string | null
  manifestId: string | null
  outputType: 'image' | 'video' | 'audio' | 'text' | 'file'
  manifest: MediaModelManifest | null
  manifestCapability: MediaModelCapabilityManifest | null
  intervalMs: number
  timeoutMs: number
  maxAttempts: number | null
}

export interface MediaTaskPollingDescriptorInput {
  providers: MediaProviderProfile[]
  providerProfileId?: string | null
  manifestId?: string | null
  modelId?: string | null
  capability?: MediaCapabilityId
  input: MediaGenerateInput
}

export function buildMediaTaskPollingDescriptor(
  options: MediaTaskPollingDescriptorInput,
): MediaTaskPollingDescriptor | null {
  const capability =
    options.capability ??
    options.input.capability ??
    capabilityForOperation(options.input.operation)[0] ??
    null
  const provider = selectProvider(options)
  if (!provider || !capability) return null
  const manifestMatch = findManifest(provider, capability, options.manifestId, options.modelId)
  const providerKind = invocationProviderKind(provider, manifestMatch?.manifest) ?? 'custom'
  const response = manifestMatch?.manifest.invocation.response
  const isManifestPoll =
    manifestMatch?.manifest.invocation.mode === 'async_polling' && response?.kind === 'task_poll'
  const strategy = strategyFor(providerKind, options.input.operation, isManifestPoll)
  if (!strategy) return null
  const polling = manifestMatch?.manifest.invocation.polling
  const providerTimeoutMs = configuredMediaInterfaceTimeoutMs(provider.mediaDefaults)
  const outputType = (manifestMatch?.capability.output.types[0] ??
    outputTypeForOperation(options.input.operation)) as MediaTaskPollingDescriptor['outputType']
  return {
    version: 1,
    providerKind,
    strategy,
    capability,
    modelId: options.modelId ?? manifestMatch?.manifest.modelId ?? provider.defaultModel ?? null,
    manifestId: manifestMatch?.manifest.id ?? options.manifestId ?? null,
    outputType,
    manifest: manifestMatch?.manifest ?? null,
    manifestCapability: manifestMatch?.capability ?? null,
    intervalMs: clampPositive(
      polling?.intervalMs ?? provider.mediaDefaults?.polling?.intervalMs ?? 5_000,
      5_000,
    ),
    timeoutMs: clampPositive(
      polling?.timeoutMs ??
        providerTimeoutMs ??
        (outputType === 'video' ? DEFAULT_VIDEO_POLL_TIMEOUT_MS : 600_000),
      outputType === 'video' ? DEFAULT_VIDEO_POLL_TIMEOUT_MS : 600_000,
    ),
    maxAttempts: polling?.maxAttempts ?? null,
  }
}

function selectProvider(options: MediaTaskPollingDescriptorInput): MediaProviderProfile | null {
  if (options.providerProfileId) {
    const exact = options.providers.find((provider) => provider.id === options.providerProfileId)
    if (exact) return exact
  }
  return (
    options.providers.find((provider) =>
      provider.mediaModelManifests?.some((manifest) =>
        manifest.capabilities.some((item) => item.id === options.capability),
      ),
    ) ?? null
  )
}

function findManifest(
  provider: MediaProviderProfile,
  capability: MediaCapabilityId,
  manifestId?: string | null,
  modelId?: string | null,
): { manifest: MediaModelManifest; capability: MediaModelCapabilityManifest } | null {
  const candidates = (provider.mediaModelManifests ?? [])
    .map((manifest) => ({
      manifest,
      capability: manifest.capabilities.find((item) => item.id === capability),
    }))
    .filter(
      (item): item is { manifest: MediaModelManifest; capability: MediaModelCapabilityManifest } =>
        item.capability != null,
    )
  return (
    candidates.find((item) => manifestId && item.manifest.id === manifestId) ??
    candidates.find((item) => modelId && item.manifest.modelId === modelId) ??
    candidates[0] ??
    null
  )
}

function strategyFor(
  providerKind: string,
  operation: string,
  hasManifestPoll: boolean,
): MediaTaskPollingStrategy | null {
  if (providerKind === 'openai-images' && operation.includes('video')) return 'openai-sora'
  if (providerKind === 'omni') return 'google-interactions'
  if (
    providerKind === 'apimart' ||
    providerKind === 'agnes' ||
    providerKind === 'bailian' ||
    providerKind === 'google-generative-ai' ||
    providerKind === 'midjourney' ||
    providerKind === 'minimax-hailuo' ||
    providerKind === 'tencent-tokenhub' ||
    providerKind === 'volcengine-ark' ||
    providerKind === 'xai'
  ) {
    return providerKind as MediaTaskPollingStrategy
  }
  return hasManifestPoll ? 'manifest' : null
}

function outputTypeForOperation(operation: string): MediaTaskPollingDescriptor['outputType'] {
  if (operation.includes('video')) return 'video'
  if (operation.includes('audio')) return 'audio'
  if (operation.includes('text')) return 'text'
  return 'image'
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}
