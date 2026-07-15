import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import {
  ActionIcon, Button, Tag, Checkbox, Drawer, Alert, Input, InputPassword, Select, Modal, SearchBar, Dropdown,
} from '@lobehub/ui'
// TODO(lobe-migration): @lobehub/ui 没有 Badge/Switch 命名导出;临时从 antd 引用,与 SparkOverlays 行为一致
import { Badge, Switch } from 'antd'
import { Icons } from '../Icons'
import { ChipList } from '../components/ChipList'
import {
  ProviderLogo,
  PROVIDER_ICON_CATALOG,
  PROVIDER_ICON_STYLES,
  getProviderIconForVendor,
  normalizeProviderIconConfig,
} from '../components/ProviderLogo'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useDebouncedCallback } from '../hooks/useDebounce'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { useToast } from '../components/Toast'
import {
  PROVIDER_PRESETS,
  getProviderPresetById,
  getVendorMeta,
  getPresetsByVendor,
  getUniqueVendorIds,
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isClaudeAutoRouterProvider,
  CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  CODEX_AUTO_ROUTER_PROVIDER_ID,
  CODEX_AUTO_ROUTER_PROVIDER_NAME,
  isLocalCodexCliProvider,
  MEDIA_API_TYPES,
  MEDIA_CAPABILITY_IDS,
  isMediaProviderKind,
  createBasicCustomMediaManifest,
  ProviderMediaModelRefSchema,
  MediaModelManifestSchema,
  validateMediaModelManifestSemantics,
  isProviderAllowedForRouterAdapter,
  isRoutingModelConfig,
  normalizeRoutingCandidates,
} from '@spark/protocol'
import type {
  ProviderPreset,
  VendorMeta,
  ProviderHealthCheckResponse,
  ProviderProfile,
  ProviderUpdateRequest,
  ProviderFetchedModel,
  ProviderExportPayload,
  ProviderImportMode,
  ImageGenApiType,
  MediaProviderKind,
  MediaApiType,
  MediaCapabilityId,
  ProviderMediaDefaults,
  ProviderMediaModelRef,
  CanvasMediaModelSummary,
  MediaModelManifest,
  CanvasMediaPruneModelParamsByInlineManifestRequest,
  CanvasMediaPruneModelParamsByInlineManifestResponse,
  ModelProfile,
  RoutingAdapter,
  RoutingCandidateRef,
  RoutingComplexity,
  RoutingModelConfig,
  ProviderIconConfig,
  ProviderIconStyle,
} from '@spark/protocol'
import MultiSelectToolbar from './provider-import-export/MultiSelectToolbar'
import { canHealthCheckProviderCardKind, type ProviderCardKind } from './provider-card-actions'
import ImportPreviewModal from './provider-import-export/ImportPreviewModal'
import { ProviderManifestContractEditor } from '../components/ProviderManifestContractEditor'
import { ManagedModelPreferencesModal } from './platform-model/ManagedModelPreferencesModal'
import {
  editableProviderApiKeyPayload,
  loadEditableProviderSnapshot,
} from './providerApiKeyEcho'
import './ProvidersView.less'

type ProviderKind = 'anthropic' | 'openai'
type ProviderModelType = 'image' | 'text' | 'multimodal' | 'voice' | 'video'
type ImageProviderKind = 'openai' | 'apimart' | 'openrouter' | 'gemini' | 'seeddance' | 'bailian' | 'zhipu' | 'xai' | 'custom'
type ConnectionFeedback = {
  tone: 'success' | 'error'
  message: string
}
type EndpointPreview = {
  label: string
  url: string
}
type ProviderForm = {
  presetId: string
  name: string
  provider: ProviderKind
  providerIcon: ProviderIconConfig
  defaultModel: string
  /** Chip 列表内部的 model id 数组（默认模型在最后添加时会被锁定） */
  modelIds: string[]
  endpoint: string
  codexApiKind: 'chat' | 'responses' | 'embedding'
  supportsMillionContext: boolean
  /** 自定义上下文窗口 (tokens)；0 / undefined 表示按 200k 默认（或 supportsMillionContext=true 则 1M） */
  contextWindow: number
  apiKey: string
  isDefault: boolean
  /** 档位映射：留空则回落 defaultModel */
  haikuModel: string
  sonnetModel: string
  opusModel: string
  /** 模型能力类型 */
  modelType: ProviderModelType
  /** 图片模型供应商类型 */
  imageProvider: ImageProviderKind
  /** 图片模型调用方式 */
  imageApiType: ImageGenApiType
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider: MediaProviderKind | ''
  /** 多媒体调用方式 */
  mediaApiType: MediaApiType
  /** 已选多媒体能力 */
  mediaCapabilities: MediaCapabilityId[]
  /** 已启用的 manifest 模型引用 */
  mediaModelRefs: ProviderMediaModelRef[]
  /** 对话模型下是否额外开启生图/视频生成能力面板（仅本地表单状态，不直接下发） */
  mediaGenerationEnabled: boolean
  /** 多媒体能力默认值（按族分组的字符串表单值，提交时归一） */
  mediaImageSize: string
  mediaImageN: string
  mediaImageQuality: string
  mediaAudioVoice: string
  mediaAudioFormat: string
  mediaVideoAspectRatio: string
  mediaVideoDuration: string
  mediaVideoQuality: string
  mediaPollInterval: string
  mediaPollTimeout: string
}

type RouteModelDraft = {
  id?: string
  providerId: string
  name: string
  adapter: RoutingAdapter
  enabled: boolean
  candidates: Record<RoutingComplexity, RoutingCandidateRef[]>
}

const ROUTING_SLOTS: Array<{ value: RoutingComplexity; label: string; hint: string }> = [
  { value: 'simple', label: '简单任务', hint: '短问答、解释、翻译、轻量修改' },
  { value: 'default', label: '默认任务', hint: '未命中其他规则时使用' },
  { value: 'complex', label: '复杂任务', hint: '开发、重构、debug、测试、方案' },
  { value: 'longContext', label: '长上下文', hint: '超长历史或大上下文任务' },
]

/**
 * 上下文窗口下拉预设。
 * - 0：默认（未配置，运行时回落 200K 或 supportsMillionContext=true 时 1M）
 * - 200K / 256K / 400K / 1M：常见档位
 * - -1：自定义（显示数字输入框）
 */
const CONTEXT_WINDOW_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0, label: '默认 (200K)' },
  { value: 200_000, label: '200K' },
  { value: 256_000, label: '256K' },
  { value: 400_000, label: '400K' },
  { value: 1_000_000, label: '1M' },
  { value: -1, label: '自定义…' },
]

function resolveContextWindowSelectValue(contextWindow: number): number {
  if (contextWindow <= 0) return 0
  if (CONTEXT_WINDOW_PRESETS.some((p) => p.value === contextWindow)) return contextWindow
  return -1
}

const EMPTY_MEDIA_FORM = {
  mediaProvider: '' as MediaProviderKind | '',
  mediaApiType: 'auto' as MediaApiType,
  mediaCapabilities: [] as MediaCapabilityId[],
  mediaModelRefs: [] as ProviderMediaModelRef[],
  mediaGenerationEnabled: false,
  mediaImageSize: '',
  mediaImageN: '',
  mediaImageQuality: '',
  mediaAudioVoice: '',
  mediaAudioFormat: '',
  mediaVideoAspectRatio: '',
  mediaVideoDuration: '',
  mediaVideoQuality: '',
  mediaPollInterval: '',
  mediaPollTimeout: '',
} as const

function usesClaudeTierMapping(form: Pick<ProviderForm, 'modelType' | 'provider'>): boolean {
  return !isMediaProviderModelType(form.modelType) && form.provider === 'anthropic'
}

function getProviderBaseUrlPlaceholder(form: Pick<ProviderForm, 'modelType' | 'provider' | 'imageProvider'>): string {
  if (isMediaProviderModelType(form.modelType)) return 'https://api.example.com'
  if (form.modelType === 'image') return imageProviderDefaults(form.imageProvider).endpoint || 'https://api.example.com/v1'
  return form.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}

function buildRequestEndpointPreview(form: Pick<ProviderForm,
  'modelType' | 'provider' | 'imageProvider' | 'mediaProvider' | 'mediaCapabilities' | 'defaultModel' | 'endpoint' | 'codexApiKind'>): EndpointPreview | null {
  const baseUrl = (form.endpoint.trim() || getProviderBaseUrlPlaceholder(form)).replace(/\/+$/, '')
  if (isMediaProviderModelType(form.modelType)) {
    const mediaProvider = form.mediaProvider || mediaProviderFromImageKind(form.imageProvider)
    return { label: '实际请求地址', url: getMediaRequestPreviewUrl(baseUrl, form, mediaProvider) }
  }
  if (form.provider === 'anthropic') {
    return { label: '实际请求地址', url: getAnthropicMessagesPreviewUrl(baseUrl) }
  }

  // codexApiKind 选 embedding 时显示 embeddings 端点（自动按 baseURL 是否带 /v\d+ 决定拼 /embeddings 还是 /v1/embeddings）
  return {
    label: form.codexApiKind === 'responses'
      ? '实际请求地址'
      : form.codexApiKind === 'embedding'
        ? 'Embeddings 地址'
        : 'Chat 地址',
    url: form.codexApiKind === 'responses'
      ? getOpenAiCompatibleResponsesPreviewUrl(baseUrl)
      : form.codexApiKind === 'embedding'
        ? getOpenAiCompatibleEmbeddingsPreviewUrl(baseUrl)
        : getOpenAiCompatibleChatPreviewUrl(baseUrl),
  }
}

function getMediaRequestPreviewUrl(
  baseUrl: string,
  form: Pick<ProviderForm, 'modelType' | 'defaultModel' | 'mediaCapabilities'>,
  mediaProvider: MediaProviderKind,
): string {
  if (form.modelType === 'image') {
    if (mediaProvider === 'google-generative-ai' || mediaProvider === 'omni') return `${baseUrl}/interactions`
    if (mediaProvider === 'midjourney') return `${baseUrl}/imagine`
    return `${baseUrl}/images/generations`
  }

  if (form.modelType === 'voice') {
    const capabilities = new Set(form.mediaCapabilities)
    if (capabilities.has('audio.transcription') && !capabilities.has('audio.speech')) {
      return `${baseUrl}/audio/transcriptions`
    }
    return `${baseUrl}/audio/speech`
  }

  if (form.modelType === 'video') {
    if (mediaProvider === 'agnes') return `${baseUrl}/videos`
    if (mediaProvider === 'google-generative-ai' || mediaProvider === 'omni') {
      const model = encodeURIComponent(form.defaultModel.trim() || '{model}')
      return `${baseUrl}/models/${model}:predictLongRunning`
    }
    if (mediaProvider === 'volcengine-ark') return `${baseUrl}/contents/generations/tasks`
    return `${baseUrl}/videos/generations`
  }

  return baseUrl
}

