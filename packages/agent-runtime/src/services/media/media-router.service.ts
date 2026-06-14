/**
 * MediaRouterService —— 统一多媒体能力入口。
 *
 * 职责（design doc §4 §8）：
 *   - 维护 capability → 可用 provider profile 的注册表。
 *   - 接收 (operation/capability + providerProfileId?) 请求，选择 adapter 并调用。
 *   - 旧 spark_image 的同步逻辑可逐步委托到这里，避免图片/语音/视频 provider 适配分叉。
 *
 * 调用方：
 *   - spark_media MCP server（agent 技能，stdio 子进程）
 *   - 无限画布 canvas media runtime（main process IPC）
 */

import type {
  CanvasOperationType,
  MediaCapabilityId,
  MediaProviderKind,
  ProviderMediaDefaults,
  MediaModelManifest,
} from '@spark/protocol'
import { capabilityForOperation, isMediaCapabilityId, isMediaProviderKind, mediaManifestCapabilities } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderAdapter,
  MediaProviderContext,
} from './media-adapter.types.js'
import { ApimartMediaAdapter } from './adapters/apimart-media.adapter.js'
import { XaiMediaAdapter } from './adapters/xai-media.adapter.js'

/**
 * 最小化 provider profile 视图：router 只关心调用所需的字段，
 * 调用方负责从 DB row + keystore 解析后传入（避免 router 直接耦合 storage）。
 */
export interface MediaProviderProfile {
  id: string
  name: string
  defaultModel: string
  modelIds?: string[]
  apiEndpoint?: string
  mediaProvider?: MediaProviderKind | null
  mediaApiType?: 'sync' | 'async' | 'auto' | null
  mediaCapabilities?: MediaCapabilityId[]
  mediaModelManifests?: Array<Pick<MediaModelManifest, 'id' | 'modelId' | 'capabilities'>>
  mediaDefaults?: ProviderMediaDefaults
  apiKey: string
  modelParams?: Record<string, unknown>
}

export interface InvokeOptions {
  /** 用户指定 provider；优先 */
  providerProfileId?: string | null
  /** 候选 provider 列表（按优先级排序） */
  providers: MediaProviderProfile[]
  /** 显式覆盖 capability（不传则由 operation 推导） */
  capability?: MediaCapabilityId
  /** 透传给 adapter 的 extra params（如 voice/aspect_ratio 等） */
  extraParams?: Record<string, unknown>
  /** 注入 fetch（测试用） */
  fetch?: typeof fetch
}

export class MediaRouterService {
  private readonly adapters = new Map<MediaProviderKind, MediaProviderAdapter>()

  constructor() {
    this.register(new ApimartMediaAdapter())
    this.register(new XaiMediaAdapter())
  }

  register(adapter: MediaProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  /** 暴露内置 adapter id（用于诊断 / capability 列举） */
  listAdapters(): MediaProviderKind[] {
    return [...this.adapters.keys()]
  }

  getAdapter(kind: MediaProviderKind): MediaProviderAdapter | undefined {
    return this.adapters.get(kind)
  }

  /**
   * 解析 operation → 所需 capability（取首个候选 provider 支持的）。
   * 用于 canvas runtime 在不显式指定 capability 时推导。
   */
  resolveCapability(operation: CanvasOperationType, providers: MediaProviderProfile[]): MediaCapabilityId | null {
    const candidates = capabilityForOperation(operation)
    for (const cap of candidates) {
      if (providers.some((provider) => this.supports(provider, cap))) return cap
    }
    return candidates[0] ?? null
  }

  /** 检查某 provider profile 是否声明支持某 capability（且 adapter 也支持） */
  supports(profile: MediaProviderProfile, capability: MediaCapabilityId): boolean {
    const kind = effectiveProviderKind(profile)
    const adapter = kind ? this.adapters.get(kind) : undefined
    if (!adapter) return false
    const declared = mediaCapabilitiesForProfile(profile)
    // 声明了能力列表就以列表为准；未声明则信任 adapter
    if (declared.length > 0) return declared.includes(capability) && adapter.supports(capability)
    return adapter.supports(capability)
  }

  /**
   * 主入口：选择 provider + adapter 执行 invoke。
   *
   * 选择顺序（design doc §8 step 3）：
   *   1. providerProfileId 命中且支持 capability
   *   2. providers 列表中首个支持 capability 的（按传入顺序，调用方可排好优先级）
   *   3. capability registry 中第一个 enabled provider 兜底
   */
  async invoke(input: MediaGenerateInput, options: InvokeOptions): Promise<{
    output: MediaGenerateOutput
    providerProfileId: string
  }> {
    const providers = options.providers
    if (providers.length === 0) {
      throw new MediaProviderError('provider_not_configured', 'No media provider configured')
    }
    // 优先用显式传入的 capability，否则按 operation 推导
    const capability = options.capability ?? input.capability ?? this.resolveCapability(input.operation, providers)
    if (!capability) {
      throw new MediaProviderError('capability_not_supported', `No capability for operation ${input.operation}`)
    }

    let chosen: MediaProviderProfile | undefined
    if (options.providerProfileId) {
      chosen = providers.find((provider) => provider.id === options.providerProfileId)
    }
    if (!chosen) {
      chosen = providers.find((provider) => this.supports(provider, capability))
    }
    if (!chosen) {
      throw new MediaProviderError(
        'capability_not_supported',
        `No provider supports capability ${capability}`,
      )
    }
    if (!chosen.apiKey) {
      throw new MediaProviderError('api_key_missing', `Provider ${chosen.name} has no API key`)
    }

    const kind = effectiveProviderKind(chosen)
    const adapter = kind ? this.adapters.get(kind) : undefined
    if (!adapter) {
      throw new MediaProviderError(
        'provider_not_configured',
        `No adapter for provider kind ${kind ?? '(unknown)'}`,
      )
    }

    const ctx: MediaProviderContext = {
      apiKey: chosen.apiKey,
      apiEndpoint: chosen.apiEndpoint ?? '',
      defaultModel: chosen.defaultModel,
      ...(chosen.mediaDefaults ? { mediaDefaults: chosen.mediaDefaults } : {}),
      ...(chosen.modelIds ? { modelIds: chosen.modelIds } : {}),
      mediaProvider: kind ?? 'custom',
      mediaApiType: chosen.mediaApiType ?? 'auto',
      ...(options.extraParams ? { extraParams: options.extraParams } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }
    const output = await adapter.invoke(
      { ...input, capability },
      ctx,
    )
    return { output, providerProfileId: chosen.id }
  }
}

function mediaCapabilitiesForProfile(profile: Pick<MediaProviderProfile, 'mediaCapabilities' | 'mediaModelManifests'>): MediaCapabilityId[] {
  const declared = profile.mediaCapabilities ?? []
  const fromManifests = (profile.mediaModelManifests ?? [])
    .flatMap((manifest) => mediaManifestCapabilities(manifest))
    .filter(isMediaCapabilityId)
  return Array.from(new Set([...declared, ...fromManifests]))
}

/** 解析 provider profile 的有效 mediaProvider：优先显式字段，其次由 imageProvider 推断 */
export function effectiveProviderKind(profile: Pick<MediaProviderProfile, 'mediaProvider'>): MediaProviderKind | null {
  if (profile.mediaProvider && isMediaProviderKind(profile.mediaProvider)) {
    return profile.mediaProvider
  }
  return null
}