function getAnthropicMessagesPreviewUrl(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function getOpenAiCompatibleChatPreviewUrl(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (endsWithVersionSegment(base)) return `${base}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function getOpenAiCompatibleResponsesPreviewUrl(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions')) return `${base.slice(0, -'/chat/completions'.length)}/responses`
  if (endsWithVersionSegment(base)) return `${base}/responses`
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

// embeddings URL 推算（与 model.service.ts getEmbeddingsEndpoint 一致）：
// baseURL 已带 /v\d+（如 /v1 /v4）→ 拼 /embeddings；否则补 /v1/embeddings。
// 智谱 https://open.bigmodel.cn/api/paas/v4（带 /v4）→ .../v4/embeddings ✓
function getOpenAiCompatibleEmbeddingsPreviewUrl(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/embeddings')) return base
  if (endsWithVersionSegment(base)) return `${base}/embeddings`
  if (base.endsWith('/v1')) return `${base}/embeddings`
  return `${base}/v1/embeddings`
}

export function resolveCodexApiKind(
  provider: ProviderForm['provider'],
  apiEndpoint: string | undefined,
  codexApiKind?: 'chat' | 'responses' | 'embedding',
): 'chat' | 'responses' | 'embedding' {
  if (provider !== 'openai') return 'chat'
  if (codexApiKind) return codexApiKind
  if (shouldDefaultOpenAiCodexResponses(apiEndpoint)) return 'responses'
  return 'chat'
}

function findPresetForProtocolSwitch(
  currentPresetId: string,
  targetProvider: ProviderPreset['provider'],
): ProviderPreset | null {
  if (currentPresetId === 'custom') return null
  const currentPreset = getProviderPresetById(currentPresetId)
  if (currentPreset == null) return null
  return getPresetsByVendor(currentPreset.vendorId).find((preset) => preset.provider === targetProvider) ?? null
}

function shouldDefaultOpenAiCodexResponses(apiEndpoint?: string): boolean {
  const base = apiEndpoint?.trim().replace(/\/+$/, '').toLowerCase()
  if (!base) return false
  if (base.endsWith('/api/coding')) return true
  return base === 'https://open.bigmodel.cn/api/coding/paas/v4' ||
    base === 'https://coding.dashscope.aliyuncs.com/v1' ||
    base === 'https://api.lkeap.cloud.tencent.com/coding/v3'
}

function buildAutoFetchModelsSignature(
  form: Pick<ProviderForm, 'apiKey' | 'endpoint' | 'modelType' | 'presetId' | 'provider'>,
): string | null {
  if (form.modelType !== 'multimodal') return null
  const apiKey = form.apiKey.trim()
  if (apiKey.length < 8) return null
  return [
    form.presetId,
    form.provider,
    form.endpoint.trim(),
    apiKey.length,
    apiKey.slice(-6),
  ].join('|')
}

function endsWithVersionSegment(value: string): boolean {
  const last = value.split('/').pop() ?? ''
  return /^v\d+$/i.test(last)
}

const MEDIA_PROVIDER_LABELS: Record<MediaProviderKind, string> = {
  apimart: 'APIMart',
  agnes: 'Agnes AI',
  xai: 'xAI',
  bailian: '阿里百炼',
  'openai-compatible': 'OpenAI Compatible',
  'openai-images': 'OpenAI Images',
  'google-generative-ai': 'Google Gemini / Veo',
  'volcengine-ark': 'Volcengine Ark / Seedance',
  kling: 'Kling',
  pixverse: 'PixVerse',
  'minimax-hailuo': 'MiniMax Hailuo',
  wan: 'Wan',
  happyhorse: 'HappyHorse',
  omni: 'Omni',
  midjourney: 'Midjourney 网关',
  custom: '自定义',
}

/**
 * 表单「平台适配器」下拉的可用选项。
 *
 * 只暴露有真实实现的 kind：apimart/agnes/xai 有专用 adapter；
 * bailian/openai-images/google-generative-ai/omni/midjourney/volcengine-ark/
 * kling/minimax-hailuo 有 adapter 或内置 manifest 模型；openai-compatible 是 OpenAI
 * 兼容图片兜底；custom 是自定义。
 *
 * pixverse / wan / happyhorse 这几个 kind 没有注册 adapter、没有内置 manifest
 * 模型，也没有 preset 引用——选了只会让模型清单变空、误导用户，故从下拉里剔除。
 * protocol 的 MEDIA_PROVIDER_KINDS / 联合类型保持不动，避免影响 zod schema 与既有数据。
 */
const USABLE_MEDIA_PROVIDER_KINDS: readonly MediaProviderKind[] = [
  'apimart',
  'agnes',
  'xai',
  'bailian',
  'openai-compatible',
  'openai-images',
  'google-generative-ai',
  'omni',
  'midjourney',
  'volcengine-ark',
  'kling',
  'minimax-hailuo',
  'custom',
]

const MEDIA_CAPABILITY_LABELS: Record<MediaCapabilityId, string> = {
  'image.generate': '生图',
  'image.edit': '图生图 / 图片编辑',
  'image.variations': '图片变体',
  'audio.speech': '语音合成',
  'audio.transcription': '语音转写',
  'video.generate': '文生视频',
  'video.image_to_video': '图生视频',
  'video.reference_to_video': '参考图生视频',
  'video.edit': '视频编辑',
  'video.extend': '视频扩展',
}

/** 从 imageProvider 字符串推导 mediaProvider 兜底值 */
function mediaProviderFromImageKind(imageProvider: ImageProviderKind): MediaProviderKind {
  if (imageProvider === 'apimart') return 'apimart'
  if (imageProvider === 'xai') return 'xai'
  if (imageProvider === 'bailian') return 'bailian'
  if (imageProvider === 'seeddance') return 'volcengine-ark'
  if (imageProvider === 'custom') return 'custom'
  return 'openai-compatible'
}

/** 从统一媒体 adapter 反推旧版图片接口来源，避免模板只写 mediaProvider 时回落到 openai。 */
function imageProviderFromMediaProvider(mediaProvider: string | null | undefined): ImageProviderKind | null {
  if (mediaProvider === 'apimart') return 'apimart'
  if (mediaProvider === 'xai') return 'xai'
  if (mediaProvider === 'bailian') return 'bailian'
  if (mediaProvider === 'volcengine-ark') return 'seeddance'
  if (mediaProvider === 'google-generative-ai') return 'gemini'
  if (mediaProvider === 'custom') return 'custom'
  if (mediaProvider === 'openai-compatible' || mediaProvider === 'openai-images') return 'openai'
  return null
}

function imageProviderForMediaConfig(
  imageProvider: unknown,
  mediaProvider: string | null | undefined,
): ImageProviderKind {
  const normalized = normalizeImageProvider(imageProvider)
  return normalized === 'openai'
    ? imageProviderFromMediaProvider(mediaProvider) ?? normalized
    : normalized
}

/** 是否已经配置了任意媒体字段（mediaProvider / mediaCapabilities / mediaModelRefs 任意非空即算） */
function hasAnyMediaFields(
  mediaProvider: string | null | undefined,
  mediaCapabilities: readonly unknown[] | undefined,
  mediaModelRefs: readonly unknown[] | undefined,
): boolean {
  return (typeof mediaProvider === 'string' && mediaProvider.trim().length > 0)
    || (Array.isArray(mediaCapabilities) && mediaCapabilities.length > 0)
    || (Array.isArray(mediaModelRefs) && mediaModelRefs.length > 0)
}

/** 把 preset 的 mediaProvider/mediaApiType/mediaCapabilities/mediaDefaults 投影成 ProviderForm 媒体字段 */
function presetMediaForm(preset: ProviderPreset): Pick<ProviderForm,
  | 'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaModelRefs' | 'mediaGenerationEnabled'
  | 'mediaImageSize' | 'mediaImageN' | 'mediaImageQuality'
  | 'mediaAudioVoice' | 'mediaAudioFormat'
  | 'mediaVideoAspectRatio' | 'mediaVideoDuration' | 'mediaVideoQuality'
  | 'mediaPollInterval' | 'mediaPollTimeout'> {
  const d = preset.mediaDefaults
  return {
    mediaProvider: preset.mediaProvider ?? '',
    mediaApiType: preset.mediaApiType ?? preset.imageApiType ?? 'auto',
    mediaCapabilities: preset.mediaCapabilities ?? [],
    mediaModelRefs: preset.mediaModelRefs ?? [],
    mediaGenerationEnabled: hasAnyMediaFields(preset.mediaProvider, preset.mediaCapabilities, preset.mediaModelRefs),
    mediaImageSize: d?.image?.size ?? d?.image?.aspectRatio ?? '',
    mediaImageN: d?.image?.n != null ? String(d.image.n) : '',
    mediaImageQuality: d?.image?.resolution ?? d?.image?.quality ?? '',
    mediaAudioVoice: d?.audio?.voice ?? '',
    mediaAudioFormat: d?.audio?.format ?? '',
    mediaVideoAspectRatio: d?.video?.aspectRatio ?? '',
    mediaVideoDuration: d?.video?.durationSeconds != null ? String(d.video.durationSeconds) : '',
    mediaVideoQuality: d?.video?.resolution ?? d?.video?.quality ?? '',
    mediaPollInterval: d?.polling?.intervalMs != null ? String(d.polling.intervalMs) : '',
    mediaPollTimeout: d?.polling?.timeoutMs != null ? String(d.polling.timeoutMs) : '',
  }
}

/** 把已保存 profile 的 media 字段投影成 ProviderForm 媒体字段 */
function profileMediaForm(p: ProviderProfile): Pick<ProviderForm,
  | 'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaModelRefs' | 'mediaGenerationEnabled'
  | 'mediaImageSize' | 'mediaImageN' | 'mediaImageQuality'
  | 'mediaAudioVoice' | 'mediaAudioFormat'
  | 'mediaVideoAspectRatio' | 'mediaVideoDuration' | 'mediaVideoQuality'
  | 'mediaPollInterval' | 'mediaPollTimeout'> {
  const d = p.mediaDefaults
  return {
    mediaProvider: p.mediaProvider ?? '',
    mediaApiType: p.mediaApiType ?? p.imageApiType ?? 'auto',
    mediaCapabilities: p.mediaCapabilities ?? [],
    mediaModelRefs: p.mediaModelRefs ?? [],
    mediaGenerationEnabled: hasAnyMediaFields(p.mediaProvider, p.mediaCapabilities, p.mediaModelRefs),
    mediaImageSize: d?.image?.size ?? d?.image?.aspectRatio ?? '',
    mediaImageN: d?.image?.n != null ? String(d.image.n) : '',
    mediaImageQuality: d?.image?.resolution ?? d?.image?.quality ?? '',
    mediaAudioVoice: d?.audio?.voice ?? '',
    mediaAudioFormat: d?.audio?.format ?? '',
    mediaVideoAspectRatio: d?.video?.aspectRatio ?? '',
    mediaVideoDuration: d?.video?.durationSeconds != null ? String(d.video.durationSeconds) : '',
    mediaVideoQuality: d?.video?.resolution ?? d?.video?.quality ?? '',
    mediaPollInterval: d?.polling?.intervalMs != null ? String(d.polling.intervalMs) : '',
    mediaPollTimeout: d?.polling?.timeoutMs != null ? String(d.polling.timeoutMs) : '',
  }
}

/**
 * 把 ProviderForm 的媒体字段归一成 create/update 请求中要下发的字段。
 * - 专职生图/语音/视频类型：始终下发 mediaProvider/mediaApiType/mediaCapabilities/mediaDefaults。
 * - 对话模型：仅当「附加生成能力」开关打开时才下发；关闭时主动清空（传 null/[]），
 *   避免表单里残留的旧值在关闭开关后被误保存。
 */
function buildMediaUpdateFields(form: ProviderForm): Pick<ProviderUpdateRequest,
  'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaDefaults' | 'mediaModelRefs'> {
  const shouldPersistMedia = isMediaProviderModelType(form.modelType)
    || (form.modelType === 'multimodal' && form.mediaGenerationEnabled)
  if (!shouldPersistMedia) {
    return { mediaProvider: null, mediaApiType: null, mediaCapabilities: [], mediaModelRefs: [] }
  }
  const provider = (form.mediaProvider || mediaProviderFromImageKind(form.imageProvider)) as MediaProviderKind
  const result: Pick<ProviderUpdateRequest,
    'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaDefaults' | 'mediaModelRefs'> = {
    mediaProvider: provider,
    mediaApiType: form.mediaApiType,
    mediaCapabilities: form.mediaCapabilities,
    mediaModelRefs: normalizeMediaModelRefs(form.mediaModelRefs),
  }
  const defaults = buildMediaDefaults(form)
  if (defaults) result.mediaDefaults = defaults
  return result
}

function normalizeMediaModelRefs(refs: ProviderMediaModelRef[]): ProviderMediaModelRef[] {
  const seen = new Set<string>()
  const result: ProviderMediaModelRef[] = []
  for (const ref of refs) {
    const manifestId = ref.manifestId.trim()
    if (!manifestId || seen.has(manifestId)) continue
    seen.add(manifestId)
    const next: ProviderMediaModelRef = { manifestId, enabled: ref.enabled !== false }
    if (ref.modelId?.trim()) next.modelId = ref.modelId.trim()
    if (ref.defaults !== undefined) next.defaults = ref.defaults
    if (ref.manifest !== undefined) next.manifest = ref.manifest
    result.push(next)
  }
  return result
}

/** 把 ProviderForm 中的字符串表单值归一为 ProviderMediaDefaults（空值剔除） */
function buildMediaDefaults(form: ProviderForm): ProviderMediaDefaults | undefined {
  const imageSizeValue = form.mediaImageSize.trim()
  const imageSizeField = imageSizeValue
    ? (form.mediaProvider === 'xai' || form.mediaProvider === 'minimax-hailuo') && imageSizeValue.includes(':')
      ? { aspectRatio: imageSizeValue }
      : { size: imageSizeValue }
    : {}
  const image = {
    ...imageSizeField,
    ...(form.mediaImageN.trim() ? { n: Number(form.mediaImageN) } : {}),
    ...(form.mediaImageQuality.trim()
      ? /k$/i.test(form.mediaImageQuality.trim())
        ? { resolution: form.mediaImageQuality.trim() }
        : { quality: form.mediaImageQuality.trim() }
      : {}),
  }
  const audio = {
    ...(form.mediaAudioVoice.trim() ? { voice: form.mediaAudioVoice.trim() } : {}),
    ...(form.mediaAudioFormat.trim() ? { format: form.mediaAudioFormat.trim() as 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm' } : {}),
  }
  const video = {
    ...(form.mediaVideoAspectRatio.trim() ? { aspectRatio: form.mediaVideoAspectRatio.trim() } : {}),
    ...(form.mediaVideoDuration.trim() ? { durationSeconds: Number(form.mediaVideoDuration) } : {}),
    ...(form.mediaVideoQuality.trim()
      ? /p$/i.test(form.mediaVideoQuality.trim())
        ? { resolution: form.mediaVideoQuality.trim() }
        : { quality: form.mediaVideoQuality.trim() }
      : {}),
  }
  const polling = {
    ...(form.mediaPollInterval.trim() ? { intervalMs: Number(form.mediaPollInterval) } : {}),
    ...(form.mediaPollTimeout.trim() ? { timeoutMs: Number(form.mediaPollTimeout) } : {}),
  }
  const result: ProviderMediaDefaults = {}
  if (Object.keys(image).length > 0) result.image = image
  if (Object.keys(audio).length > 0) result.audio = audio
  if (Object.keys(video).length > 0) result.video = video
  if (Object.keys(polling).length > 0) result.polling = polling
  return Object.keys(result).length > 0 ? result : undefined
}

function mediaModelMatchesType(model: CanvasMediaModelSummary, modelType: ProviderModelType): boolean {
  if (modelType === 'image') {
    return model.domains.includes('image') || model.capabilities.some((capability) => capability.id.startsWith('image.'))
  }
  if (modelType === 'voice') {
    return model.domains.includes('audio') || model.capabilities.some((capability) => capability.id.startsWith('audio.'))
  }
  if (modelType === 'video') {
    return model.domains.includes('video') || model.capabilities.some((capability) => capability.id.startsWith('video.'))
  }
  if (modelType === 'multimodal') {
    return model.domains.some((domain) => domain === 'image' || domain === 'audio' || domain === 'video')
      || model.capabilities.some((capability) =>
        capability.id.startsWith('image.') || capability.id.startsWith('audio.') || capability.id.startsWith('video.'),
      )
  }
  return false
}

function isMediaProviderModelType(modelType: ProviderModelType): boolean {
  return modelType === 'image' || modelType === 'voice' || modelType === 'video'
}

function supportsMediaConfigModelType(modelType: ProviderModelType): boolean {
  return isMediaProviderModelType(modelType) || modelType === 'multimodal'
}

/**
 * 兼容历史数据：早期版本里「文本」和「多模态」是两个独立选项，现已合并为「对话模型」（存储字面量仍是 'multimodal'）。
 * 读入旧 profile/preset 时把遗留的 'text' 归一成 'multimodal'，避免下拉框回显成不匹配任何选项的空白。
 */
function normalizeLegacyModelType(value: unknown): ProviderModelType {
  if (value === 'text') return 'multimodal'
  return (value as ProviderModelType | undefined) ?? 'multimodal'
}

function hasConfiguredMediaStack(
  modelType: ProviderModelType,
  mediaProvider: string | null | undefined,
  mediaCapabilities: readonly unknown[] | undefined,
  mediaModelRefs: readonly unknown[] | undefined,
): boolean {
  return supportsMediaConfigModelType(modelType)
    && hasAnyMediaFields(mediaProvider, mediaCapabilities, mediaModelRefs)
}

function mediaModelMatchesProvider(model: CanvasMediaModelSummary, form: ProviderForm): boolean {
  const candidates = new Set<string>()
  if (form.mediaProvider) candidates.add(form.mediaProvider)
  candidates.add(mediaProviderFromImageKind(form.imageProvider))
  candidates.add(form.imageProvider)
  if (form.imageProvider === 'gemini') candidates.add('google')
  if (form.imageProvider === 'seeddance') candidates.add('volcengine')
  if (form.mediaProvider === 'openai-compatible') candidates.add('openai')
  if (form.mediaProvider === 'custom') return true
  return candidates.has(model.providerKind)
}

/** 自定义模型 manifestId 前缀：不匹配内置目录，不会在 mediaCatalogForForm 中出现，单独渲染。 */
const CUSTOM_MODEL_REF_PREFIX = 'custom:'

/** 自定义模型引用：manifestId 以 custom: 开头、携带用户填写的 modelId。 */
interface CustomMediaModelRef {
  manifestId: string
  modelId: string
}

function isCustomModelRef(ref: ProviderMediaModelRef): ref is ProviderMediaModelRef & CustomMediaModelRef {
  return ref.manifestId.startsWith(CUSTOM_MODEL_REF_PREFIX)
}

/** 按模型类型推导自定义模型声明的多媒体能力（内置目录 manifest 自带能力，无需推导）。 */
function capabilitiesForModelType(modelType: ProviderModelType): MediaCapabilityId[] {
  if (modelType === 'image') return ['image.generate', 'image.edit']
  if (modelType === 'voice') return ['audio.speech', 'audio.transcription']
  if (modelType === 'video') return ['video.generate', 'video.image_to_video', 'video.reference_to_video', 'video.edit', 'video.extend']
  return []
}

function adapterKindFromManifestProvider(providerKind: string): MediaProviderKind {
  if (isMediaProviderKind(providerKind)) return providerKind
  if (providerKind === 'apimart') return 'apimart'
  if (providerKind === 'xai') return 'xai'
  if (providerKind === 'custom') return 'custom'
  return 'openai-compatible'
}

function vendorForMediaProvider(kind: string | undefined): VendorMeta | null {
  if (!kind) return null
  if (kind === 'agnes') return getVendorMeta('agnes-ai') ?? null
  if (kind === 'bailian') return getVendorMeta('bailian') ?? null
  if (kind === 'kling') return getVendorMeta('kuaishou') ?? null
  if (kind === 'minimax-hailuo') return getVendorMeta('minimax') ?? null
  if (kind === 'volcengine-ark') return getVendorMeta('volcengine') ?? null
  if (kind === 'google-generative-ai') return getVendorMeta('google-gemini') ?? null
  if (kind === 'apimart' || kind === 'xai' || kind === 'openrouter') return getVendorMeta(kind) ?? null
  return null
}

function mediaProviderDisplayName(kind: string | undefined): string {
  if (!kind) return '多媒体适配器'
  return MEDIA_PROVIDER_LABELS[kind as MediaProviderKind] ?? kind
}

function enumOptionsFromModels(
  models: CanvasMediaModelSummary[],
  fieldNames: string[],
): Array<{ label: string; value: string }> {
  const values = new Set<string>()
  for (const model of models) {
    for (const capability of model.capabilities) {
      const properties = capability.paramSchema?.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue
      for (const name of fieldNames) {
        const spec = (properties as Record<string, unknown>)[name]
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue
        const rawEnum = (spec as Record<string, unknown>).enum
        if (Array.isArray(rawEnum)) {
          rawEnum
            .filter((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            .forEach((value) => values.add(String(value)))
        }
        const defaultValue = (spec as Record<string, unknown>).default
        if (typeof defaultValue === 'string' || typeof defaultValue === 'number' || typeof defaultValue === 'boolean') {
          values.add(String(defaultValue))
        }
      }
    }
  }
  return [...values].map((value) => ({ label: value, value }))
}

/**
 * 卡片类型分类（与筛选下拉/右上角 tag 共用口径）。
 *
 * 判定优先级：router（自动路由虚拟项）→ cli（内置本地 CLI）→ 媒体（image/video/voice）→ text。
 * 一张卡片只归一类，避免与「默认 Provider」「内置」等已有 tag 语义重叠。
 */
/** 每个类别对应的图标（项目本地 Lucide 风格）、文案、胶囊 CSS 修饰类 */
const CARD_KIND_META: Record<ProviderCardKind, { label: string; icon: ComponentType<{ size?: number }>; kindClass: string }> = {
  router: { label: '路由', icon: Icons.Shuffle, kindClass: 'pv_kind--router' },
  cli: { label: 'CLI', icon: Icons.Terminal, kindClass: 'pv_kind--cli' },
  image: { label: '图片', icon: Icons.Image, kindClass: 'pv_kind--image' },
  video: { label: '视频', icon: Icons.Film, kindClass: 'pv_kind--video' },
  voice: { label: '语音', icon: Icons.Mic, kindClass: 'pv_kind--voice' },
  text: { label: '通用模型', icon: Icons.Chat, kindClass: 'pv_kind--text' },
}

/** 筛选下拉里与 CARD_KIND_META 对齐的类别选项（不含 'all'） */
const CARD_KIND_FILTER_OPTIONS: Array<{ value: ProviderCardKind; label: string }> = [
  { value: 'text', label: '通用模型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'voice', label: '语音' },
  { value: 'cli', label: 'CLI' },
  { value: 'router', label: '路由' },
]

/** 名称排序用的中文 collator（模块级单例，避免每次排序重新构造） */
const NAME_COLLATOR = new Intl.Collator('zh-Hans', { sensitivity: 'base' })

/** 排序时是否「钉在最前」：内置的 router / cli 项始终优先于自定义项 */
function isBuiltInPinned(profile: ProviderProfile): boolean {
  return isAutoRouterProvider(profile) || isBuiltInLocalCliProvider(profile)
}

export function sortProviderProfilesForCards(
  profiles: ProviderProfile[],
  sortBy: 'default' | 'nameAsc' | 'nameDesc',
): ProviderProfile[] {
  return [...profiles].sort((a, b) => {
    const aManaged = a.managed === true
    const bManaged = b.managed === true
    if (aManaged !== bManaged) return aManaged ? -1 : 1
    if (aManaged || sortBy === 'default') return 0
    const aPinned = isBuiltInPinned(a)
    const bPinned = isBuiltInPinned(b)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    if (aPinned) return 0
    const cmp = NAME_COLLATOR.compare(a.name, b.name)
    return sortBy === 'nameAsc' ? cmp : -cmp
  })
}

/**
 * 推导一张 Provider 卡片归属的类型（用于右上角 tag + 筛选）。
 *
 * router / cli 优先级最高（它们是按 id 判定的内置项，modelType 不可靠）；
 * 之后看 modelType 媒体维度；其余统一归为对话/文本模型。
 */
export function resolveProviderCardKind(profile: ProviderProfile): ProviderCardKind {
  if (isAutoRouterProvider(profile)) return 'router'
  if (isBuiltInLocalCliProvider(profile)) return 'cli'
  const modelType = normalizeLegacyModelType(profile.modelType)
  if (modelType === 'image') return 'image'
  if (modelType === 'video') return 'video'
  if (modelType === 'voice') return 'voice'
  return 'text'
}

const EMPTY_TIER_MODELS = { haikuModel: '', sonnetModel: '', opusModel: '' } as const
const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageProviderKind; label: string; endpoint: string; mode: ImageGenApiType }> = [
  { value: 'openai', label: 'OpenAI Images', endpoint: 'https://api.openai.com/v1', mode: 'sync' },
  { value: 'apimart', label: 'APIMart', endpoint: 'https://api.apimart.ai/v1', mode: 'async' },
  { value: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', mode: 'sync' },
  { value: 'gemini', label: 'Gemini / Imagen', endpoint: 'https://generativelanguage.googleapis.com/v1beta', mode: 'sync' },
  { value: 'seeddance', label: 'Seedream / Seedance', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', mode: 'sync' },
  { value: 'bailian', label: '阿里百炼', endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc', mode: 'async' },
  { value: 'zhipu', label: '智谱 GLM Image', endpoint: 'https://open.bigmodel.cn/api/paas/v4', mode: 'sync' },
  { value: 'xai', label: 'xAI Imagine', endpoint: 'https://api.x.ai/v1', mode: 'sync' },
  { value: 'custom', label: '自定义兼容接口', endpoint: '', mode: 'sync' },
]

function normalizeImageProvider(value: unknown): ImageProviderKind {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return IMAGE_PROVIDER_OPTIONS.some((option) => option.value === normalized)
    ? normalized as ImageProviderKind
    : 'openai'
}

function normalizeImageApiType(value: unknown): ImageGenApiType {
  return value === 'async' || value === 'auto' ? value : 'sync'
}

function imageProviderDefaults(provider: ImageProviderKind): { endpoint: string; mode: ImageGenApiType } {
  const option = IMAGE_PROVIDER_OPTIONS.find((item) => item.value === provider)
  return { endpoint: option?.endpoint ?? '', mode: option?.mode ?? 'sync' }
}

function ProvidersView() {
  const { setTweak, t, requestConfirm } = useApp()
  const { toast } = useToast()
  const showProviderEdit = t.showProviderEdit
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [managedEditingProfile, setManagedEditingProfile] = useState<ProviderProfile | null>(null)
  const [healthMap, setHealthMap] = useState<Record<string, ProviderHealthCheckResponse>>({})
  const [showPresetCatalog, setShowPresetCatalog] = useState(false)
  const [showRouteModels, setShowRouteModels] = useState(false)
  const [presetCatalogSearch, setPresetCatalogSearch] = useState('')
  /** 从预设创建时，传递给 ProviderEditPanel 的初始 presetId */
  const [initialPresetId, setInitialPresetId] = useState<string | null>(null)

  // ─── 卡片筛选 / 排序 状态 ───────────────────────────────────────────────
  const [cardSearch, setCardSearch] = useState('')
  const [cardKindFilter, setCardKindFilter] = useState<'all' | ProviderCardKind>('all')
  const [cardSortBy, setCardSortBy] = useState<'default' | 'nameAsc' | 'nameDesc'>('default')

  // ─── 多选 / 导入 / 导出 状态 ─────────────────────────────────────────────
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [importPreview, setImportPreview] = useState<{
    payload: ProviderExportPayload
    filePath: string
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const importButtonRef = useRef<HTMLButtonElement>(null)

  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listModels } = useIpcInvoke('model:list')
  const { invoke: deleteProvider } = useIpcInvoke('provider:delete')
  const { invoke: healthCheck } = useIpcInvoke('provider:health-check')
  const { invoke: exportProviders } = useIpcInvoke('provider:export')
  const { invoke: importProviders } = useIpcInvoke('provider:import')
  const { invoke: exportProvidersToFile } = useIpcInvoke('provider:export-to-file')
  const { invoke: importProvidersFromFile } = useIpcInvoke('provider:import-from-file')

  // 进入多选模式时，清空旧选择
  const enterMultiSelect = useCallback(() => {
    setMultiSelect(true)
    setSelectedIds(new Set())
  }, [])
  const exitMultiSelect = useCallback(() => {
    setMultiSelect(false)
    setSelectedIds(new Set())
  }, [])

  const refresh = useCallback(() => {
    Promise.all([listProviders({}), listModels({})])
      .then(([providerRes, modelRes]) => {
        setProfiles(providerRes.profiles)
        setModelProfiles(modelRes.models)
      })
      .catch(console.error)
  }, [listModels, listProviders])

  useRefreshable(refresh)

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return window.spark?.on?.('stream:config:changed', (event) => {
      if (event.scope === 'provider' || event.scope === 'model') refresh()
    }) ?? (() => {})
  }, [refresh])

  const handleDelete = async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除 Provider？',
      description: '删除后该模型供应商配置会从本地移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteProvider({ id })
      toast.success('Provider 已删除')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleHealthCheck = async (id: string) => {
    try {
      const r = await healthCheck({ id })
      setHealthMap((prev) => ({ ...prev, [id]: r }))
      if (r.healthy) {
        toast.success(`连接成功${r.latencyMs != null ? ` · 延迟 ${r.latencyMs}ms` : ''}`)
      } else {
        toast.error('连接失败：Provider 返回不健康状态')
      }
    } catch (err) {
      setHealthMap((prev) => ({ ...prev, [id]: { healthy: false } }))
      toast.error(err instanceof Error ? err.message : '连接测试失败')
    }
  }

  // ─── 多选切换 ─────────────────────────────────────────────────────────────
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(profiles.filter((p) => !isBuiltInLocalCliProvider(p) && !isAutoRouterProvider(p)).map((p) => p.id)))
  }, [profiles])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const invertSelection = useCallback(() => {
    setSelectedIds((prev) => {
    const next = new Set<string>()
    for (const p of profiles) {
      if (isBuiltInLocalCliProvider(p) || isAutoRouterProvider(p)) continue
      if (!prev.has(p.id)) next.add(p.id)
    }
      return next
    })
  }, [profiles])

  // ─── 批量删除 ─────────────────────────────────────────────────────────────
  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return
    const confirmed = await requestConfirm({
      title: `删除 ${selectedIds.size} 个 Provider？`,
      description: '此操作不可撤销，选中的模型供应商配置会从本地移除。',
      confirmText: '批量删除',
      danger: true,
    })
    if (!confirmed) return
    let ok = 0
    const errs: string[] = []
    for (const id of selectedIds) {
      if (isBuiltInLocalCliProvider({ id }) || isAutoRouterProvider(id)) continue
      try {
        await deleteProvider({ id })
        ok += 1
      } catch (err) {
        const name = profiles.find((p) => p.id === id)?.name ?? id
        errs.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (ok > 0) toast.success(`已删除 ${ok} 个 Provider`)
    if (errs.length > 0) toast.error(`${errs.length} 个删除失败：${errs.slice(0, 2).join('；')}`)
    clearSelection()
    refresh()
  }, [selectedIds, requestConfirm, deleteProvider, profiles, toast, clearSelection, refresh])

  // ─── 导出 ─────────────────────────────────────────────────────────────────
  /**
   * 弹保存对话框写文件。空 ids 表示导出全部。
   */
  const handleExportToFile = useCallback(
    async (ids: string[]) => {
      try {
        const result = await exportProvidersToFile({ ids })
        if (!result.filePath) {
          // 用户取消
          return
        }
        toast.success(`已导出 ${result.count} 个 Provider`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导出失败')
      }
    },
    [exportProvidersToFile, toast],
  )

  const handleExportSelected = useCallback(() => {
    handleExportToFile(Array.from(selectedIds))
  }, [handleExportToFile, selectedIds])

  const handleExportVisibleScope = useCallback(() => {
    handleExportToFile(multiSelect ? Array.from(selectedIds) : [])
  }, [handleExportToFile, multiSelect, selectedIds])

  /**
   * 拿到 ExportPayload 并复制到剪贴板（次要入口，不写文件）。
   */
  const handleCopyToClipboard = useCallback(
    async (ids: string[]) => {
      try {
        const { payload } = await exportProviders({ ids })
        const json = JSON.stringify(payload, null, 2)
        await navigator.clipboard.writeText(json)
        toast.success(`已复制 ${payload.profiles.length} 个 Provider 到剪贴板`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '复制失败')
      }
    },
    [exportProviders, toast],
  )

  // ─── 导入 ─────────────────────────────────────────────────────────────────
  /**
   * 弹打开对话框读文件 → 解析 → 弹预览 Modal 让用户确认。
   */
  const handleImportFromFile = useCallback(async () => {
    try {
      const { payload, filePath } = await importProvidersFromFile({})
      if (payload == null) {
        // 用户取消
        return
      }
      setImportPreview({ payload, filePath })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    }
  }, [importProvidersFromFile, toast])

  /**
   * 从剪贴板读取 JSON 字符串并解析为 payload。
   */
  const handleImportFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.warning('剪贴板为空')
        return
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`剪贴板 JSON 解析失败：${message}`)
        return
      }
      // 走与 file 相同的预览流程
      const { ProviderExportPayloadSchema } = await import('@spark/protocol')
      const parsed = ProviderExportPayloadSchema.parse(json)
      setImportPreview({ payload: parsed, filePath: '从剪贴板' })
    } catch (err) {
      // Zod 校验失败
      toast.error(err instanceof Error ? err.message : '剪贴板内容不是有效的导出文件')
    }
  }, [toast])

  /**
   * 预览确认后的写入操作。
   */
  const handleImportConfirm = useCallback(
    async (payload: ProviderExportPayload, mode: ProviderImportMode) => {
      setImporting(true)
      try {
        const result = await importProviders({ payload, mode })
        const parts: string[] = []
        if (result.imported > 0) parts.push(`导入 ${result.imported}`)
        if (result.skipped > 0) parts.push(`跳过 ${result.skipped}`)
        if (parts.length > 0) {
          toast.success(parts.join('，'))
        } else if (result.errors.length === 0) {
          toast.info('无 profile 被导入')
        }
        if (result.errors.length > 0) {
          toast.error(`${result.errors.length} 个失败：${result.errors.slice(0, 2).join('；')}`)
        }
        setImportPreview(null)
        // 关闭预览后焦点回到导入按钮（无障碍）
        requestAnimationFrame(() => importButtonRef.current?.focus())
        refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入失败')
      } finally {
        setImporting(false)
      }
    },
    [importProviders, refresh, toast],
  )

  /** 已有 name 集合：用于预览时标记冲突 */
  const existingNamesForPreview = useMemo(
    () => new Set(profiles.map((p) => p.name)),
    [profiles],
  )

  /**
   * 按搜索关键字 / 类型筛选 / 排序 后用于渲染的 profiles。
   *
   * - 类型过滤：'all' 放行，否则按 resolveProviderCardKind 精确匹配。
   * - 名称模糊匹配：trim+lowercase 的 includes，空串放行。
   * - 排序：平台受管项始终最前；'default' 下其余项保持原序；nameAsc/nameDesc
   *   下 router/cli 内置项其次，其他项按名称排序。
   */
  const visibleProfiles = useMemo(() => {
    const keyword = cardSearch.trim().toLowerCase()
    const filtered = profiles.filter((p) => {
      if (cardKindFilter !== 'all' && resolveProviderCardKind(p) !== cardKindFilter) return false
      if (keyword && !p.name.toLowerCase().includes(keyword)) return false
      return true
    })
    return sortProviderProfilesForCards(filtered, cardSortBy)
  }, [profiles, cardSearch, cardKindFilter, cardSortBy])

  /** 点击 vendor 卡片 → 直接以 Anthropic 格式打开编辑面板 */
  const handleSelectVendor = (vendorId: string) => {
    const presets = getPresetsByVendor(vendorId)
    // 优先查找 anthropic 格式，否则取第一个
    const preset = presets.find((p) => p.provider === 'anthropic') ?? presets[0]
    if (preset) {
      setInitialPresetId(preset.id)
      setEditingId(null)
      setShowPresetCatalog(false)
      setTweak('showProviderEdit', true)
    }
  }

  const filteredPresetVendors = useMemo(() => {
    const keyword = presetCatalogSearch.trim().toLowerCase()
    return getUniqueVendorIds()
      .map((vendorId) => getVendorMeta(vendorId))
      .filter((meta): meta is VendorMeta => meta != null)
      .filter((meta) => {
        if (!keyword) return true
        return [meta.id, meta.name, meta.desc].some((value) =>
          value.toLowerCase().includes(keyword),
        )
      })
  }, [presetCatalogSearch])

  return (
    <>
      <div className="pv_root">
        {/* ─── Header ─── */}
        <div className="pv_header">
          <div className="pv_header_left">
            <h2>Providers</h2>
            <Tag size="middle" color="gray">{profiles.length}</Tag>
          </div>
          <div className="pv_header_right">

            <span className="flex-1" />
            <Button
              size="middle"
              shape="circle"
              type="text"
              icon={<Icons.Refresh />}
              onClick={refresh}
              title="刷新 (Ctrl+R)"
              aria-label="刷新"
            />
            <Button
              ref={importButtonRef as any}
              size="middle"
              type="text"
              icon={<Icons.Upload />}
              onClick={() => void handleImportFromFile()}
              disabled={importing}
              title="从 .json 导入 Provider 配置"
            >
              导入
            </Button>
            {/* <Button
              size="middle"
              type="text"
              icon={<Icons.Copy />}
              onClick={() => void handleImportFromClipboard()}
              disabled={importing}
              title="从剪贴板 JSON 字符串导入"
            >
              从剪贴板
            </Button> */}
            <Button
              size="middle"
              type="text"
              icon={<Icons.Download />}
              onClick={handleExportVisibleScope}
              disabled={profiles.length === 0 || (multiSelect && selectedIds.size === 0)}
              title={multiSelect ? '导出选中的 Provider 到 .json' : '导出全部 Provider 到 .json'}
            >
              {multiSelect ? '导出选中' : '导出'}
            </Button>
            {/* <Button
              size="middle"
              type="text"
              icon={<Icons.Copy />}
              onClick={() => void handleCopyToClipboard([])}
              disabled={profiles.length === 0}
              title="复制全部 Provider JSON 到剪贴板"
            >
              复制
            </Button> */}
            {!multiSelect && (
              <Button
                size="middle"
                type="text"
                icon={<Icons.CheckSquare />}
                onClick={enterMultiSelect}
                disabled={profiles.length === 0}
                title="进入多选模式"
              >
                批量
              </Button>
            )}
            <Button
              size="middle"
              type={showPresetCatalog ? 'primary' : 'default'}
              icon={<Icons.Plus />}
              onClick={() => {
                setPresetCatalogSearch('')
                setShowPresetCatalog(true)
              }}
            >
              从模板添加
            </Button>
            <Button
              size="middle"
              type={showRouteModels ? 'primary' : 'default'}
              icon={<Icons.Shuffle />}
              onClick={() => setShowRouteModels(true)}
              title="配置 Claude / Codex 自动路由模型卡"
            >
              自动路由
            </Button>
            <Button
              size="middle"
              type="primary"
              icon={<Icons.Plus />}
              onClick={() => {
                setEditingId(null)
                setInitialPresetId(null)
                setTweak('showProviderEdit', true)
              }}
            >
              自定义添加
            </Button>
          </div>
        </div>

        {/* ─── 多选模式工具栏 ─── */}
        {multiSelect && (
          <MultiSelectToolbar
            selectedCount={selectedIds.size}
            totalCount={profiles.length}
            hasSelection={selectedIds.size > 0}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onInvertSelection={invertSelection}
            onExitMultiSelect={exitMultiSelect}
            onExportSelected={handleExportSelected}
            onDeleteSelected={() => void handleDeleteSelected()}
            deleting={importing}
          />
        )}

        {/* ─── 筛选 / 排序 工具栏（非多选模式才显示，避免与批量工具栏争抢空间） ─── */}
        {!multiSelect && profiles.length > 0 && (
          <div className="pv_filters">
            <Input
              className="pv_filters_search"
              size="middle"
              placeholder="搜索 Provider 名称…"
              value={cardSearch}
              onChange={(e) => setCardSearch(e.target.value)}
              prefix={<Icons.Search size={14} />}
              allowClear
            />
            <Select
              className="pv_filters_select"
              size="middle"
              value={cardKindFilter}
              onChange={(v) => setCardKindFilter(v as 'all' | ProviderCardKind)}
              options={[
                { value: 'all', label: '全部类型' },
                ...CARD_KIND_FILTER_OPTIONS,
              ]}
            />
            <Select
              className="pv_filters_select"
              size="middle"
              value={cardSortBy}
              onChange={(v) => setCardSortBy(v as 'default' | 'nameAsc' | 'nameDesc')}
              options={[
                { value: 'default', label: '默认排序' },
                { value: 'nameAsc', label: '名称 A→Z' },
                { value: 'nameDesc', label: '名称 Z→A' },
              ]}
            />
            <span className="pv_filters_count">{visibleProfiles.length}/{profiles.length}</span>
          </div>
        )}

        {/* ─── 可滚动内容区（catalog + cards / empty） ─── */}
        <div className="pv_scroll">
          {profiles.length === 0 ? (
            <div className="pv_empty">
              尚未配置 Provider — 点击「从模板添加」快速开始，或「自定义添加」手动配置
            </div>
          ) : visibleProfiles.length === 0 ? (
            <div className="pv_empty">
              没有匹配的 Provider — 调整搜索关键字或类型筛选试试
            </div>
          ) : (
            <div className="pv_grid">
              {visibleProfiles.map((p) => {
                const h = healthMap[p.id]
                const status = h == null ? 'unknown' : h.healthy ? 'ok' : 'error'
                const vendor =
                  resolveManagedPlatformVendor(p) ??
                  resolveAutoRouterVendor(p) ??
                  resolveBuiltinLocalCliVendor(p) ??
                  vendorForMediaProvider(p.mediaProvider ?? p.imageProvider ?? undefined) ??
                  guessVendorByName(p.name, getUniqueVendorIds()) ??
                  (p.provider === 'openai' ? OPENAI_VENDOR_META : CLAUDE_VENDOR_META)
                const builtin = isBuiltInLocalCliProvider(p) || isAutoRouterProvider(p)
                const builtinDesc = isAutoRouterProvider(p)
                  ? '内置 · 虚拟自动路由 Provider'
                  : isLocalCodexCliProvider(p)
                    ? '内置 · 沿用宿主机本地 Codex CLI 配'
                    : '内置 · 沿用宿主机本地 Claude CLI 配置'
                // 媒体 Provider 卡片应展示真正配置的 mediaModelRefs，而非旧版/模板预填的 modelIds。
                const profileModelType = normalizeLegacyModelType(p.modelType)
                const isMediaProvider = hasConfiguredMediaStack(
                  profileModelType,
                  p.mediaProvider ?? null,
                  p.mediaCapabilities,
                  p.mediaModelRefs,
                )
                const mediaModelChips = isMediaProvider
                  ? (p.mediaModelRefs ?? [])
                      .filter((ref) => ref.enabled !== false)
                      .map((ref) => (ref.modelId ?? '').trim() || ref.manifestId.replace(/^custom:/, ''))
                      .filter((id) => id.length > 0)
                  : null
                const cardModelIds =
                  mediaModelChips && mediaModelChips.length > 0 ? mediaModelChips : p.modelIds
                return (
                  <ProviderCardX
                    key={p.id}
                    vendor={vendor}
                    icon={p.managed ? null : resolveProviderIconForProfile(p, vendor)}
                    name={p.name}
                    desc={
                      p.managed
                        ? `平台官方 · 默认 ${p.defaultModel} · 与第三方 Provider 并存`
                        : builtin
                        ? builtinDesc
                        : isMediaProvider
                          ? `${mediaProviderDisplayName(p.mediaProvider ?? p.imageProvider ?? undefined)} · 默认 ${p.defaultModel}`
                          : `${p.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'} · 默认 ${p.defaultModel}`
                    }
                    status={status}
                    modelIds={builtin ? [] : cardModelIds}
                    defaultModel={p.defaultModel}
                    isBuiltin={builtin}
                    isManaged={p.managed === true}
                    isDefault={p.isDefault}
                    cardKind={resolveProviderCardKind(p)}
                    multiSelect={multiSelect && !builtin && p.managed !== true}
                    selected={selectedIds.has(p.id)}
                    canHealthCheck={canHealthCheckProviderCardKind(resolveProviderCardKind(p))}
                    onToggleSelect={() => toggleSelected(p.id)}
                    onEdit={() => {
                      if (p.managed) setManagedEditingProfile(p)
                      else {
                        setEditingId(p.id)
                        setTweak('showProviderEdit', true)
                      }
                    }}
                    onDelete={() => void handleDelete(p.id)}
                    onHealthCheck={() => void handleHealthCheck(p.id)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={showPresetCatalog}
        title={
          <div className="pv_catalog_title">
            <Icons.Database size={16} />
            <span>从模板添加 Provider</span>
          </div>
        }
        onCancel={() => setShowPresetCatalog(false)}
        footer={null}
        style={{ width: 800 }}
        destroyOnHidden
      >
        <div className="pv_catalog pv_catalog_modal">
          <div className="pv_catalog_hint">
            选择供应商模板快速配置，选择后会打开新建面板，所有字段都可以继续自定义。
          </div>
          <Input
            className="pv_catalog_search"
            size="middle"
            placeholder="搜索模板厂商..."
            value={presetCatalogSearch}
            onChange={(event) => setPresetCatalogSearch(event.target.value)}
            prefix={<Icons.Search size={14} />}
            allowClear
          />
          {filteredPresetVendors.length > 0 ? (
            <div className="pv_catalog_grid">
              {filteredPresetVendors.map((vendor) => (
                <VendorPresetCard
                  key={vendor.id}
                  vendor={vendor}
                  onSelectVendor={handleSelectVendor}
                />
              ))}
            </div>
          ) : (
            <div className="pv_catalog_empty">
              没有找到匹配的模板厂商
            </div>
          )}
        </div>
      </Modal>

      <RouteModelManagerModal
        open={showRouteModels}
        providers={profiles}
        models={modelProfiles}
        onClose={() => setShowRouteModels(false)}
        onChanged={refresh}
      />

      {managedEditingProfile ? (
        <ManagedModelPreferencesModal
          key={managedEditingProfile.id}
          profile={managedEditingProfile}
          onClose={() => setManagedEditingProfile(null)}
          onSaved={refresh}
        />
      ) : null}

      {/* Provider 编辑面板 */}
      {showProviderEdit && (
        <ProviderEditPanel
          visible
          profileId={editingId}
          initialPresetId={initialPresetId}
          onClose={() => {
            setTweak('showProviderEdit', false)
            setInitialPresetId(null)
            refresh()
          }}
        />
      )}

      {/* 导入预览 Modal */}
      {importPreview && (
        <ImportPreviewModal
          payload={importPreview.payload}
          filePath={importPreview.filePath}
          existingNames={existingNamesForPreview}
          onConfirm={handleImportConfirm}
          onClose={() => {
            setImportPreview(null)
            // 关闭后焦点回到导入按钮
            requestAnimationFrame(() => importButtonRef.current?.focus())
          }}
        />
      )}
    </>
  )
}

/**
 * 根据已配置 Provider 名称反推 vendor（仅用于 logo 渲染）
 *
 * 名称匹配的优先级：
 *   1. 精确匹配 vendor.name
 *   2. 否则取 catalog 中 name 包含 / 被包含 的第一项
 *   3. 否则返回 null（fallback 到字母）
 */
function guessVendorByName(name: string, vendorIds: string[]): VendorMeta | null {
  for (const id of vendorIds) {
    const meta = getVendorMeta(id)
    if (!meta) continue
    if (meta.name === name) return meta
  }
  for (const id of vendorIds) {
    const meta = getVendorMeta(id)
    if (!meta) continue
    if (name.includes(meta.name) || meta.name.includes(name)) return meta
  }
  return null
}

/**
 * 内置本地 CLI provider 的合成 vendor（id 对齐 ProviderLogo 的 AVATAR 映射）。
 *
 * 这两个 provider 不在 VENDOR_CATALOG 里（它们是内置项、无 API Key、无 logoPath），
 * 所以无法通过 guessVendorByName 命中。这里用固定 id 让 ProviderLogo 渲染
 * @lobehub/icons 的 ClaudeCode / Codex 图标。
 */
const LOCAL_CLAUDE_CLI_VENDOR: VendorMeta = {
  id: 'local-claude-cli',
  name: '本地 Claude CLI',
  emoji: 'CC',
  color: '#d97757',
  desc: '',
  logoPath: '',
}

const LOCAL_CODEX_CLI_VENDOR: VendorMeta = {
  id: 'local-codex-cli',
  name: '本地 Codex CLI',
  emoji: 'CX',
  color: '#10a37f',
  desc: '',
  logoPath: '',
}

const SPARK_PLATFORM_VENDOR: VendorMeta = {
  id: 'spark-platform',
  name: 'Spark 平台模型',
  emoji: 'SP',
  color: '#ffffff',
  desc: '',
  logoPath: 'providers/spark-platform.png',
}

function resolveManagedPlatformVendor(provider: ProviderProfile): VendorMeta | null {
  return provider.managed === true ? SPARK_PLATFORM_VENDOR : null
}

/**
 * 协议格式官方图标（无匹配供应商 / 自定义模式下按当前 provider 格式回退显示）。
 * id 对齐 ProviderLogo 的 VENDOR_AVATAR_MAP，渲染 @lobehub/icons 的彩色图标：
 *   - openai 格式 → OpenAI 图标
 *   - anthropic 格式 → Claude 图标
 */
const OPENAI_VENDOR_META: VendorMeta = {
  id: 'openai',
  name: 'OpenAI',
  emoji: 'OA',
  color: '#10a37f',
  desc: '',
  logoPath: '',
}

const CLAUDE_VENDOR_META: VendorMeta = {
  id: 'claude',
  name: 'Claude',
  emoji: 'CL',
  color: '#d97757',
  desc: '',
  logoPath: '',
}

const DEFAULT_PROVIDER_ICON: ProviderIconConfig = { id: 'claude', style: 'avatar' }

function providerIconFromVendorId(vendorId: string | undefined | null): ProviderIconConfig {
  return getProviderIconForVendor(vendorId) ?? DEFAULT_PROVIDER_ICON
}

function providerIconForPreset(preset: ProviderPreset): ProviderIconConfig {
  return providerIconFromVendorId(preset.vendorId)
}

function resolveProviderIconForProfile(provider: ProviderProfile, vendor: VendorMeta | null): ProviderIconConfig {
  return normalizeProviderIconConfig(provider.providerIcon) ??
    providerIconFromVendorId(vendor?.id ?? (provider.provider === 'openai' ? 'openai' : 'claude'))
}

const CLAUDE_AUTO_ROUTER_VENDOR: VendorMeta = {
  id: 'claude-auto-router',
  name: CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  emoji: 'AR',
  color: '#d97757',
  desc: '',
  logoPath: '',
}

const CODEX_AUTO_ROUTER_VENDOR: VendorMeta = {
  id: 'codex-auto-router',
  name: CODEX_AUTO_ROUTER_PROVIDER_NAME,
  emoji: 'AR',
  color: '#10a37f',
  desc: '',
  logoPath: '',
}

function resolveAutoRouterVendor(provider: ProviderProfile): VendorMeta | null {
  if (!isAutoRouterProvider(provider)) return null
  return isClaudeAutoRouterProvider(provider) ? CLAUDE_AUTO_ROUTER_VENDOR : CODEX_AUTO_ROUTER_VENDOR
}

/**
 * 内置本地 CLI provider → 合成 vendor（用于 logo 渲染）；其余返回 null 走原有 name 匹配。
 */
function resolveBuiltinLocalCliVendor(provider: ProviderProfile): VendorMeta | null {
  if (!isBuiltInLocalCliProvider(provider)) return null
  return isLocalCodexCliProvider(provider) ? LOCAL_CODEX_CLI_VENDOR : LOCAL_CLAUDE_CLI_VENDOR
}

/* ─── VENDOR PRESET CARD（模板目录卡片） ─── */
function VendorPresetCard({
  vendor,
  onSelectVendor,
}: {
  vendor: VendorMeta
  onSelectVendor: (vendorId: string) => void
}) {
  return (
    <div
      className="pv_vendor_card"
      onClick={() => onSelectVendor(vendor.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectVendor(vendor.id)
        }
      }}
    >
      <ProviderLogo vendor={vendor} size={36} shape="rounded" />
      <div className="pv_vendor_info">
        <div className="pv_vendor_name">
          {vendor.name}
        </div>
        <div className="pv_vendor_desc">{vendor.desc}</div>
      </div>
    </div>
  )
}

function ProviderCardX({
  vendor,
  icon,
  name,
  desc,
  status,
  modelIds,
  defaultModel,
  isBuiltin = false,
  isManaged = false,
  isDefault = false,
  cardKind,
  multiSelect = false,
  selected = false,
  canHealthCheck = true,
  onToggleSelect,
  onEdit,
  onDelete,
  onHealthCheck,
}: {
  vendor: VendorMeta | null
  icon?: ProviderIconConfig | null
  name: string
  desc: string
  status: 'ok' | 'warning' | 'off' | 'error' | 'unknown'
  modelIds: string[]
  defaultModel: string
  /** 内置 provider：隐藏编辑/删除按钮，多选时不可勾选 */
  isBuiltin?: boolean
  /** 平台官方受管 provider：由系统维护，禁止编辑、删除和批量导出。 */
  isManaged?: boolean
  /** 默认 Provider：用更明显的标签提示 */
  isDefault?: boolean
  /** 卡片类型（名称行 tag + 筛选用）；多选模式下隐藏 tag */
  cardKind: ProviderCardKind
  /** 多选模式：true 时显示复选框 + 点击行切换选择 */
  multiSelect?: boolean
  /** 是否被选中（仅 multiSelect=true 时生效）*/
  selected?: boolean
  /** 虚拟 provider 没有真实 endpoint/key，不展示健康检查 */
  canHealthCheck?: boolean
  onToggleSelect?: () => void
  onEdit: () => void
  onDelete: () => void
  onHealthCheck: () => void
}) {
  // 不再在 JS 里截断：CSS 用 max-height + overflow 限制到 3 行，
  // 多余模型自然截断；DOM 数量由 provider 自身 model 数量决定，典型 < 20，可控。

  // 用一个合成的 vendor-meta 来渲染 fallback（无 vendor 时显示首字母 + 中性色）
  const fallbackVendor: VendorMeta | null = vendor ?? {
    id: '',
    name,
    emoji: (name[0] ?? '?').toUpperCase(),
    color: 'var(--text-faint)',
    desc: '',
    logoPath: '',
  }

  // 卡片类型元数据（图标/文案/配色）。多选模式下不渲染，避免与左上复选框视觉冲突。
  const kindMeta = cardKind && !multiSelect ? CARD_KIND_META[cardKind] : null

  const handleCardClick = () => {
    if (multiSelect && onToggleSelect) onToggleSelect()
  }

  // 状态颜色映射（用于 Arco Badge / Tag）
  const statusColor =
    status === 'ok' ? 'green'
    : status === 'warning' ? 'orange'
    : status === 'error' ? 'red'
    : 'gray'
  const statusLabel =
    status === 'ok' ? '在线'
    : status === 'warning' ? '需注意'
    : status === 'error' ? '错误'
    : status === 'off' ? '未启用'
    : '未验证'

  return (
    <div
      className={`pv_card${multiSelect ? ' pv_multi_mode' : ''}${selected ? ' pv_selected' : ''}`}
      onClick={multiSelect ? handleCardClick : undefined}
      role={multiSelect ? 'button' : undefined}
      tabIndex={multiSelect ? 0 : undefined}
      onKeyDown={
        multiSelect
          ? (e) => {
              if ((e.key === 'Enter' || e.key === ' ') && onToggleSelect) {
                e.preventDefault()
                onToggleSelect()
              }
            }
          : undefined
      }
      aria-pressed={multiSelect ? selected : undefined}
    >
      {/* ─── 行 1：图标 + 名称 + 状态 tag + 操作按钮 ─── */}
      <div className="pv_card_row pv_card_row_top">
        {multiSelect && (
          <div
            className="pv_card_checkbox"
            onClick={(e) => e.stopPropagation()}
            title={selected ? '取消选择' : '选择'}
          >
            <Checkbox
              checked={selected}
              onChange={() => onToggleSelect?.()}
              aria-label={`选择 Provider ${name}`}
            />
          </div>
        )}
        <ProviderLogo
          vendor={fallbackVendor}
          icon={icon}
          size={44}
          shape="rounded"
          className={isManaged ? 'pv_managed_provider_logo' : ''}
          {...(isManaged ? { style: { background: '#fff', padding: 4 } } : {})}
        />
        <div className="pv_card_top_info">
          <div className="pv_card_name_row">
            <span className="pv_card_name">{name}</span>
            {isBuiltin && <Tag size="middle" color="gray">内置</Tag>}
            {isManaged && <Tag size="middle" color="arcoblue">平台官方</Tag>}
          </div>
          <div className="pv_card_tags_row">
            {isDefault && (
              <Tag size="middle" color="arcoblue" icon={<Icons.StarFill />}>
                默认 Provider
              </Tag>
            )}
            <Tag size="middle" color={statusColor as any}>
              <Badge status={status === 'ok' ? 'success' : status === 'error' ? 'error' : status === 'warning' ? 'warning' : 'default'} />
              <span className="ml-1">{statusLabel}</span>
            </Tag>
          </div>
        </div>
        
      </div>

      {/* ─── 行 2：格式描述（Anthropic / OpenAI / 多媒体 + 默认模型） ─── */}
      <div className="pv_card_row pv_card_row_desc">{desc}</div>

      {/* ─── 行 3：支持的模型 pill 平铺，最多 3 行截断 ─── */}
      {modelIds.length > 0 && (
        <div className="pv_card_row pv_card_row_models">
          <div className="pv_card_models">
            {modelIds.map((m) => (
              <span
                key={m}
                className={`pv_model_pill${m === defaultModel ? ' pv_model_default' : ''}`}
                title={m}
              >
                {m === defaultModel && <Icons.StarFill size={9} />}
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ─── 行 4：类型 tag（卡片底部独立一行；多选模式隐藏） ─── */}
      {kindMeta && (
        <div className="pv_card_row pv_card_row_kind">
          <span className={`pv_card_kind ${kindMeta.kindClass}`} title={kindMeta.label}>
            <kindMeta.icon size={11} />
            <span className="pv_card_kind_label">{kindMeta.label}</span>
          </span>
          {!multiSelect && (
          <div className="pv_card_actions" onClick={(e) => e.stopPropagation()}>
            
            
            {!isBuiltin && !isManaged && (
              <ActionIcon
                icon={Icons.Trash}
                size="small"
                variant="borderless"
                danger
                onClick={onDelete}
                title="删除"
                aria-label="删除"
              />
            )}
            {canHealthCheck && (
              <ActionIcon
                icon={Icons.Refresh}
                size="small"
                variant="borderless"
                onClick={onHealthCheck}
                title="健康检查"
                aria-label="健康检查"
              />
            )}
            {!isBuiltin && (
              <ActionIcon
                icon={Icons.Edit}
                size="small"
                variant="borderless"
                title={isManaged ? '设置本机启用模型' : '编辑'}
                onClick={onEdit}
              />
            )}
          </div>
        )}
        </div>
      )}
    </div>
  )
}

function emptyRouteCandidates(): RouteModelDraft['candidates'] {
  return {
    simple: [],
    default: [],
    complex: [],
    longContext: [],
  }
}

function parseRouteModelConfig(model: ModelProfile): RoutingModelConfig | null {
  try {
    const parsed = JSON.parse(model.configJson) as unknown
    return isRoutingModelConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

function createEmptyRouteDraft(
  providers: ProviderProfile[],
  adapter: RoutingAdapter,
): RouteModelDraft {
  const candidate = getRouteCandidateOptions(providers, adapter)[0]
  return {
    providerId: getRouteProviderId(adapter),
    name: defaultRouteModelName(adapter),
    adapter,
    enabled: true,
    candidates: {
      ...emptyRouteCandidates(),
      default: candidate ? [decodeRouteCandidateValue(candidate.value)] : [],
    },
  }
}

function routeModelToDraft(model: ModelProfile, providers: ProviderProfile[]): RouteModelDraft {
  const config = parseRouteModelConfig(model)
  if (config == null) return createEmptyRouteDraft(providers, 'claude')
  return {
    id: model.id,
    providerId: isAutoRouterProvider(model.providerId) ? model.providerId : getRouteProviderId(config.adapter),
    name: model.name,
    adapter: config.adapter,
    enabled: model.enabled,
    candidates: {
      ...emptyRouteCandidates(),
      ...ROUTING_SLOTS.reduce<Partial<RouteModelDraft['candidates']>>((acc, slot) => {
        acc[slot.value] = normalizeRoutingCandidates(config.candidates)[slot.value] ?? []
        return acc
      }, {}),
    },
  }
}

function buildRoutingConfigFromDraft(draft: RouteModelDraft): RoutingModelConfig {
  const candidates = ROUTING_SLOTS.reduce<RoutingModelConfig['candidates']>((acc, slot) => {
    const slotCandidates = uniqRouteCandidates(draft.candidates[slot.value])
    if (slotCandidates.length === 1) {
      const first = slotCandidates[0]
      if (first != null) acc[slot.value] = first
    } else if (slotCandidates.length > 1) {
      acc[slot.value] = slotCandidates
    }
    return acc
  }, {})
  return {
    kind: 'router',
    adapter: draft.adapter,
    candidates,
  }
}

function uniqRouteCandidates(candidates: RoutingCandidateRef[]): RoutingCandidateRef[] {
  const seen = new Set<string>()
  const normalized: RoutingCandidateRef[] = []
  for (const candidate of candidates) {
    if (!candidate.providerProfileId || !candidate.modelId) continue
    const key = encodeRouteCandidateValue(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(candidate)
  }
  return normalized
}

function getRouteCandidateOptions(
  providers: ProviderProfile[],
  adapter: RoutingAdapter,
): Array<{ label: string; value: string }> {
  return providers
    .filter((provider) => !isBuiltInLocalCliProvider(provider) && !isAutoRouterProvider(provider))
    .filter((provider) => isProviderAllowedForRouterAdapter(adapter, provider))
    .filter((provider) => provider.codexApiKind !== 'embedding')
    .flatMap((provider) =>
      providerModelIds(provider).map((modelId) => ({
        label: `${provider.name} · ${modelId}`,
        value: encodeRouteCandidateValue({ providerProfileId: provider.id, modelId }),
      })),
    )
}

function providerModelIds(provider: ProviderProfile): string[] {
  const ids = provider.modelIds.length > 0 ? provider.modelIds : [provider.defaultModel]
  return uniqPreserveOrder(ids.map((id) => id.trim()).filter((id) => id.length > 0))
}

function defaultRouteModelName(adapter: RoutingAdapter): string {
  return adapter === 'claude' ? 'Auto Claude' : 'Auto Codex'
}

function getRouteProviderId(adapter: RoutingAdapter): string {
  return adapter === 'claude' ? CLAUDE_AUTO_ROUTER_PROVIDER_ID : CODEX_AUTO_ROUTER_PROVIDER_ID
}

function encodeRouteCandidateValue(candidate: RoutingCandidateRef): string {
  return JSON.stringify([candidate.providerProfileId, candidate.modelId])
}

function decodeRouteCandidateValue(value: string): RoutingCandidateRef {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { providerProfileId: parsed[0], modelId: parsed[1] }
    }
  } catch {
    // fall through
  }
  return { providerProfileId: '', modelId: '' }
}

function providerNameById(providers: ProviderProfile[], providerId: string): string {
  return providers.find((provider) => provider.id === providerId)?.name ?? providerId
}

function draftToModelProfile(draft: RouteModelDraft): ModelProfile {
  return {
    id: draft.id ?? '',
    providerId: draft.providerId,
    name: draft.name,
    configJson: JSON.stringify(buildRoutingConfigFromDraft(draft)),
    enabled: draft.enabled,
    createdAt: '',
    updatedAt: '',
  }
}

function RouteModelManagerModal({
  open,
  providers,
  models,
  onClose,
  onChanged,
}: {
  open: boolean
  providers: ProviderProfile[]
  models: ModelProfile[]
  onClose: () => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const { invoke: createModel } = useIpcInvoke('model:create')
  const { invoke: updateModel } = useIpcInvoke('model:update')
  const { invoke: deleteModel } = useIpcInvoke('model:delete')
  const routeModels = useMemo(
    () => models.filter((model) => isAutoRouterProvider(model.providerId) && parseRouteModelConfig(model) != null),
    [models],
  )
  const [draft, setDraft] = useState<RouteModelDraft>(() => createEmptyRouteDraft(providers, 'claude'))
  const [saving, setSaving] = useState(false)
  const [pendingDeleteModel, setPendingDeleteModel] = useState<ModelProfile | null>(null)

  useEffect(() => {
    if (!open) {
      setPendingDeleteModel(null)
      return
    }
    setDraft((prev) => {
      const current = prev.id ? routeModels.find((model) => model.id === prev.id) : null
      if (current) return routeModelToDraft(current, providers)
      const first = routeModels[0]
      return first ? routeModelToDraft(first, providers) : createEmptyRouteDraft(providers, 'claude')
    })
  }, [open, providers, routeModels])

  const candidateOptions = useMemo(
    () => getRouteCandidateOptions(providers, draft.adapter),
    [draft.adapter, providers],
  )
  const activeConfig = buildRoutingConfigFromDraft(draft)

  const updateDraft = <K extends keyof RouteModelDraft>(key: K, value: RouteModelDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const selectRouteModel = (model: ModelProfile) => {
    setPendingDeleteModel(null)
    setDraft(routeModelToDraft(model, providers))
  }

  const createNewDraft = (adapter: RoutingAdapter = 'claude') => {
    setPendingDeleteModel(null)
    setDraft(createEmptyRouteDraft(providers, adapter))
  }

  const changeAdapter = (adapter: RoutingAdapter) => {
    setPendingDeleteModel(null)
    setDraft((prev) => {
      const candidateValues = new Set(getRouteCandidateOptions(providers, adapter).map((option) => option.value))
      const candidates = ROUTING_SLOTS.reduce<RouteModelDraft['candidates']>((acc, slot) => {
        acc[slot.value] = prev.candidates[slot.value].filter((candidate) =>
          candidateValues.has(encodeRouteCandidateValue(candidate)),
        )
        return acc
      }, emptyRouteCandidates())
      return {
        ...prev,
        adapter,
        providerId: getRouteProviderId(adapter),
        name: prev.id ? prev.name : defaultRouteModelName(adapter),
        candidates,
      }
    })
  }

  const changeCandidate = (slot: RoutingComplexity, value: string[] | null | undefined) => {
    setDraft((prev) => ({
      ...prev,
      candidates: {
        ...prev.candidates,
        [slot]: (value ?? []).map(decodeRouteCandidateValue),
      },
    }))
  }

  const handleSaveRoute = async () => {
    if (!draft.name.trim()) {
      toast.error('请填写路由模型名称')
      return
    }
    if ((draft.candidates.default ?? []).length === 0) {
      toast.error('请至少配置默认任务模型')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        configJson: JSON.stringify(activeConfig, null, 2),
      }
      if (draft.id) {
        const res = await updateModel({
          id: draft.id,
          ...payload,
          enabled: draft.enabled,
        })
        setDraft(routeModelToDraft(res.model, providers))
        toast.success('自动路由模型已更新')
      } else {
        const res = await createModel({
          providerId: draft.providerId,
          ...payload,
        })
        let savedModel = res.model
        if (!draft.enabled) {
          savedModel = (await updateModel({ id: res.model.id, enabled: false })).model
        }
        setDraft(routeModelToDraft(savedModel, providers))
        toast.success('自动路由模型已创建')
      }
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存自动路由模型失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRoute = async (model: ModelProfile) => {
    setSaving(true)
    try {
      await deleteModel({ id: model.id })
      toast.success('自动路由模型已删除')
      const remaining = routeModels.filter((item) => item.id !== model.id)
      setDraft(remaining[0] ? routeModelToDraft(remaining[0], providers) : createEmptyRouteDraft(providers, draft.adapter))
      setPendingDeleteModel(null)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除自动路由模型失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={
        <div className="pv_route_title">
          <Icons.Shuffle size={16} />
          <span>自动模型路由</span>
        </div>
      }
      onCancel={onClose}
      footer={
        pendingDeleteModel ? (
          <div className="pv_route_delete_confirm">
            <span>删除「{pendingDeleteModel.name}」？</span>
            <Button type="text" onClick={() => setPendingDeleteModel(null)} disabled={saving}>
              取消
            </Button>
            <Button
              type="primary"
              danger
              loading={saving}
              onClick={() => void handleDeleteRoute(pendingDeleteModel)}
            >
              确认删除
            </Button>
          </div>
        ) : (
          <div className="pv_route_modal_footer">
            {draft.id && (
              <Button
                type="text"
                danger
                icon={<Icons.Trash />}
                onClick={() => setPendingDeleteModel(draftToModelProfile(draft))}
              >
                删除
              </Button>
            )}
            <span className="pv_route_editor_spacer" />
            <Button type="text" onClick={onClose} disabled={saving}>
              关闭
            </Button>
            <Button type="primary" loading={saving} onClick={() => void handleSaveRoute()}>
              {draft.id ? '保存路由模型' : '创建路由模型'}
            </Button>
          </div>
        )
      }
      style={{ width: 1120, maxWidth: 'calc(100vw - 48px)' }}
      destroyOnHidden
    >
      <div className="pv_route_manager">
        <div className="pv_route_sidebar">
          <div className="pv_route_sidebar_head">
            <span>模型卡</span>
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus />}
              onClick={() => createNewDraft()}
            >
              新建
            </Button>
          </div>
          <div className="pv_route_list">
            {routeModels.length === 0 ? (
              <div className="pv_route_empty">暂无自动路由模型</div>
            ) : (
              routeModels.map((model) => {
                const config = parseRouteModelConfig(model)
                const active = draft.id === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`pv_route_item${active ? ' active' : ''}`}
                    onClick={() => selectRouteModel(model)}
                  >
                    <span className="pv_route_item_name">{model.name}</span>
                    <span className="pv_route_item_meta">
                      {config?.adapter === 'claude' ? 'Claude' : 'Codex'} · {providerNameById(providers, model.providerId)}
                    </span>
                    {!model.enabled && <Tag size="middle" color="gray">已停用</Tag>}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="pv_route_editor">
          <div className="pv_route_editor_head">
            <Button
              size="small"
              type={draft.adapter === 'claude' ? 'primary' : 'default'}
              icon={<Icons.Bot size={12} />}
              onClick={() => changeAdapter('claude')}
              disabled={!!draft.id}
            >
              Claude
            </Button>
            <Button
              size="small"
              type={draft.adapter === 'codex' ? 'primary' : 'default'}
              icon={<Icons.Cpu size={12} />}
              onClick={() => changeAdapter('codex')}
              disabled={!!draft.id}
            >
              Codex
            </Button>
            <span className="pv_route_editor_spacer" />
            {draft.id && (
              <div className="pv_route_enable">
                <span>{draft.enabled ? '启用' : '停用'}</span>
                <Switch
                  size="small"
                  checked={draft.enabled}
                  onChange={(checked) => updateDraft('enabled', checked)}
                />
              </div>
            )}
          </div>

          <div className="pv_route_editor_body">
            <div className="pv_route_form">
              <label className="pv_form_label">
                模型卡名称
                <span className="pv_form_sub">会显示在 Chat 和 Agent 的模型选择器中</span>
              </label>
              <Input
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder={defaultRouteModelName(draft.adapter)}
              />

              <label className="pv_form_label">
                路由 Provider
                <span className="pv_form_sub">自动路由作为虚拟 Provider 出现在模型选择器中</span>
              </label>
              <Input value={providerNameById(providers, draft.providerId)} readOnly disabled />
            </div>

            <div className="pv_route_slots">
              {ROUTING_SLOTS.map((slot) => {
                const candidates = draft.candidates[slot.value]
                return (
                  <div key={slot.value} className="pv_route_slot">
                    <div className="pv_route_slot_label">
                      <span>{slot.label}</span>
                      <small>{slot.hint}</small>
                    </div>
                    <Select
                      mode="multiple"
                      value={candidates.map(encodeRouteCandidateValue)}
                      onChange={(value) =>
                        changeCandidate(
                          slot.value,
                          Array.isArray(value) ? value.map(String) : value ? [String(value)] : [],
                        )
                      }
                      options={candidateOptions}
                      allowClear={slot.value !== 'default'}
                      placeholder={slot.value === 'default' ? '至少选择一个默认模型' : '未配置则回退默认'}
                    />
                  </div>
                )
              })}
            </div>

            <div className="pv_route_preview">
              <code>{JSON.stringify(activeConfig, null, 2)}</code>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ───────── PROVIDER EDIT drawer ───────── */
export function ProviderEditPanel({
  visible = true,
  profileId = null,
  initialPresetId = null,
  onClose,
}: {
  visible?: boolean
  profileId?: string | null
  initialPresetId?: string | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<ProviderForm>({
    presetId: 'custom',
    name: '',
    provider: 'anthropic',
    providerIcon: DEFAULT_PROVIDER_ICON,
    defaultModel: '',
    modelIds: [],
    endpoint: '',
    codexApiKind: 'chat',
    supportsMillionContext: false,
    contextWindow: 0,
    apiKey: '',
    isDefault: false,
    ...EMPTY_TIER_MODELS,
    modelType: 'multimodal',
    imageProvider: 'openai',
    imageApiType: 'sync',
    ...EMPTY_MEDIA_FORM,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [mediaCatalog, setMediaCatalog] = useState<CanvasMediaModelSummary[]>([])
  const [mediaCatalogLoading, setMediaCatalogLoading] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const [editingCustomManifestId, setEditingCustomManifestId] = useState<string | null>(null)
  const [customManifestDraft, setCustomManifestDraft] = useState('')
  const [customManifestError, setCustomManifestError] = useState('')
  const [dryRunInput, setDryRunInput] = useState('{\n  "prompt": "a red apple"\n}')
  const [dryRunResult, setDryRunResult] = useState<CanvasMediaPruneModelParamsByInlineManifestResponse | null>(null)
  const [dryRunError, setDryRunError] = useState('')
  const [dryRunLoading, setDryRunLoading] = useState(false)
  // 自定义上下文窗口的"意图"状态：与 form.contextWindow 数值解耦，
  // 避免用户清空输入框时下拉跳回"默认"并卸载输入框。
  const [isCustomContextWindow, setIsCustomContextWindow] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<ProviderFetchedModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerSearch, setModelPickerSearch] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconPickerSearch, setIconPickerSearch] = useState('')
  const [iconPickerStyle, setIconPickerStyle] = useState<ProviderIconStyle>('avatar')
  const lastAutoDefaultModelRef = useRef<string | null>(null)
  const lastAutoFetchModelsRef = useRef<string | null>(null)
  const fetchedModelIds = useMemo(
    () =>
      uniqPreserveOrder(
        fetchedModels
          .map((model) => model.id.trim())
          .filter((id): id is string => id.length > 0),
      ),
    [fetchedModels],
  )
  const filteredFetchedModelIds = useMemo(() => {
    const query = modelPickerSearch.trim().toLowerCase()
    return query ? fetchedModelIds.filter((id) => id.toLowerCase().includes(query)) : fetchedModelIds
  }, [fetchedModelIds, modelPickerSearch])
  const filteredProviderIcons = useMemo(() => {
    const query = iconPickerSearch.trim().toLowerCase()
    if (!query) return PROVIDER_ICON_CATALOG
    return PROVIDER_ICON_CATALOG.filter((item) =>
      [item.id, item.label, ...item.keywords].some((value) => value.toLowerCase().includes(query)),
    )
  }, [iconPickerSearch])

  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: getProviderApiKey } = useIpcInvoke('provider:get-api-key')
  const { invoke: listMediaModels } = useIpcInvoke('canvas:media-models:list')
  const { invoke: testConnection } = useIpcInvoke('provider:test-connection')
  const { invoke: fetchProviderModels } = useIpcInvoke('provider:fetch-models')

  // 防抖更新 modelIds：只保留输入稳定后的默认模型，避免每次停顿留下半截 chip。
  const debouncedUpdateModelIds = useDebouncedCallback((next: string) => {
    const trimmed = next.trim()
    if (!trimmed) return
    const previousAutoDefault = lastAutoDefaultModelRef.current
    lastAutoDefaultModelRef.current = trimmed
    setForm((prev) => {
      if (prev.modelIds.includes(trimmed) && previousAutoDefault === trimmed) return prev
      const rest = prev.modelIds.filter((m) => m !== trimmed && m !== previousAutoDefault)
      const ids = uniqPreserveOrder([trimmed, ...rest])
      return { ...prev, modelIds: ids }
    })
  }, 600)

  const setDefaultModelFromSelection = useCallback((next: string) => {
    const trimmed = next.trim()
    if (!trimmed) return
    lastAutoDefaultModelRef.current = trimmed
    setForm((prev) => ({
      ...prev,
      defaultModel: trimmed,
      modelIds: uniqPreserveOrder([trimmed, ...prev.modelIds]),
    }))
  }, [])

  const toggleFetchedModelSelection = useCallback((modelId: string, checked: boolean) => {
    const trimmed = modelId.trim()
    if (!trimmed) return
    setForm((prev) => {
      if (!checked && prev.defaultModel.trim() === trimmed) return prev
      return {
        ...prev,
        modelIds: checked
          ? uniqPreserveOrder([trimmed, ...prev.modelIds])
          : prev.modelIds.filter((id) => id !== trimmed),
      }
    })
  }, [])

  // 编辑模式：加载现有 profile；新建模式：支持 initialPresetId 预填
  // 仅在 Drawer 打开时执行，避免关闭后 form 被错误重置
  useEffect(() => {
    if (!visible) return
    lastAutoDefaultModelRef.current = null
    lastAutoFetchModelsRef.current = null
    // Drawer 重新打开时同步重置连接测试状态和已获取的模型列表，
    // 是 "response to prop change → reset internal state" 模式（React 19 仍推荐），
    // 新规则 react-hooks/set-state-in-effect 会误报，这里显式豁免。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnectionFeedback(null)
    setAdvancedOpen(false)
    setModelPickerOpen(false)
    setModelPickerSearch('')
    setIconPickerOpen(false)
    setIconPickerSearch('')
    setIconPickerStyle('avatar')
    setEditingCustomManifestId(null)
    setCustomManifestDraft('')
    setCustomManifestError('')
    setFetchedModels([])
    if (!profileId) {
      // 从预设模板打开：自动填充 preset 数据
      if (initialPresetId) {
        const preset = getProviderPresetById(initialPresetId)
        if (preset) {
          const id = window.setTimeout(() => {
            setApiKeyDirty(false)
            setIsCustomContextWindow(false)
            // 模板自带的候选模型只自动启用默认模型；其余进「候选模型目录」，用户点选后才计入已启用列表。
            setFetchedModels(uniqPreserveOrder([preset.defaultModel, ...preset.modelIds]).map((modelId) => ({ id: modelId })))
            setForm({
              presetId: preset.id,
              name: preset.name,
              provider: preset.provider,
              providerIcon: providerIconForPreset(preset),
              defaultModel: preset.defaultModel,
              modelIds: [preset.defaultModel],
              endpoint: preset.apiEndpoint,
              codexApiKind: resolveCodexApiKind(preset.provider, preset.apiEndpoint, preset.codexApiKind),
              supportsMillionContext: false,
              contextWindow: 0,
              apiKey: '',
              isDefault: false,
              ...EMPTY_TIER_MODELS,
              modelType: normalizeLegacyModelType(preset.modelType),
              imageProvider: imageProviderForMediaConfig(preset.imageProvider, preset.mediaProvider),
              imageApiType: normalizeImageApiType(preset.mediaApiType ?? preset.imageApiType),
              ...presetMediaForm(preset),
            })
          }, 0)
          return () => window.clearTimeout(id)
        }
      }
      const id = window.setTimeout(() => {
        setApiKeyDirty(false)
        setIsCustomContextWindow(false)
        setForm({
          presetId: 'custom',
          name: '',
          provider: 'anthropic',
          providerIcon: DEFAULT_PROVIDER_ICON,
          defaultModel: '',
          modelIds: [],
          endpoint: '',
          codexApiKind: 'chat',
          supportsMillionContext: false,
          contextWindow: 0,
          apiKey: '',
          isDefault: false,
          ...EMPTY_TIER_MODELS,
          modelType: 'multimodal',
          imageProvider: 'openai',
          imageApiType: 'sync',
          ...EMPTY_MEDIA_FORM,
        })
      }, 0)
      return () => window.clearTimeout(id)
    }
    let cancelled = false
    loadEditableProviderSnapshot(profileId, listProviders, getProviderApiKey)
      .then(({ profile: p, apiKey, apiKeyError }) => {
        if (cancelled) return
        if (p) {
          // 旧数据兼容：只勾选 1M 开关而没写过 contextWindow 时，下拉应回显为 1M 而不是默认。
          const effectiveContextWindow =
            typeof p.contextWindow === 'number' && p.contextWindow > 0
              ? p.contextWindow
              : (p.supportsMillionContext === true ? 1_000_000 : 0)
          // 非预设值（如 50K / 256K 之外的自定义数）打开时直接进入自定义模式。
          setIsCustomContextWindow(
            effectiveContextWindow > 0
              && !CONTEXT_WINDOW_PRESETS.some((opt) => opt.value === effectiveContextWindow),
          )
          setForm({
            presetId: 'custom',
            name: p.name,
            provider: normalizeProviderKind(p.provider),
            providerIcon: normalizeProviderIconConfig(p.providerIcon) ?? providerIconFromVendorId(
              vendorForMediaProvider(p.mediaProvider ?? p.imageProvider ?? undefined)?.id ??
              (normalizeProviderKind(p.provider) === 'openai' ? 'openai' : 'claude'),
            ),
            defaultModel: p.defaultModel,
            modelIds: uniqPreserveOrder(p.modelIds),
            endpoint: p.apiEndpoint ?? '',
            codexApiKind: resolveCodexApiKind(normalizeProviderKind(p.provider), p.apiEndpoint, p.codexApiKind),
            supportsMillionContext: p.supportsMillionContext === true,
            contextWindow: effectiveContextWindow,
            apiKey,
            isDefault: p.isDefault,
            haikuModel: p.haikuModel ?? '',
            sonnetModel: p.sonnetModel ?? '',
            opusModel: p.opusModel ?? '',
            modelType: normalizeLegacyModelType(p.modelType),
            imageProvider: imageProviderForMediaConfig(p.imageProvider, p.mediaProvider),
            imageApiType: normalizeImageApiType(p.mediaApiType ?? p.imageApiType),
            ...profileMediaForm(p),
          })
          setApiKeyDirty(false)
          if (apiKeyError) {
            setError(apiKeyError instanceof Error ? `API Key 读取失败：${apiKeyError.message}` : 'API Key 读取失败')
          }
        }
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [getProviderApiKey, listProviders, profileId, initialPresetId, visible])

  useEffect(() => {
    if (!visible) return
    const id = window.setTimeout(() => {
      setMediaCatalogLoading(true)
      listMediaModels({ catalogOnly: true, enabledOnly: true })
        .then((res) => setMediaCatalog(res.models))
        .catch(() => setMediaCatalog([]))
        .finally(() => setMediaCatalogLoading(false))
    }, 0)
    return () => window.clearTimeout(id)
  }, [listMediaModels, visible])

  // ── 衍生：当前选中 preset 对应的 vendor（用于 hero 渲染真实 logo） ──
  const currentVendor: VendorMeta | null = useMemo(() => {
    if (hasConfiguredMediaStack(form.modelType, form.mediaProvider, form.mediaCapabilities, form.mediaModelRefs)) {
      return vendorForMediaProvider(form.mediaProvider || mediaProviderFromImageKind(form.imageProvider))
    }
    if (form.presetId !== 'custom') {
      const preset = getProviderPresetById(form.presetId)
      if (preset) {
        const meta = getVendorMeta(preset.vendorId)
        if (meta) return meta
      }
    }
    // 自定义模式：尝试按 name 反推 vendor
    const guessed = guessVendorByName(form.name, getUniqueVendorIds())
    if (guessed) {
      // 仅当该 vendor 在当前协议格式下存在预设时才采用；
      // 否则可能是从另一种格式切换过来遗留的名称（如 anthropic → openai），
      // 此时应回退到当前协议格式的官方图标，避免「选 OpenAI 格式却显示 Anthropic 图标」。
      const hasMatchingPreset = getPresetsByVendor(guessed.id).some(
        (preset) => preset.provider === form.provider,
      )
      if (hasMatchingPreset) return guessed
    }
    // 未匹配到当前格式的供应商 → 按协议格式显示官方图标（openai → OpenAI，anthropic → Claude）
    return form.provider === 'openai' ? OPENAI_VENDOR_META : CLAUDE_VENDOR_META
  }, [form.modelType, form.mediaProvider, form.mediaCapabilities, form.mediaModelRefs, form.imageProvider, form.presetId, form.name, form.provider])
  const availablePresets = useMemo(
    () =>
      PROVIDER_PRESETS.filter((preset) => {
        // 生图/语音/视频只展示同类型多媒体预设；对话模型（含通用 LLM 与显式声明
        // multimodal 附加生成能力的模板，如 Agnes）展示同协议下的非专职媒体预设。
        if (isMediaProviderModelType(form.modelType)) {
          return preset.modelType === form.modelType
        }
        if (preset.provider !== form.provider) return false
        return preset.modelType !== 'image' && preset.modelType !== 'voice' && preset.modelType !== 'video'
      }),
    [form.modelType, form.provider],
  )
  const mediaCatalogForForm = useMemo(() => {
    const byType = mediaCatalog.filter((model) => mediaModelMatchesType(model, form.modelType))
    const providerFiltered = byType.filter((model) => mediaModelMatchesProvider(model, form))
    // 对话模型：只展示同厂商生图/视频模型，不兜底展示跨厂商全量目录，
    // 避免「附加生成能力」面板里出现和当前服务商无关的生图/视频模型。
    if (form.modelType === 'multimodal') return providerFiltered
    return providerFiltered.length > 0 ? providerFiltered : byType
  }, [form, mediaCatalog])
  const selectedManifestIds = useMemo(
    () => new Set(form.mediaModelRefs.filter((ref) => ref.enabled !== false).map((ref) => ref.manifestId)),
    [form.mediaModelRefs],
  )
  const selectedMediaCatalogModels = useMemo(
    () => mediaCatalogForForm.filter((model) => selectedManifestIds.has(model.manifestId)),
    [mediaCatalogForForm, selectedManifestIds],
  )
  const mediaDefaultOptionSets = useMemo(() => ({
    imageSize: enumOptionsFromModels(selectedMediaCatalogModels, ['size', 'aspectRatio', 'aspect_ratio']),
    imageQuality: enumOptionsFromModels(selectedMediaCatalogModels, ['quality']),
    audioFormat: enumOptionsFromModels(selectedMediaCatalogModels, ['format', 'output_format', 'response_format']),
    videoAspectRatio: enumOptionsFromModels(selectedMediaCatalogModels, ['aspectRatio', 'aspect_ratio', 'size']),
    videoDuration: enumOptionsFromModels(selectedMediaCatalogModels, ['durationSeconds', 'duration']),
    videoQuality: enumOptionsFromModels(selectedMediaCatalogModels, ['quality', 'resolution']),
  }), [selectedMediaCatalogModels])
  const mediaCapabilityOptions = useMemo(
    () => MEDIA_CAPABILITY_IDS.filter((capability) => capabilitiesForModelType(form.modelType).includes(capability)),
    [form.modelType],
  )
  const showMediaDefaults = useMemo(() => {
    if (form.modelType === 'image') return true
    if (form.modelType === 'voice') return true
    if (form.modelType === 'video') return true
    return false
  }, [form.modelType])

  // 自定义模型引用（manifestId 以 custom: 开头）——不依赖内置目录，
  // 渲染在清单下方，可手动添加 / 移除。原生 adapter（xAI/APIMart）按 defaultModel 调用，
  // 因此即便没有目录 manifest，自定义模型仍可用于实际请求。
  const customModelRefs = useMemo(
    () => form.mediaModelRefs.filter(isCustomModelRef),
    [form.mediaModelRefs],
  )
  const advancedSummary = useMemo(() => {
    const templateConfigured = form.presetId !== 'custom'
    if (hasConfiguredMediaStack(form.modelType, form.mediaProvider, form.mediaCapabilities, form.mediaModelRefs)) {
      const adapter = MEDIA_PROVIDER_LABELS[
        (form.mediaProvider || mediaProviderFromImageKind(form.imageProvider)) as MediaProviderKind
      ]
      const enabledModels = form.mediaModelRefs.filter((ref) => ref.enabled !== false).length
      const details = [adapter, enabledModels > 0 ? `${enabledModels} 个模型` : '使用默认模型']
      return `${templateConfigured ? '模板已自动配置' : '当前配置'} · ${details.join(' · ')}`
    }
    const routingLabel = usesClaudeTierMapping(form) ? 'Claude 档位映射' : '模型列表与上下文'
    return templateConfigured
      ? '模板已自动配置 · 可按需调整模型与上下文'
      : `可选：协议、${routingLabel}`
  }, [form])
  const requestEndpointPreview = useMemo(
    () => buildRequestEndpointPreview(form),
    [form],
  )

  const toggleMediaModelRef = (model: CanvasMediaModelSummary, checked: boolean) => {
    setForm((prev) => {
      const existing = new Map(prev.mediaModelRefs.map((ref) => [ref.manifestId, ref]))
      if (checked) {
        existing.set(model.manifestId, {
          manifestId: model.manifestId,
          modelId: model.effectiveModelId,
          enabled: true,
        })
      } else {
        existing.delete(model.manifestId)
      }
      const capabilitySet = new Set(prev.mediaCapabilities)
      if (checked) {
        for (const capability of model.capabilities) {
          if ((MEDIA_CAPABILITY_IDS as readonly string[]).includes(capability.id)) {
            capabilitySet.add(capability.id as MediaCapabilityId)
          }
        }
      }
      const modelIds = checked
        ? uniqPreserveOrder([model.effectiveModelId, ...prev.modelIds])
        : prev.modelIds
      return {
        ...prev,
        mediaModelRefs: [...existing.values()],
        mediaCapabilities: [...capabilitySet],
        mediaProvider: checked ? adapterKindFromManifestProvider(model.providerKind) : prev.mediaProvider,
        mediaApiType: checked
          ? model.invocationMode === 'sync' ? 'sync' : model.invocationMode === 'async_polling' ? 'async' : prev.mediaApiType
          : prev.mediaApiType,
        defaultModel: prev.defaultModel.trim() ? prev.defaultModel : model.effectiveModelId,
        modelIds,
      }
    })
  }

  const addCustomMediaModel = (rawModelId: string) => {
    const modelId = rawModelId.trim()
    if (!modelId) return
    const manifestId = `${CUSTOM_MODEL_REF_PREFIX}${modelId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
    setForm((prev) => {
      // 已存在（内置或自定义）同名引用则不重复添加
      const exists = prev.mediaModelRefs.some(
        (ref) => ref.manifestId === manifestId || (ref.modelId?.trim() === modelId),
      )
      const existing = new Map(prev.mediaModelRefs.map((ref) => [ref.manifestId, ref]))
      if (!exists) {
        const mode = prev.mediaApiType === 'async' ||
          (prev.mediaApiType === 'auto' && prev.modelType === 'video')
          ? 'async_polling'
          : 'sync'
        let manifest: MediaModelManifest | undefined
        if (prev.mediaProvider === 'custom' &&
          (prev.modelType === 'image' || prev.modelType === 'video')) {
          manifest = createBasicCustomMediaManifest({ modelId, modelType: prev.modelType, mode })
        }
        existing.set(manifestId, {
          manifestId,
          modelId,
          enabled: true,
          ...(manifest ? { manifest } : {}),
        })
      }
      const capabilitySet = new Set([
        ...prev.mediaCapabilities,
        ...capabilitiesForModelType(prev.modelType),
      ])
      const modelIds = uniqPreserveOrder([modelId, ...prev.modelIds])
      return {
        ...prev,
        mediaModelRefs: [...existing.values()],
        mediaCapabilities: [...capabilitySet],
        // 确保有可用的实际调用模型：defaultModel 为空时用自定义模型兜底
        defaultModel: prev.defaultModel.trim() ? prev.defaultModel : modelId,
        modelIds,
      }
    })
  }

  const openCustomManifestEditor = (ref: ProviderMediaModelRef) => {
    const fallback = form.modelType === 'image' || form.modelType === 'video'
      ? createBasicCustomMediaManifest({
          modelId: ref.modelId ?? ref.manifestId.replace(/^custom:/, ''),
          modelType: form.modelType,
          mode: form.mediaApiType === 'async' ||
            (form.mediaApiType === 'auto' && form.modelType === 'video')
            ? 'async_polling'
            : 'sync',
        })
      : null
    const manifest = ref.manifest ?? fallback
    if (!manifest) return
    setEditingCustomManifestId(ref.manifestId)
    setCustomManifestDraft(JSON.stringify(manifest, null, 2))
    setCustomManifestError('')
  }

  const saveCustomManifestDraft = () => {
    if (!editingCustomManifestId) return
    try {
      const manifest = JSON.parse(customManifestDraft) as MediaModelManifest
      // 双重校验：Zod schema + semantic 校验（id 唯一性 / capability 数量 / 跨字段引用等）。
      const schemaResult = MediaModelManifestSchema.safeParse(manifest)
      if (!schemaResult.success) {
        setCustomManifestError(schemaResult.error.issues
          .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
          .join('\n'))
        return
      }
      const semanticIssues = validateMediaModelManifestSemantics(schemaResult.data)
      if (semanticIssues.length > 0) {
        setCustomManifestError(semanticIssues
          .map((issue) => `${issue.path?.join('.') ?? issue.code}: ${issue.message}`)
          .join('\n'))
        return
      }
      const current = form.mediaModelRefs.find((ref) => ref.manifestId === editingCustomManifestId)
      const parsed = ProviderMediaModelRefSchema.safeParse({
        ...current,
        manifestId: editingCustomManifestId,
        modelId: current?.modelId ?? manifest.modelId,
        manifest,
      })
      if (!parsed.success) {
        setCustomManifestError(parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
          .join('\n'))
        return
      }
      setForm((prev) => ({
        ...prev,
        mediaModelRefs: prev.mediaModelRefs.map((ref) =>
          ref.manifestId === editingCustomManifestId ? parsed.data : ref,
        ),
      }))
      setEditingCustomManifestId(null)
      setCustomManifestDraft('')
      setCustomManifestError('')
    } catch (err) {
      setCustomManifestError(err instanceof Error ? err.message : 'Manifest JSON 格式错误')
    }
  }

  // 结构化编辑器修改 → 同步回 customManifestDraft（raw JSON），保证两侧视图一致。
  const applyManifestFromContractEditor = (next: MediaModelManifest) => {
    setCustomManifestDraft(JSON.stringify(next, null, 2))
  }

  // 在 Modal 内对当前正在编辑的 inline manifest 做 dry-run 预览，让用户在保存前
  // 就能看到 manifest 的 paramPolicy 会如何裁剪 / 拒绝参数。失败时只把错误显示在
  // 结果区，不阻塞保存流程。
  const runDryRunPreview = async () => {
    setDryRunError('')
    setDryRunResult(null)
    let manifestObj: MediaModelManifest
    try {
      manifestObj = JSON.parse(customManifestDraft) as MediaModelManifest
    } catch (err) {
      setDryRunError(err instanceof Error ? `manifest JSON 解析失败：${err.message}` : 'manifest JSON 解析失败')
      return
    }
    if (!Array.isArray(manifestObj.capabilities) || manifestObj.capabilities.length === 0) {
      setDryRunError('manifest 缺少 capabilities，无法 dry-run')
      return
    }
    let paramsObj: Record<string, unknown>
    try {
      paramsObj = dryRunInput.trim().length === 0 ? {} : JSON.parse(dryRunInput)
    } catch (err) {
      setDryRunError(err instanceof Error ? `modelParams JSON 解析失败：${err.message}` : 'modelParams JSON 解析失败')
      return
    }
    const capabilityId = manifestObj.capabilities[0]?.id
    if (!capabilityId) {
      setDryRunError('manifest 第一个 capability 缺少 id')
      return
    }
    setDryRunLoading(true)
    try {
      const request: CanvasMediaPruneModelParamsByInlineManifestRequest = {
        manifest: manifestObj,
        capabilityId,
        modelParams: paramsObj,
      }
      const res = (await window.spark.invoke(
        'canvas:media:prune-model-params-by-inline-manifest',
        request,
      )) as CanvasMediaPruneModelParamsByInlineManifestResponse
      setDryRunResult(res)
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : 'dry-run 调用失败')
    } finally {
      setDryRunLoading(false)
    }
  }

  const removeMediaModelRef = (manifestId: string) => {
    setForm((prev) => {
      const remaining = prev.mediaModelRefs.filter((ref) => ref.manifestId !== manifestId)
      const removed = prev.mediaModelRefs.find((ref) => ref.manifestId === manifestId)
      const modelIds = removed?.modelId
        ? prev.modelIds.filter((id) => id !== removed.modelId)
        : prev.modelIds
      return { ...prev, mediaModelRefs: remaining, modelIds }
    })
  }

  // 把某个媒体模型设为默认调用模型：写入 defaultModel 并置顶 modelIds。
  // 保存时 handleSave 会尊重这个落在 enabled refs 内的显式默认。
  const setMediaDefaultModel = (modelId: string) => {
    const trimmed = modelId.trim()
    if (!trimmed) return
    setForm((prev) => ({
      ...prev,
      defaultModel: trimmed,
      modelIds: uniqPreserveOrder([trimmed, ...prev.modelIds]),
    }))
  }

  const handleSave = async () => {
    // 媒体 Provider：defaultModel 自动跟随首个 enabled 的 mediaModelRef，避免 adapter
    // 实际调用模型与用户配置脱节（典型：模板预填的 defaultModel 没跟着改）。
    // 若用户已显式把 defaultModel 设为某个 enabled ref，则尊重该选择（支持多模型场景指定默认）。
    const isMedia = isMediaProviderModelType(form.modelType)
    const enabledRefModelIds = isMedia
      ? form.mediaModelRefs
          .filter((ref) => ref.enabled !== false)
          .map((ref) => (ref.modelId ?? '').trim() || ref.manifestId.replace(/^custom:/, ''))
          .filter((id) => id.length > 0)
      : []
    const typedDefault = form.defaultModel.trim()
    const effectiveDefaultModel =
      isMedia && enabledRefModelIds.length > 0
        ? enabledRefModelIds.includes(typedDefault)
          ? typedDefault
          : (enabledRefModelIds[0] as string)
        : typedDefault

    if (!form.name.trim() || !effectiveDefaultModel) {
      setError('名称和默认模型 ID 不能为空')
      return
    }
    if (!profileId && !form.apiKey.trim()) {
      setError('新建 Provider 需要填写 API Key')
      return
    }
    setSaving(true)
    setError('')
    try {
      const endpoint = form.endpoint.trim()
      // 确保 defaultModel 在 modelIds 中且排在最前（锁定为 primary）
      const modelIds = uniqPreserveOrder([effectiveDefaultModel, ...form.modelIds])
      const haiku = form.haikuModel.trim()
      const sonnet = form.sonnetModel.trim()
      const opus = form.opusModel.trim()
      if (profileId) {
        const req: ProviderUpdateRequest = {
          id: profileId,
          name: form.name.trim(),
          defaultModel: effectiveDefaultModel,
          modelIds,
          providerIcon: form.providerIcon,
          isDefault: form.isDefault,
          apiEndpoint: endpoint.length > 0 ? endpoint : null,
          supportsMillionContext: form.supportsMillionContext,
          contextWindow: form.contextWindow > 0 ? form.contextWindow : 0,
          // 始终下发：string 设置；空串 → null 清除
          haikuModel: haiku.length > 0 ? haiku : null,
          sonnetModel: sonnet.length > 0 ? sonnet : null,
          opusModel: opus.length > 0 ? opus : null,
          modelType: form.modelType,
          imageProvider: form.modelType === 'image' ? form.imageProvider : null,
          imageApiType: form.modelType === 'image' ? form.mediaApiType : null,
          ...buildMediaUpdateFields(form),
        }
        if (form.provider === 'openai') req.codexApiKind = form.codexApiKind
        Object.assign(req, editableProviderApiKeyPayload(profileId, form.apiKey, apiKeyDirty))
        await updateProvider(req)
      } else {
        await createProvider({
          name: form.name.trim(),
          provider: form.provider,
          defaultModel: effectiveDefaultModel,
          modelIds,
          providerIcon: form.providerIcon,
          apiKey: form.apiKey.trim(),
          isDefault: form.isDefault,
          ...(endpoint.length > 0 && { apiEndpoint: endpoint }),
          ...(form.provider === 'openai' && { codexApiKind: form.codexApiKind }),
          supportsMillionContext: form.supportsMillionContext,
          ...(form.contextWindow > 0 && { contextWindow: form.contextWindow }),
          ...(haiku.length > 0 && { haikuModel: haiku }),
          ...(sonnet.length > 0 && { sonnetModel: sonnet }),
          ...(opus.length > 0 && { opusModel: opus }),
          modelType: form.modelType,
          imageProvider: form.modelType === 'image' ? form.imageProvider : null,
          imageApiType: form.modelType === 'image' ? form.mediaApiType : null,
          ...buildMediaUpdateFields(form),
        })
      }
      onClose()
      toast.success(profileId ? 'Provider 已更新' : 'Provider 已创建')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  useSaveShortcut(handleSave, !saving)

  const currentProviderPayload = () => ({
    ...(profileId ? { id: profileId } : {}),
    provider: form.provider,
    apiEndpoint: form.endpoint.trim().length > 0 ? form.endpoint.trim() : null,
    defaultModel: form.defaultModel.trim(),
    ...(form.provider === 'openai' ? { codexApiKind: form.codexApiKind } : {}),
    ...editableProviderApiKeyPayload(profileId, form.apiKey, apiKeyDirty),
  })

  const applyFetchedProviderModels = useCallback((
    models: ProviderFetchedModel[],
    options: { forceFirstDefault?: boolean; onlyFirstEnabled?: boolean } = {},
  ) => {
    setFetchedModels(models)
    const ids = uniqPreserveOrder(
      models
        .map((model) => model.id.trim())
        .filter((id): id is string => id.length > 0),
    )
    if (ids.length === 0) return 0
    const firstModelId = ids[0]
    if (firstModelId == null) return 0
    setForm((prev) => {
      const nextDefault = options.forceFirstDefault || !prev.defaultModel.trim()
        ? firstModelId
        : prev.defaultModel.trim()
      return {
        ...prev,
        defaultModel: nextDefault,
        modelIds: options.onlyFirstEnabled
          ? [nextDefault]
          : uniqPreserveOrder([nextDefault, ...prev.modelIds]),
      }
    })
    return ids.length
  }, [])

  const fetchAndApplyProviderModels = useCallback(async (
    options: { forceFirstDefault?: boolean; onlyFirstEnabled?: boolean } = {},
  ) => {
    const result = await fetchProviderModels({
      ...(profileId ? { id: profileId } : {}),
      provider: form.provider,
      apiEndpoint: form.endpoint.trim().length > 0 ? form.endpoint.trim() : null,
      ...editableProviderApiKeyPayload(profileId, form.apiKey, apiKeyDirty),
    })
    return applyFetchedProviderModels(result.models, options)
  }, [apiKeyDirty, applyFetchedProviderModels, fetchProviderModels, form.apiKey, form.endpoint, form.provider, profileId])

  const autoFetchApiKey = form.apiKey
  const autoFetchEndpoint = form.endpoint
  const autoFetchModelType = form.modelType
  const autoFetchPresetId = form.presetId
  const autoFetchProvider = form.provider
  const autoFetchModelsSignature = useMemo(
    () => buildAutoFetchModelsSignature({
      apiKey: autoFetchApiKey,
      endpoint: autoFetchEndpoint,
      modelType: autoFetchModelType,
      presetId: autoFetchPresetId,
      provider: autoFetchProvider,
    }),
    [autoFetchApiKey, autoFetchEndpoint, autoFetchModelType, autoFetchPresetId, autoFetchProvider],
  )

  useEffect(() => {
    if (!visible || profileId || fetchingModels || saving) return
    if (!autoFetchModelsSignature) return
    if (lastAutoFetchModelsRef.current === autoFetchModelsSignature) return

    const id = window.setTimeout(() => {
      if (lastAutoFetchModelsRef.current === autoFetchModelsSignature) return
      lastAutoFetchModelsRef.current = autoFetchModelsSignature
      setFetchingModels(true)
      fetchAndApplyProviderModels({ forceFirstDefault: true, onlyFirstEnabled: true })
        .catch((err) => {
          console.warn('auto fetch provider models failed', err)
        })
        .finally(() => setFetchingModels(false))
    }, 800)

    return () => window.clearTimeout(id)
  }, [autoFetchModelsSignature, fetchAndApplyProviderModels, fetchingModels, profileId, saving, visible])

  const handleTestConnection = async () => {
    if (!form.defaultModel.trim()) {
      setConnectionFeedback(null)
      setError('请先填写默认模型 ID')
      return
    }
    if (!profileId && !form.apiKey.trim()) {
      setConnectionFeedback(null)
      setError('测试连接需要先填写 API Key')
      return
    }
    setTestingConnection(true)
    setError('')
    setConnectionFeedback(null)
    try {
      const result = await testConnection(currentProviderPayload())
      if (result.healthy) {
        setConnectionFeedback({
          tone: 'success',
          message: `连接成功${result.latencyMs != null ? ` · 延迟 ${result.latencyMs}ms` : ''}`,
        })
      } else {
        const message = result.errorMessage ?? '连接失败'
        setConnectionFeedback({ tone: 'error', message })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '连接测试失败'
      setConnectionFeedback({ tone: 'error', message })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleFetchModels = async () => {
    if (!profileId && !form.apiKey.trim()) {
      setError('获取模型列表需要先填写 API Key')
      return
    }
    setFetchingModels(true)
    setError('')
    try {
      const count = await fetchAndApplyProviderModels()
      if (count === 0) {
        toast.info('供应商返回的模型列表为空')
        return
      }
      toast.success(`已获取 ${count} 个模型，请点选需要全局可用的模型`)
    } catch (e) {
      const message = e instanceof Error ? e.message : '获取模型列表失败'
      setError(message)
      toast.error(message)
    } finally {
      setFetchingModels(false)
    }
  }

  const set = <K extends keyof ProviderForm>(k: K, v: ProviderForm[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))
  const selectProviderIcon = (iconId: string) => {
    const next = normalizeProviderIconConfig({ id: iconId, style: iconPickerStyle })
    if (!next) return
    setForm((prev) => ({ ...prev, providerIcon: next }))
    setIconPickerOpen(false)
  }
  const applyPreset = (preset: ProviderPreset) => {
    lastAutoDefaultModelRef.current = null
    setIsCustomContextWindow(false)
    // 模板自带的候选模型只自动启用默认模型；其余进「候选模型目录」，用户点选后才计入已启用列表。
    setFetchedModels(uniqPreserveOrder([preset.defaultModel, ...preset.modelIds]).map((modelId) => ({ id: modelId })))
    setForm((prev) => ({
      ...prev,
      presetId: preset.id,
      name: preset.name,
      provider: preset.provider,
      providerIcon: providerIconForPreset(preset),
      defaultModel: preset.defaultModel,
      modelIds: [preset.defaultModel],
      endpoint: preset.apiEndpoint,
      codexApiKind: resolveCodexApiKind(preset.provider, preset.apiEndpoint, preset.codexApiKind),
      supportsMillionContext: false,
      contextWindow: 0,
      ...EMPTY_TIER_MODELS,
      modelType: normalizeLegacyModelType(preset.modelType),
      imageProvider: imageProviderForMediaConfig(preset.imageProvider, preset.mediaProvider),
      imageApiType: normalizeImageApiType(preset.mediaApiType ?? preset.imageApiType),
      ...presetMediaForm(preset),
    }))
  }

  // ── 模型类型只剩两大类：专职媒体类型（生图/语音/视频）与对话模型 ──
  const isDedicatedMediaType = isMediaProviderModelType(form.modelType)
  const isChatModel = form.modelType === 'multimodal'
  const mediaPanelVisible = isDedicatedMediaType || (isChatModel && form.mediaGenerationEnabled)

  return (
    <Drawer
      open={visible}
      onClose={onClose}
      maskClosable={!saving}
      width={800}
      title={profileId ? '编辑 Provider' : '添加 Provider'}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="text" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        </div>
      }
      styles={{ body: { padding: 0 } }}
    >
      <div className="pv_drawer_body">
        {error && (
          <Alert
            type="error"
            icon={<Icons.AlertTriangle />}
            message={error}
            closable
            onClose={() => setError('')}
          />
        )}

        {/* ─── 服务商配置信息 ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <Icons.Server size={11} />
            </span>
            <span className="pv_section_title">服务商配置信息</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">
                模型类型
              </label>
              <Select
                  value={form.modelType}
                  onChange={(v) => {
                    const modelType = v as ProviderModelType
                    const isDedicatedMedia = isMediaProviderModelType(modelType)
                    setFetchedModels([])
                    setForm((prev) => {
                      const supportsMediaConfig = isDedicatedMedia || (modelType === 'multimodal' && prev.mediaGenerationEnabled)
                      return {
                        ...prev,
                        modelType,
                        presetId: 'custom',
                        provider: isDedicatedMedia ? 'openai' : prev.provider,
                        codexApiKind: isDedicatedMedia
                          ? 'chat'
                          : prev.provider === 'openai'
                            ? 'responses'
                            : prev.codexApiKind,
                        imageProvider: modelType === 'image' ? prev.imageProvider : 'openai',
                        imageApiType: modelType === 'image' ? prev.imageApiType : 'sync',
                        mediaProvider: isDedicatedMedia
                          ? (prev.mediaProvider || mediaProviderFromImageKind(prev.imageProvider))
                          : supportsMediaConfig
                            ? prev.mediaProvider
                            : '',
                        mediaApiType: supportsMediaConfig ? prev.mediaApiType : 'auto',
                      }
                    })
                  }}
                options={[
                  { label: '对话模型', value: 'multimodal' },
                  { label: '生图模型', value: 'image' },
                  { label: '语音模型', value: 'voice' },
                  { label: '视频模型', value: 'video' },
                ]}
              />

              {isChatModel && (
                <>
                  <label className="pv_form_label">
                    API 协议格式
                  </label>
                  <Select
                    value={form.provider}
                    onChange={(v) => {
                      const targetProvider = normalizeProviderKind(v)
                      const matchedPreset = findPresetForProtocolSwitch(form.presetId, targetProvider)
                      setFetchedModels([])
                      if (matchedPreset) {
                        applyPreset(matchedPreset)
                        return
                      }
                      setForm((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        provider: targetProvider,
                        codexApiKind: targetProvider === 'openai' ? 'responses' : 'chat',
                      }))
                    }}
                    options={[
                      { label: 'Anthropic 格式', value: 'anthropic' },
                      { label: 'OpenAI 格式', value: 'openai' },
                    ]}
                  />
                </>
              )}

              {availablePresets.length > 0 && (
                <>
                  <label className="pv_form_label">
                    供应商模板
                    <span className="pv_form_sub">基于官方公开文档预填，后续仍可修改</span>
                  </label>
                  <div className="pv_form_select_row">
                    <Select
                      style={{ width: 220 }}
                      value={form.presetId}
                      disabled={!!profileId}
                      onChange={(v) => {
                        setFetchedModels([])
                        const presetId = v
                        if (presetId === 'custom') {
                          set('presetId', 'custom')
                          return
                        }
                        const preset = getProviderPresetById(presetId)
                        if (preset) applyPreset(preset)
                      }}
                      options={[
                        { label: '自定义', value: 'custom' },
                        ...availablePresets.map((preset) => {
                          const meta = getVendorMeta(preset.vendorId)
                          const baseName = preset.name || meta?.name || preset.vendorId
                          return { label: baseName, value: preset.id }
                        }),
                      ]}
                    />
                  </div>
                </>
              )}

              <label className="pv_form_label">
                模型配置图标
                <span className="pv_form_sub">找不到心仪图标时可选择“通用模型”</span>
              </label>
              <button
                type="button"
                className="pv_icon_picker_trigger pv_form_select_preview"
                aria-label="修改模型配置图标"
                title="修改模型配置图标"
                onClick={() => {
                  setIconPickerStyle(form.providerIcon.style)
                  setIconPickerSearch('')
                  setIconPickerOpen(true)
                }}
              >
                <ProviderLogo
                  vendor={currentVendor}
                  icon={form.providerIcon}
                  size={36}
                  shape="rounded"
                />
              </button>

              <label className="pv_form_label">显示名称</label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="例：Anthropic · Claude"
              />

              <label className="pv_form_label">
                BaseURL
                <span className="pv_form_sub">服务基础地址</span>
              </label>
              <div className="pv_field_stack">
                <Input
                  value={form.endpoint}
                  onChange={(e) => set('endpoint', e.target.value)}
                  placeholder={getProviderBaseUrlPlaceholder(form)}
                />
                {requestEndpointPreview && (
                  <div className="pv_endpoint_inline_hint" role="note" aria-live="polite">
                    <span className="pv_endpoint_inline_hint_label">{requestEndpointPreview.label}：</span>
                    <code className="pv_endpoint_inline_hint_code">{requestEndpointPreview.url}</code>
                  </div>
                )}
              </div>

              {form.provider === 'openai' && isChatModel && (
                <>
                  <label className="pv_form_label">
                    Codex API 类型
                  </label>
                  <Select
                    value={form.codexApiKind}
                    onChange={(v) => set('codexApiKind', v as 'chat' | 'responses' | 'embedding')}
                    options={[
                      { label: 'Responses API（推荐）', value: 'responses' },
                      { label: 'Chat Completions（兼容旧/第三方）', value: 'chat' },
                      { label: 'Embeddings（向量模型）', value: 'embedding' },
                    ]}
                  />
                </>
              )}

              <label className="pv_form_label">
                API Key
              </label>
              <InputPassword
                value={form.apiKey}
                onChange={(e) => {
                  setApiKeyDirty(true)
                  set('apiKey', e.target.value)
                }}
                placeholder={
                  profileId
                    ? '已读取保存的 Key；修改后保存才会更新'
                    : isDedicatedMediaType
                    ? '媒体平台 API Key'
                    : 'sk-ant-...'
                }
                autoComplete="new-password"
              />

              {isChatModel && (
                <>
                  <label className="pv_form_label">
                    连接与模型
                  </label>
                  <div className="pv_connection_actions">
                    <div className="pv_form_control_inline">
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Wifi size={12} />}
                        loading={testingConnection}
                        disabled={saving || fetchingModels}
                        onClick={() => void handleTestConnection()}
                      >
                        测试连接
                      </Button>
                    </div>
                    {connectionFeedback && (
                      <div className={`pv_inline_status pv_inline_status_${connectionFeedback.tone}`} role="status" aria-live="polite">
                        <span className="pv_inline_status_dot" aria-hidden="true" />
                        <span>{connectionFeedback.message}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              <label className="pv_form_label">{isDedicatedMediaType ? '默认调用模型' : '默认 Provider'}</label>
              <div className="pv_form_control_inline">
                <Switch
                  size="middle"
                  checked={form.isDefault}
                  onChange={(checked: boolean) => set('isDefault', checked)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─── 模型配置信息 ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <Icons.Cpu size={11} />
            </span>
            <span className="pv_section_title">模型配置信息</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">
                默认模型 ID
              </label>
              <div className="pv_field_stack">
                <div className="pv_form_control_inline pv_form_control_inline-wrap">
                  <Input
                    value={form.defaultModel}
                    onChange={(e) => {
                      const next = e.target.value
                      // defaultModel 立即更新保证输入响应
                      set('defaultModel', next)
                      // modelIds 防抖更新（避免每个字符都往列表里加模型）
                      debouncedUpdateModelIds(next)
                    }}
                    placeholder="例：claude-sonnet-4-20250514"
                  />
                  {isChatModel && (
                    fetchedModelIds.length > 0 ? (
                      <Dropdown
                        menu={{ items: [] }}
                        open={modelPickerOpen}
                        trigger={['click']}
                        placement="bottomRight"
                        onOpenChange={(next: boolean) => {
                          setModelPickerOpen(next)
                          if (!next) setModelPickerSearch('')
                        }}
                        popupRender={() => (
                          <div className="pv_model_dropdown">
                            <div className="pv_model_dropdown_search">
                              <Icons.Search size={13} />
                              <input
                                value={modelPickerSearch}
                                onChange={(e) => setModelPickerSearch(e.target.value)}
                                placeholder="搜索模型"
                                autoFocus
                              />
                            </div>
                            <div className="pv_model_dropdown_list">
                              <button
                                type="button"
                                className="pv_model_dropdown_item"
                                onClick={() => {
                                  setModelPickerOpen(false)
                                  setModelPickerSearch('')
                                  void handleFetchModels()
                                }}
                              >
                                <span>重新获取模型列表</span>
                              </button>
                              {filteredFetchedModelIds.length === 0 ? (
                                <div className="pv_model_dropdown_empty">没有匹配结果</div>
                              ) : (
                                filteredFetchedModelIds.map((id) => {
                                  const active = form.defaultModel.trim() === id
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`pv_model_dropdown_item${active ? ' active' : ''}`}
                                      onClick={() => {
                                        setDefaultModelFromSelection(id)
                                        setModelPickerOpen(false)
                                        setModelPickerSearch('')
                                      }}
                                    >
                                      <span>{id}</span>
                                      {active && <Icons.Check size={14} />}
                                    </button>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        )}
                      >
                        <Button
                          type="text"
                          style={{height: '100%'}}
                          icon={<Icons.ChevronDown size={12} />}
                          loading={fetchingModels}
                          disabled={saving || testingConnection}
                          title="从已获取模型中选择默认模型"
                        />
                      </Dropdown>
                    ) : (
                      <Button
                        type="text"
                        icon={<Icons.Download size={12} />}
                        loading={fetchingModels}
                        disabled={saving || testingConnection}
                        onClick={() => void handleFetchModels()}
                      >
                        获取模型
                      </Button>
                    )
                  )}
                </div>
                {isChatModel && (
                  <span className="pv_form_hint">
                    {fetchingModels
                      ? '正在获取模型列表…'
                      : fetchedModelIds.length > 0
                        ? `已获取 ${fetchedModelIds.length} 个模型；点击右侧箭头搜索、选择默认模型`
                        : '支持直接输入模型 ID；点击右侧按钮获取供应商支持的模型列表'}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="pv_advanced_toggle"
                aria-expanded={advancedOpen}
                aria-controls="provider-advanced-settings"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <span className="pv_advanced_toggle_icon"><Icons.Settings size={14} /></span>
                <span className="pv_advanced_toggle_text">
                  <span className="pv_advanced_toggle_title">高级设置</span>
                  <span className="pv_advanced_toggle_summary">{advancedSummary}</span>
                </span>
                {advancedOpen ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
              </button>

              {advancedOpen && (
                <div id="provider-advanced-settings" className="pv_advanced_fields">
                  <div className="pv_form_grid">

              {isChatModel && (
                <>
                  <label className="pv_form_label">
                    附加生成能力
                  </label>
                  <div className="pv_form_control_inline">
                    <Switch
                      size="middle"
                      checked={form.mediaGenerationEnabled}
                      onChange={(checked: boolean) => set('mediaGenerationEnabled', checked)}
                    />
                  </div>
                </>
              )}

              {form.modelType === 'image' && (
                <>
                  <label className="pv_form_label">
                    生图接口来源
                    <span className="pv_form_sub">决定图片请求 body、路径、尺寸参数和轮询策略</span>
                  </label>
                  <Select
                    value={form.imageProvider}
                    onChange={(v) => {
                      const imageProvider = normalizeImageProvider(v)
                      const defaults = imageProviderDefaults(imageProvider)
                      setForm((prev) => ({
                        ...prev,
                        provider: 'openai',
                        imageProvider,
                        imageApiType: defaults.mode,
                        mediaProvider: mediaProviderFromImageKind(imageProvider),
                        mediaApiType: defaults.mode,
                        endpoint: defaults.endpoint || prev.endpoint,
                        codexApiKind: 'chat',
                      }))
                    }}
                    options={IMAGE_PROVIDER_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                  />

                </>
              )}

              {/* ─── 多媒体能力（图片 / 语音 / 视频）─── */}
              {mediaPanelVisible && (
                <>
                  <label className="pv_form_label">
                    平台适配器
                    <span className="pv_form_sub">决定默认的请求端点与异步轮询策略</span>
                  </label>
                  <Select
                    value={form.mediaProvider || mediaProviderFromImageKind(form.imageProvider)}
                    onChange={(v) => set('mediaProvider', v as MediaProviderKind)}
                    options={USABLE_MEDIA_PROVIDER_KINDS.map((kind) => ({
                      label: MEDIA_PROVIDER_LABELS[kind],
                      value: kind,
                    }))}
                  />

                  <label className="pv_form_label">
                    调用方式
                    <span className="pv_form_sub">手动配置：sync 同步 / async 任务轮询 / auto 自动兼容</span>
                  </label>
                  <Select
                    value={form.mediaApiType}
                    onChange={(v) => {
                      const mediaApiType = v as MediaApiType
                      setForm((prev) => ({
                        ...prev,
                        mediaApiType,
                        imageApiType: prev.modelType === 'image'
                          ? normalizeImageApiType(mediaApiType)
                          : prev.imageApiType,
                      }))
                    }}
                    options={MEDIA_API_TYPES.map((mode) => ({
                      label: mode === 'sync' ? 'sync · 同步返回' : mode === 'async' ? 'async · 任务轮询' : 'auto · 自动兼容',
                      value: mode,
                    }))}
                  />

                  <label className="pv_form_label">
                    模型清单
                  </label>
                  <div className="pv_media_model_refs">
                    <div className="pv_media_manifest_list">
                      {mediaCatalogLoading ? (
                        <div className="pv_media_manifest_empty">正在加载模型清单…</div>
                      ) : mediaCatalogForForm.length === 0 ? (
                        <div className="pv_media_manifest_empty">
                          {isChatModel ? '该服务商暂未收录内置生图/视频模型，可在下方手动添加自定义模型 ID' : '暂无匹配的内置模型清单'}
                        </div>
                      ) : (
                        mediaCatalogForForm.map((model) => (
                          <label
                            key={model.manifestId}
                            className={[
                              'pv_media_manifest_item',
                              selectedManifestIds.has(model.manifestId) ? 'pv_media_manifest_item_selected' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <Checkbox
                              checked={selectedManifestIds.has(model.manifestId)}
                              onChange={(checked: boolean) => toggleMediaModelRef(model, checked)}
                            />
                            <div className="pv_media_manifest_main">
                              <div className="pv_media_manifest_title">
                                <span>{model.displayName}</span>
                                <Tag size="middle" color="gray">{model.providerKind}</Tag>
                                <Tag size="middle" color="blue">{model.invocationMode}</Tag>
                              </div>
                              <div className="pv_media_manifest_meta">
                                {model.effectiveModelId}
                              </div>
                              <div className="pv_media_manifest_caps">
                                {model.capabilities.slice(0, 4).map((capability) => (
                                  <Tag key={capability.id} size="middle" color="gray">
                                    {capability.label}
                                  </Tag>
                                ))}
                              </div>
                            </div>
                            {/* 已勾选的模型才可设为默认；按钮需阻止冒泡，避免误触 checkbox */}
                            {selectedManifestIds.has(model.manifestId) && (
                              <div className="pv_media_manifest_actions">
                                {form.defaultModel.trim() === model.effectiveModelId.trim() ? (
                                  <Tag size="middle" color="green">默认</Tag>
                                ) : (
                                  <Button
                                    size="middle"
                                    type="text"
                                    icon={<Icons.Star size={12} />}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      setMediaDefaultModel(model.effectiveModelId)
                                    }}
                                    title="设为默认调用模型"
                                    aria-label={`将 ${model.effectiveModelId} 设为默认`}
                                  >
                                    设为默认
                                  </Button>
                                )}
                              </div>
                            )}
                          </label>
                        ))
                      )}
                    </div>

                    {/* ─── 自定义模型引用（不在内置目录里，可手动增删） ─── */}
                    {customModelRefs.length > 0 && (
                      <div className="pv_media_manifest_list">
                        {customModelRefs.map((ref) => (
                          <div key={ref.manifestId} className="pv_media_manifest_item pv_media_manifest_item_selected pv_media_manifest_item_static">
                            <div className="pv_media_manifest_main">
                              <div className="pv_media_manifest_title">
                                <span>{ref.modelId}</span>
                                <Tag size="middle" color="purple">自定义</Tag>
                                {ref.manifest && <Tag size="middle" color="green">协议已配置</Tag>}
                                <Tag size="middle" color="gray">{form.mediaProvider || form.imageProvider}</Tag>
                              </div>
                              <div className="pv_media_manifest_meta">
                                {form.defaultModel.trim() === ref.modelId?.trim()
                                  ? `${ref.modelId} · 当前默认`
                                  : ref.modelId}
                              </div>
                            </div>
                            <div className="pv_media_manifest_actions">
                              {(form.modelType === 'image' || form.modelType === 'video') && (
                                <Button
                                  size="middle"
                                  type="text"
                                  icon={<Icons.Settings size={12} />}
                                  onClick={() => openCustomManifestEditor(ref)}
                                >
                                  编辑协议
                                </Button>
                              )}
                              {form.defaultModel.trim() === ref.modelId?.trim() ? (
                                <Tag size="middle" color="green">默认</Tag>
                              ) : (
                                <Button
                                  size="middle"
                                  type="text"
                                  icon={<Icons.Star size={12} />}
                                  onClick={() => setMediaDefaultModel(ref.modelId ?? '')}
                                  title="设为默认调用模型"
                                  aria-label={`将 ${ref.modelId} 设为默认`}
                                >
                                  设为默认
                                </Button>
                              )}
                              <Button
                                size="middle"
                                type="text"
                                danger
                                icon={<Icons.X />}
                                onClick={() => removeMediaModelRef(ref.manifestId)}
                                title="移除自定义模型"
                                aria-label={`移除自定义模型 ${ref.modelId}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="pv_form_label">
                    添加自定义模型
                    <span className="pv_form_sub">直接输入模型 ID 添加</span>
                  </label>
                  <div className="pv_custom_model_add">
                    <Input
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (customModelInput.trim()) {
                            addCustomMediaModel(customModelInput)
                            setCustomModelInput('')
                          }
                        }
                      }}
                      placeholder={
                        form.modelType === 'image' ? '如 nano-banana、flux-pro、seedream-4.0…'
                          : form.modelType === 'video' ? '如 sora-2、kling-v2-6、MiniMax-Hailuo-02…'
                            : '输入模型 ID 后按 Enter 添加'
                      }
                    />
                    <Button
                      type="primary"
                      icon={<Icons.Plus />}
                      disabled={!customModelInput.trim()}
                      onClick={() => {
                        if (customModelInput.trim()) {
                          addCustomMediaModel(customModelInput)
                          setCustomModelInput('')
                        }
                      }}
                    >
                      添加
                    </Button>
                  </div>

                  {mediaCapabilityOptions.length > 0 && (
                    <>
                      <label className="pv_form_label">
                        支持能力
                      </label>
                      <div className="pv_media_capabilities">
                        {mediaCapabilityOptions.map((capability) => (
                          <Checkbox
                            key={capability}
                            checked={form.mediaCapabilities.includes(capability)}
                            onChange={(checked: boolean) => {
                              setForm((prev) => {
                                const set = new Set(prev.mediaCapabilities)
                                if (checked) set.add(capability)
                                else set.delete(capability)
                                return { ...prev, mediaCapabilities: [...set] }
                              })
                            }}
                          >
                            {MEDIA_CAPABILITY_LABELS[capability]}
                          </Checkbox>
                        ))}
                      </div>
                    </>
                  )}

                  {showMediaDefaults && (
                    <>
                      <label className="pv_form_label">
                        参数默认值
                      </label>
                      <div className="pv_media_defaults">
                        {form.modelType === 'image' && (
                          <>
                            {(mediaDefaultOptionSets.imageSize.length > 0 || form.mediaImageSize) &&
                              (mediaDefaultOptionSets.imageSize.length > 0 ? (
                                <Select
                                  value={form.mediaImageSize || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaImageSize', value == null ? '' : String(value))}
                                  placeholder="图片尺寸 / 比例"
                                  options={mediaDefaultOptionSets.imageSize}
                                />
                              ) : (
                                <Input
                                  value={form.mediaImageSize}
                                  onChange={(e) => set('mediaImageSize', e.target.value)}
                                  placeholder="图片尺寸 (1024x1024 / 16:9)"
                                />
                              ))}
                            {(mediaDefaultOptionSets.imageSize.length > 0 || form.mediaImageN) && (
                              <Input
                                value={form.mediaImageN}
                                onChange={(e) => set('mediaImageN', e.target.value)}
                                placeholder="图片数量 n"
                              />
                            )}
                            {(mediaDefaultOptionSets.imageQuality.length > 0 || form.mediaImageQuality) &&
                              (mediaDefaultOptionSets.imageQuality.length > 0 ? (
                                <Select
                                  value={form.mediaImageQuality || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaImageQuality', value == null ? '' : String(value))}
                                  placeholder="图片质量"
                                  options={mediaDefaultOptionSets.imageQuality}
                                />
                              ) : (
                                <Input
                                  value={form.mediaImageQuality}
                                  onChange={(e) => set('mediaImageQuality', e.target.value)}
                                  placeholder="图片质量 (hd / standard)"
                                />
                              ))}
                          </>
                        )}
                        {form.modelType === 'voice' && (
                          <>
                            <Input
                              value={form.mediaAudioVoice}
                              onChange={(e) => set('mediaAudioVoice', e.target.value)}
                              placeholder="语音 voice (alloy / nova)"
                            />
                            {(mediaDefaultOptionSets.audioFormat.length > 0 || form.mediaAudioFormat) &&
                              (mediaDefaultOptionSets.audioFormat.length > 0 ? (
                                <Select
                                  value={form.mediaAudioFormat || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaAudioFormat', value == null ? '' : String(value))}
                                  placeholder="语音格式 / 输出格式"
                                  options={mediaDefaultOptionSets.audioFormat}
                                />
                              ) : (
                                <Input
                                  value={form.mediaAudioFormat}
                                  onChange={(e) => set('mediaAudioFormat', e.target.value)}
                                  placeholder="语音格式 (mp3 / wav)"
                                />
                              ))}
                          </>
                        )}
                        {form.modelType === 'video' && (
                          <>
                            {(mediaDefaultOptionSets.videoAspectRatio.length > 0 || form.mediaVideoAspectRatio) &&
                              (mediaDefaultOptionSets.videoAspectRatio.length > 0 ? (
                                <Select
                                  value={form.mediaVideoAspectRatio || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaVideoAspectRatio', value == null ? '' : String(value))}
                                  placeholder="视频比例"
                                  options={mediaDefaultOptionSets.videoAspectRatio}
                                />
                              ) : (
                                <Input
                                  value={form.mediaVideoAspectRatio}
                                  onChange={(e) => set('mediaVideoAspectRatio', e.target.value)}
                                  placeholder="视频比例 (16:9)"
                                />
                              ))}
                            {(mediaDefaultOptionSets.videoDuration.length > 0 || form.mediaVideoDuration) &&
                              (mediaDefaultOptionSets.videoDuration.length > 0 ? (
                                <Select
                                  value={form.mediaVideoDuration || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaVideoDuration', value == null ? '' : String(value))}
                                  placeholder="视频时长 (秒)"
                                  options={mediaDefaultOptionSets.videoDuration}
                                />
                              ) : (
                                <Input
                                  value={form.mediaVideoDuration}
                                  onChange={(e) => set('mediaVideoDuration', e.target.value)}
                                  placeholder="视频时长 (秒)"
                                />
                              ))}
                            {(mediaDefaultOptionSets.videoQuality.length > 0 || form.mediaVideoQuality) &&
                              (mediaDefaultOptionSets.videoQuality.length > 0 ? (
                                <Select
                                  value={form.mediaVideoQuality || undefined}
                                  allowClear
                                  onChange={(value) => set('mediaVideoQuality', value == null ? '' : String(value))}
                                  placeholder="视频质量 / 分辨率"
                                  options={mediaDefaultOptionSets.videoQuality}
                                />
                              ) : (
                                <Input
                                  value={form.mediaVideoQuality}
                                  onChange={(e) => set('mediaVideoQuality', e.target.value)}
                                  placeholder="视频质量 (hd)"
                                />
                              ))}
                          </>
                        )}
                        {(form.modelType === 'image' || form.modelType === 'video') && (
                          <>
                            <Input
                              value={form.mediaPollInterval}
                              onChange={(e) => set('mediaPollInterval', e.target.value)}
                              placeholder="轮询间隔 ms"
                            />
                            <Input
                              value={form.mediaPollTimeout}
                              onChange={(e) => set('mediaPollTimeout', e.target.value)}
                              placeholder="轮询超时 ms"
                            />
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {isChatModel && (
                <>
                  <label className="pv_form_label">
                    上下文窗口
                  </label>
                  <div className="pv_form_control_inline">
                    <Select
                      size="middle"
                      style={{ width: 160 }}
                      value={
                        isCustomContextWindow
                          ? -1
                          : resolveContextWindowSelectValue(form.contextWindow)
                      }
                      onChange={(value: number) => {
                        if (value === -1) {
                          // 切到自定义：保留当前值或回落 200k；isCustomContextWindow 独立标记意图
                          setIsCustomContextWindow(true)
                          const next = form.contextWindow > 0 ? form.contextWindow : 200_000
                          setForm((prev) => ({ ...prev, contextWindow: next, supportsMillionContext: next === 1_000_000 }))
                        } else {
                          setIsCustomContextWindow(false)
                          setForm((prev) => ({
                            ...prev,
                            contextWindow: value,
                            supportsMillionContext: value === 1_000_000,
                          }))
                        }
                      }}
                      options={CONTEXT_WINDOW_PRESETS}
                    />
                    {isCustomContextWindow && (
                      <Input
                        size="middle"
                        style={{ width: 140, marginInlineStart: 8 }}
                        type="number"
                        min={1024}
                        max={10_000_000}
                        step={1024}
                        value={form.contextWindow > 0 ? String(form.contextWindow) : ''}
                        placeholder="tokens"
                        onChange={(e) => {
                          const raw = Number((e.target as HTMLInputElement).value)
                          // 空 / 非数 / <=0 → 0 视为暂未输入，不退出自定义模式（由 isCustomContextWindow 维持）；
                          // 上限 10_000_000 与后端 zod .max 一致，避免提交时才报错。
                          let next = 0
                          if (Number.isFinite(raw) && raw > 0) {
                            next = Math.min(Math.floor(raw), 10_000_000)
                          }
                          setForm((prev) => ({ ...prev, contextWindow: next, supportsMillionContext: next === 1_000_000 }))
                        }}
                      />
                    )}
                  </div>
                </>
              )}

                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── 鉴权（API Key）已上移到「服务商配置信息」section 里紧贴 BaseURL， ─── */}
        {/* 让测试连接 / 获取模型能直接看到 Key 是否已填。 */}

        {advancedOpen && isChatModel && (
          <>
            {/* ─── 可用模型 ─── */}
            <div className="pv_section">
              <div className="pv_section_head">
                <span className="pv_section_icon">
                  <Icons.Archive size={11} />
                </span>
                <span className="pv_section_title">可用模型</span>
                <span className="pv_section_hint">
                  {fetchedModelIds.length > 0
                    ? `候选模型 ${fetchedModelIds.length} 个；只有点选启用的模型才会在全局可用`
                    : '仅已启用模型会在全局出现；默认模型会自动保留为可用'}
                </span>
                {(() => {
                  const defaultModel = form.defaultModel.trim()
                  const othersCount = form.modelIds.filter((m) => m !== defaultModel).length
                  const canReset = !!defaultModel && othersCount > 0
                  const disabledHint = !defaultModel
                    ? '请先点击某个 chip 设为默认模型'
                    : '当前没有其他已启用模型'
                  return (
                    <button
                      type="button"
                      className="pv_section_action"
                      disabled={!canReset}
                      title={
                        canReset
                          ? `取消其余 ${othersCount} 个模型的启用状态，仅保留默认模型「${defaultModel}」`
                          : disabledHint
                      }
                      onClick={() => {
                        setForm((prev) => {
                          const d = prev.defaultModel.trim()
                          if (!d) return prev
                          return { ...prev, modelIds: [d] }
                        })
                      }}
                    >
                      <Icons.Check size={11} />
                      <span>只选默认</span>
                    </button>
                  )
                })()}
              </div>
              <div className="pv_section_body">
                {fetchedModelIds.length > 0 && (
                  <div className="pv_model_picker_block">
                    <div className="pv_model_picker_head">
                      <span className="pv_model_picker_title">候选模型目录</span>
                      <span className="pv_model_picker_hint">点选后才会进入全局可用模型列表</span>
                    </div>
                    <div className="pv_model_toggle_grid">
                      {fetchedModelIds.map((id) => {
                        const isSelected = form.modelIds.includes(id)
                        const isDefault = form.defaultModel.trim() === id
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`pv_model_toggle${isSelected ? ' is-selected' : ''}${isDefault ? ' is-default' : ''}`}
                            onClick={() => toggleFetchedModelSelection(id, !isSelected)}
                            title={isDefault ? `${id}（默认模型，需先切换默认后才能取消启用）` : id}
                          >
                            <span className="pv_model_toggle_check" aria-hidden>
                              {isSelected ? <Icons.Check size={12} /> : null}
                            </span>
                            <span className="pv_model_toggle_label">{id}</span>
                            {isDefault && <span className="pv_model_toggle_badge">默认</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="pv_model_picker_block">
                  <div className="pv_model_picker_head">
                    <span className="pv_model_picker_title">已启用模型（全局可用）</span>
                    <span className="pv_model_picker_hint">点击 chip 可切换默认；也支持手动补充自定义模型 ID</span>
                  </div>
                  <ChipList
                    value={form.modelIds}
                    onChange={(ids) => set('modelIds', ids)}
                    onSelectDefault={(id) => {
                      // 把 id 设为默认模型：从 modelIds 里把它放到最前
                      setForm((prev) => {
                        const trimmed = id.trim()
                        if (!trimmed) return prev
                        const rest = prev.modelIds.filter((m) => m !== trimmed)
                        return {
                          ...prev,
                          defaultModel: trimmed,
                          modelIds: uniqPreserveOrder([trimmed, ...rest]),
                        }
                      })
                    }}
                    locked={form.defaultModel.trim() ? [form.defaultModel.trim()] : []}
                    placeholder="输入模型 ID 后按 Enter 添加…"
                    emptyText="尚未添加任何模型（默认模型会自动加入）"
                    addLabel="添加"
                    removeLabel="移除"
                  />
                </div>
              </div>
            </div>

            {usesClaudeTierMapping(form) && (
              <div className="pv_section">
                <div className="pv_section_head">
                  <span className="pv_section_icon">
                    <Icons.Settings size={11} />
                  </span>
                  <span className="pv_section_title">Claude 档位映射</span>
                  <span className="pv_section_hint">可选；留空则该档自动回落「默认模型 ID」</span>
                </div>
                <div className="pv_section_body">
                  <div className="pv_tier_grid">
                    <div className="pv_tier_cell">
                      <label className="pv_form_label">
                        Haiku 档
                        <span className="pv_form_sub">SDK 派生子 agent / Task 工具默认走此档</span>
                      </label>
                      <Input
                        value={form.haikuModel}
                        onChange={(e) => set('haikuModel', e.target.value)}
                        placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                      />
                    </div>
                    <div className="pv_tier_cell">
                      <label className="pv_form_label">
                        Sonnet 档
                        <span className="pv_form_sub">主对话默认档；通常等同于默认模型</span>
                      </label>
                      <Input
                        value={form.sonnetModel}
                        onChange={(e) => set('sonnetModel', e.target.value)}
                        placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                      />
                    </div>
                    <div className="pv_tier_cell">
                      <label className="pv_form_label">
                        Opus 档
                        <span className="pv_form_sub">Plan / Review 等高能力 agent 使用</span>
                      </label>
                      <Input
                        value={form.opusModel}
                        onChange={(e) => set('opusModel', e.target.value)}
                        placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        open={iconPickerOpen}
        title="选择模型配置图标"
        footer={null}
        width={720}
        onCancel={() => setIconPickerOpen(false)}
      >
        <div className="pv_icon_picker">
          <div className="pv_icon_picker_toolbar">
            <Input
              value={iconPickerSearch}
              onChange={(event) => setIconPickerSearch(event.target.value)}
              placeholder="搜索模型、厂商或关键词..."
              prefix={<Icons.Search size={14} />}
              allowClear
            />
            <Select
              value={iconPickerStyle}
              onChange={(value) => setIconPickerStyle(value as ProviderIconStyle)}
              options={PROVIDER_ICON_STYLES}
            />
          </div>
          <div className="pv_icon_picker_grid">
            {filteredProviderIcons.map((item) => {
              const selected = form.providerIcon.id === item.id && form.providerIcon.style === iconPickerStyle
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pv_icon_picker_item${selected ? ' is-selected' : ''}`}
                  onClick={() => selectProviderIcon(item.id)}
                  title={item.label}
                >
                  <ProviderLogo
                    vendor={currentVendor}
                    icon={{ id: item.id, style: iconPickerStyle }}
                    size={32}
                    shape="rounded"
                  />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
          {filteredProviderIcons.length === 0 && (
            <div className="pv_icon_picker_empty">没有找到匹配的图标</div>
          )}
        </div>
      </Modal>
      <Modal
        open={editingCustomManifestId != null}
        title="自定义模型调用协议"
        okText="检查并保存"
        cancelText="取消"
        width={780}
        onOk={saveCustomManifestDraft}
        onCancel={() => {
          setEditingCustomManifestId(null)
          setCustomManifestError('')
        }}
      >
        {(() => {
          // 仅当 raw JSON 可解析为合法对象时，渲染结构化 Contract 编辑器；解析失败时
          // 仅显示 textarea，让用户先用 JSON 修复语法错误。
          let parsedManifest: MediaModelManifest | null = null
          if (customManifestDraft.trim().length > 0) {
            try {
              const obj = JSON.parse(customManifestDraft)
              if (obj && typeof obj === 'object' && Array.isArray(obj.capabilities)) {
                parsedManifest = obj as MediaModelManifest
              }
            } catch {
              parsedManifest = null
            }
          }
          return parsedManifest ? (
            <details open style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Contract V2 结构化编辑（修改会同步回 JSON）
              </summary>
              <div style={{ marginTop: 8 }}>
                <ProviderManifestContractEditor
                  manifest={parsedManifest}
                  onChange={applyManifestFromContractEditor}
                />
              </div>
            </details>
          ) : null
        })()}
        <textarea
          className="pv_manifest_editor"
          value={customManifestDraft}
          onChange={(event) => setCustomManifestDraft(event.target.value)}
          spellCheck={false}
          aria-label="自定义模型 Manifest JSON"
        />
        {customManifestError && (
          <Alert type="error" message="协议校验失败" description={<pre className="pv_manifest_error">{customManifestError}</pre>} />
        )}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Dry-run 预览：用当前 manifest 裁剪一段示例 modelParams（不需要先保存）
          </summary>
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 4, fontSize: 12, opacity: 0.75 }}>
              对 manifest 的第一个 capability（id: <code>{(() => {
                try {
                  const m = JSON.parse(customManifestDraft) as MediaModelManifest
                  return m?.capabilities?.[0]?.id ?? '(未解析)'
                } catch {
                  return '(manifest JSON 无效)'
                }
              })()}</code>）执行裁剪；可观察 strict / passthrough / forbidden 的实际效果。
            </div>
            <textarea
              value={dryRunInput}
              onChange={(event) => setDryRunInput(event.target.value)}
              rows={6}
              placeholder='例如 {"prompt": "...", "size": "1024x1024", "watermark": true}'
              spellCheck={false}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 12 }}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                onClick={runDryRunPreview}
                disabled={dryRunLoading}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                {dryRunLoading ? '运行中…' : '运行裁剪'}
              </button>
              {dryRunError && (
                <span style={{ color: '#cf1322', fontSize: 12 }}>{dryRunError}</span>
              )}
            </div>
            {dryRunResult && (
              <div style={{ marginTop: 8 }}>
                {dryRunResult.fallbackReason && (
                  <Alert
                    type="warning"
                    message="跳过裁剪（fallback）"
                    description={<pre className="pv_manifest_error">{dryRunResult.fallbackReason}</pre>}
                  />
                )}
                <div style={{ marginBottom: 4, marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  裁剪后 modelParams（实际下发给 provider 的内容）
                </div>
                <pre className="pv_manifest_error" style={{ maxHeight: 220 }}>
                  {JSON.stringify(dryRunResult.prunedModelParams, null, 2)}
                </pre>
                {dryRunResult.droppedParams.length > 0 && (
                  <>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>被丢弃的参数（droppedParams）</div>
                    <pre className="pv_manifest_error" style={{ maxHeight: 180 }}>
                      {JSON.stringify(dryRunResult.droppedParams, null, 2)}
                    </pre>
                  </>
                )}
                {dryRunResult.warnings.length > 0 && (
                  <>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>警告（warnings）</div>
                    <pre className="pv_manifest_error" style={{ maxHeight: 160 }}>
                      {JSON.stringify(dryRunResult.warnings, null, 2)}
                    </pre>
                  </>
                )}
                {dryRunResult.validationIssues.length > 0 && (
                  <>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      校验问题（validationIssues，包含 forbidden_param / type_mismatch 等）
                    </div>
                    <pre className="pv_manifest_error" style={{ maxHeight: 180 }}>
                      {JSON.stringify(dryRunResult.validationIssues, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        </details>
      </Modal>
    </Drawer>
  )
}

function normalizeProviderKind(value: string): ProviderKind {
  return value === 'anthropic' ? 'anthropic' : 'openai'
}

/** 去重并保留顺序 */
function uniqPreserveOrder(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    const t = v.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export default ProvidersView
// ProviderEditPanel is also exported as a named export above for backwards
// compatibility (tests, and any consumer that imports it directly from the
// original location).
