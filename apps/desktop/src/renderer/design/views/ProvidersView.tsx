import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ActionIcon, Button, Tag, Checkbox, Drawer, Alert, Input, InputPassword, Select, Modal, SearchBar,
} from '@lobehub/ui'
// TODO(lobe-migration): @lobehub/ui 没有 Badge/Switch 命名导出;临时从 antd 引用,与 SparkOverlays 行为一致
import { Badge, Switch } from 'antd'
import { Icons } from '../Icons'
import { ChipList } from '../components/ChipList'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
import { ProviderLogo } from '../components/ProviderLogo'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useDebouncedCallback } from '../hooks/useDebounce'
import { useToast } from '../components/Toast'
import {
  PROVIDER_PRESETS,
  getProviderPresetById,
  getVendorMeta,
  getPresetsByVendor,
  getUniqueVendorIds,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
  MEDIA_PROVIDER_KINDS,
  MEDIA_API_TYPES,
  MEDIA_CAPABILITY_IDS,
  isMediaProviderKind,
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
} from '@spark/protocol'
import MultiSelectToolbar from './provider-import-export/MultiSelectToolbar'
import ImportPreviewModal from './provider-import-export/ImportPreviewModal'
import './ProvidersView.less'

type ProviderKind = 'anthropic' | 'openai'
type ProviderModelType = 'image' | 'text' | 'multimodal' | 'voice' | 'video'
type ImageProviderKind = 'openai' | 'apimart' | 'openrouter' | 'gemini' | 'seeddance' | 'bailian' | 'zhipu' | 'xai' | 'custom'
type ProviderForm = {
  presetId: string
  name: string
  provider: ProviderKind
  defaultModel: string
  /** Chip 列表内部的 model id 数组（默认模型在最后添加时会被锁定） */
  modelIds: string[]
  endpoint: string
  codexApiKind: 'chat' | 'responses'
  supportsMillionContext: boolean
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

const EMPTY_MEDIA_FORM = {
  mediaProvider: '' as MediaProviderKind | '',
  mediaApiType: 'auto' as MediaApiType,
  mediaCapabilities: [] as MediaCapabilityId[],
  mediaModelRefs: [] as ProviderMediaModelRef[],
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

const MEDIA_PROVIDER_LABELS: Record<MediaProviderKind, string> = {
  apimart: 'APIMart',
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
  custom: '自定义',
}

const MEDIA_CAPABILITY_LABELS: Record<MediaCapabilityId, string> = {
  'image.generate': '生图',
  'image.edit': '图生图 / 图片编辑',
  'image.variations': '图片变体',
  'audio.speech': '语音合成',
  'audio.transcription': '语音转写',
  'video.generate': '文生视频',
  'video.image_to_video': '图生视频',
  'video.edit': '视频编辑',
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

/** 把 preset 的 mediaProvider/mediaApiType/mediaCapabilities/mediaDefaults 投影成 ProviderForm 媒体字段 */
function presetMediaForm(preset: ProviderPreset): Pick<ProviderForm,
  | 'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaModelRefs'
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
  | 'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaModelRefs'
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
 * - 非多媒体模型类型：清空媒体字段（传 null/[]）。
 * - 多媒体模型类型：下发 mediaProvider/mediaApiType/mediaCapabilities/mediaDefaults。
 */
function buildMediaUpdateFields(form: ProviderForm): Pick<ProviderUpdateRequest,
  'mediaProvider' | 'mediaApiType' | 'mediaCapabilities' | 'mediaDefaults' | 'mediaModelRefs'> {
  const isMediaModelType = form.modelType === 'image' || form.modelType === 'voice' || form.modelType === 'video'
  if (!isMediaModelType) {
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
  return false
}

function isMediaProviderModelType(modelType: ProviderModelType): boolean {
  return modelType === 'image' || modelType === 'voice' || modelType === 'video'
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
  if (modelType === 'video') return ['video.generate', 'video.image_to_video', 'video.edit']
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

const EMPTY_TIER_MODELS = { haikuModel: '', sonnetModel: '', opusModel: '' } as const
const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageProviderKind; label: string; endpoint: string; mode: ImageGenApiType }> = [
  { value: 'openai', label: 'OpenAI Images', endpoint: 'https://api.openai.com/v1', mode: 'sync' },
  { value: 'apimart', label: 'APIMart', endpoint: 'https://api.apimart.ai/v1', mode: 'async' },
  { value: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', mode: 'sync' },
  { value: 'gemini', label: 'Gemini / Imagen', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', mode: 'sync' },
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [healthMap, setHealthMap] = useState<Record<string, ProviderHealthCheckResponse>>({})
  const [showPresetCatalog, setShowPresetCatalog] = useState(false)
  const [presetCatalogSearch, setPresetCatalogSearch] = useState('')
  /** 从预设创建时，传递给 ProviderEditPanel 的初始 presetId */
  const [initialPresetId, setInitialPresetId] = useState<string | null>(null)

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
    listProviders({})
      .then((r) => setProfiles(r.profiles))
      .catch(console.error)
  }, [listProviders])

  useRefreshable(refresh)

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return window.spark?.on?.('stream:config:changed', (event) => {
      if (event.scope === 'provider') refresh()
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
    setSelectedIds(new Set(profiles.map((p) => p.id)))
  }, [profiles])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const invertSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const p of profiles) {
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
      if (isBuiltInLocalCliProvider({ id })) continue
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
      <MacWindowDragHeader />
      <div className="pv_root">
        {/* ─── Header ─── */}
        <div className="pv_header">
          <div className="pv_header_left">
            <h2>Providers</h2>
            <Tag size="small" color="gray">{profiles.length}</Tag>
          </div>
          <div className="pv_header_right">
            <Button
              size="small"
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
              size="small"
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
            <span className="flex-1" />
            <Button
              size="small"
              shape="circle"
              type="text"
              icon={<Icons.Refresh />}
              onClick={refresh}
              title="刷新 (Ctrl+R)"
              aria-label="刷新"
            />
            <Button
              ref={importButtonRef as any}
              size="small"
              type="default"
              icon={<Icons.Upload />}
              onClick={() => void handleImportFromFile()}
              disabled={importing}
              title="从 .json 导入 Provider 配置"
            >
              导入
            </Button>
            <Button
              size="small"
              type="default"
              icon={<Icons.Copy />}
              onClick={() => void handleImportFromClipboard()}
              disabled={importing}
              title="从剪贴板 JSON 字符串导入"
            >
              从剪贴板
            </Button>
            <Button
              size="small"
              type="default"
              icon={<Icons.Download />}
              onClick={handleExportVisibleScope}
              disabled={profiles.length === 0 || (multiSelect && selectedIds.size === 0)}
              title={multiSelect ? '导出选中的 Provider 到 .json' : '导出全部 Provider 到 .json'}
            >
              {multiSelect ? '导出选中' : '导出'}
            </Button>
            <Button
              size="small"
              type="default"
              icon={<Icons.Copy />}
              onClick={() => void handleCopyToClipboard([])}
              disabled={profiles.length === 0}
              title="复制全部 Provider JSON 到剪贴板"
            >
              复制
            </Button>
            {!multiSelect && (
              <Button
                size="small"
                type="default"
                icon={<Icons.CheckSquare />}
                onClick={enterMultiSelect}
                disabled={profiles.length === 0}
                title="进入多选模式"
              >
                批量
              </Button>
            )}
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

        {/* ─── 可滚动内容区（catalog + cards / empty） ─── */}
        <div className="pv_scroll">
          {profiles.length === 0 ? (
            <div className="pv_empty">
              尚未配置 Provider — 点击「从模板添加」快速开始，或「自定义添加」手动配置
            </div>
          ) : (
            profiles.map((p) => {
              const h = healthMap[p.id]
              const status = h == null ? 'unknown' : h.healthy ? 'ok' : 'error'
              const vendor =
                resolveBuiltinLocalCliVendor(p) ??
                vendorForMediaProvider(p.mediaProvider ?? p.imageProvider ?? undefined) ??
                guessVendorByName(p.name, getUniqueVendorIds()) ??
                (p.provider === 'openai' ? OPENAI_VENDOR_META : CLAUDE_VENDOR_META)
              const builtin = isBuiltInLocalCliProvider(p)
              const builtinDesc = isLocalCodexCliProvider(p)
                ? '内置 · 沿用宿主机本地 Codex CLI 配置（无需 API Key）'
                : '内置 · 沿用宿主机本地 Claude CLI 配置（无需 API Key）'
              // 媒体 Provider 卡片应展示真正配置的 mediaModelRefs，而非旧版/模板预填的 modelIds。
              const isMediaProvider = isMediaProviderModelType((p.modelType as ProviderModelType) ?? 'multimodal')
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
                  name={p.name}
                  desc={
                    builtin
                      ? builtinDesc
                      : isMediaProviderModelType((p.modelType as ProviderModelType) ?? 'multimodal')
                        ? `${mediaProviderDisplayName(p.mediaProvider ?? p.imageProvider ?? undefined)} · 默认 ${p.defaultModel}`
                        : `${p.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'} · 默认 ${p.defaultModel}`
                  }
                  status={status}
                  modelIds={builtin ? [] : cardModelIds}
                  defaultModel={p.defaultModel}
                  isBuiltin={builtin}
                  isDefault={p.isDefault}
                  multiSelect={multiSelect && !builtin}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={() => toggleSelected(p.id)}
                  onEdit={() => {
                    setEditingId(p.id)
                    setTweak('showProviderEdit', true)
                  }}
                  onDelete={() => void handleDelete(p.id)}
                  onHealthCheck={() => void handleHealthCheck(p.id)}
                />
              )
            })
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
        style={{ width: 900 }}
        destroyOnHidden
      >
        <div className="pv_catalog pv_catalog_modal">
          <div className="pv_catalog_hint">
            选择供应商模板快速配置，选择后会打开新建面板，所有字段都可以继续自定义。
          </div>
          <SearchBar
            className="pv_catalog_search"
            placeholder="搜索模板厂商..."
            value={presetCatalogSearch}
            onInputChange={(value) => setPresetCatalogSearch(value)}
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
  name,
  desc,
  status,
  modelIds,
  defaultModel,
  isBuiltin = false,
  isDefault = false,
  multiSelect = false,
  selected = false,
  onToggleSelect,
  onEdit,
  onDelete,
  onHealthCheck,
}: {
  vendor: VendorMeta | null
  name: string
  desc: string
  status: 'ok' | 'warning' | 'off' | 'error' | 'unknown'
  modelIds: string[]
  defaultModel: string
  /** 内置 provider：隐藏编辑/删除按钮，多选时不可勾选 */
  isBuiltin?: boolean
  /** 默认 Provider：用更明显的标签提示 */
  isDefault?: boolean
  /** 多选模式：true 时显示复选框 + 点击行切换选择 */
  multiSelect?: boolean
  /** 是否被选中（仅 multiSelect=true 时生效）*/
  selected?: boolean
  onToggleSelect?: () => void
  onEdit: () => void
  onDelete: () => void
  onHealthCheck: () => void
}) {
  // 渲染前 4 个 model id 概览，其余以 +N 形式展示
  const visibleModels = modelIds.slice(0, 4)
  const moreCount = Math.max(0, modelIds.length - visibleModels.length)

  // 用一个合成的 vendor-meta 来渲染 fallback（无 vendor 时显示首字母 + 中性色）
  const fallbackVendor: VendorMeta | null = vendor ?? {
    id: '',
    name,
    emoji: (name[0] ?? '?').toUpperCase(),
    color: 'var(--text-faint)',
    desc: '',
    logoPath: '',
  }

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
      {multiSelect && (
        <div
          className="flex items-center pt-1"
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
      <ProviderLogo vendor={fallbackVendor} size={44} shape="rounded" />
      <div className="pv_card_info">
        <div className="pv_card_name_row">
          <span className="pv_card_name">{name}</span>
          {isBuiltin && <Tag size="small" color="gray">内置</Tag>}
          {isDefault && (
            <Tag size="small" color="arcoblue" icon={<Icons.StarFill />}>
              默认 Provider
            </Tag>
          )}
          <Tag size="small" color={statusColor as any}>
            <Badge status={status === 'ok' ? 'success' : status === 'error' ? 'error' : status === 'warning' ? 'warning' : 'default'} />
            <span className="ml-1">{statusLabel}</span>
          </Tag>
        </div>
        <div className="pv_card_desc">{desc}</div>
        {modelIds.length > 0 && (
          <div className="pv_card_models">
            {visibleModels.map((m) => (
              <span
                key={m}
                className={`pv_model_pill${m === defaultModel ? ' pv_model_default' : ''}`}
                title={m}
              >
                {m === defaultModel && <Icons.StarFill size={9} />}
                {m}
              </span>
            ))}
            {moreCount > 0 && <span className="pv_model_more">+{moreCount}</span>}
          </div>
        )}
      </div>
      {!multiSelect && (
        <div className="pv_card_actions" onClick={(e) => e.stopPropagation()}>
          {!isBuiltin && (
            <ActionIcon
              icon={Icons.Edit}
              size="small"
              variant="borderless"
              title="编辑"
              onClick={onEdit}
            />
          )}
          <ActionIcon
            icon={Icons.Refresh}
            size="small"
            variant="borderless"
            onClick={onHealthCheck}
            title="健康检查"
            aria-label="健康检查"
          />
          {!isBuiltin && (
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
        </div>
      )}
    </div>
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
    defaultModel: '',
    modelIds: [],
    endpoint: '',
    codexApiKind: 'chat',
    supportsMillionContext: false,
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
  const [mediaCatalog, setMediaCatalog] = useState<CanvasMediaModelSummary[]>([])
  const [mediaCatalogLoading, setMediaCatalogLoading] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const [fetchedModels, setFetchedModels] = useState<ProviderFetchedModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const lastAutoDefaultModelRef = useRef<string | null>(null)

  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
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

  // 编辑模式：加载现有 profile；新建模式：支持 initialPresetId 预填
  // 仅在 Drawer 打开时执行，避免关闭后 form 被错误重置
  useEffect(() => {
    if (!visible) return
    lastAutoDefaultModelRef.current = null
    if (!profileId) {
      // 从预设模板打开：自动填充 preset 数据
      if (initialPresetId) {
        const preset = getProviderPresetById(initialPresetId)
        if (preset) {
          const id = window.setTimeout(() => {
            setForm({
              presetId: preset.id,
              name: preset.name,
              provider: preset.provider,
              defaultModel: preset.defaultModel,
              modelIds: uniqPreserveOrder([...preset.modelIds]),
              endpoint: preset.apiEndpoint,
              codexApiKind: 'chat',
              supportsMillionContext: false,
              apiKey: '',
              isDefault: false,
              ...EMPTY_TIER_MODELS,
              modelType: preset.modelType ?? 'multimodal',
              imageProvider: normalizeImageProvider(preset.imageProvider),
              imageApiType: normalizeImageApiType(preset.mediaApiType ?? preset.imageApiType),
              ...presetMediaForm(preset),
            })
          }, 0)
          return () => window.clearTimeout(id)
        }
      }
      const id = window.setTimeout(() => {
        setForm({
          presetId: 'custom',
          name: '',
          provider: 'anthropic',
          defaultModel: '',
          modelIds: [],
          endpoint: '',
          codexApiKind: 'chat',
          supportsMillionContext: false,
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
    listProviders({})
      .then((r) => {
        const p = r.profiles.find((x) => x.id === profileId)
        if (p) {
          setForm({
            presetId: 'custom',
            name: p.name,
            provider: normalizeProviderKind(p.provider),
            defaultModel: p.defaultModel,
            modelIds: uniqPreserveOrder(p.modelIds),
            endpoint: p.apiEndpoint ?? '',
            codexApiKind: p.codexApiKind ?? 'chat',
            supportsMillionContext: p.supportsMillionContext === true,
            apiKey: '',
            isDefault: p.isDefault,
            haikuModel: p.haikuModel ?? '',
            sonnetModel: p.sonnetModel ?? '',
            opusModel: p.opusModel ?? '',
            modelType: (p.modelType as ProviderModelType) ?? 'multimodal',
            imageProvider: normalizeImageProvider(p.imageProvider),
            imageApiType: normalizeImageApiType(p.mediaApiType ?? p.imageApiType),
            ...profileMediaForm(p),
          })
        }
      })
      .catch(console.error)
  }, [listProviders, profileId, initialPresetId, visible])

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
    if (isMediaProviderModelType(form.modelType)) {
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
  }, [form.modelType, form.mediaProvider, form.imageProvider, form.presetId, form.name, form.provider])
  const availablePresets = useMemo(
    () =>
      PROVIDER_PRESETS.filter((preset) => {
        // 选了图片/语音/视频/多模态能力类型时，只展示同类型的多媒体预设；
        // 文本/多模态保留通用 LLM 预设（非 image/voice/video）。
        const isMediaSelected = isMediaProviderModelType(form.modelType)
        if (isMediaSelected) {
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

  // 自定义模型引用（manifestId 以 custom: 开头）——不依赖内置目录，
  // 渲染在清单下方，可手动添加 / 移除。原生 adapter（xAI/APIMart）按 defaultModel 调用，
  // 因此即便没有目录 manifest，自定义模型仍可用于实际请求。
  const customModelRefs = useMemo(
    () => form.mediaModelRefs.filter(isCustomModelRef),
    [form.mediaModelRefs],
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
        existing.set(manifestId, { manifestId, modelId, enabled: true })
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
          isDefault: form.isDefault,
          apiEndpoint: endpoint.length > 0 ? endpoint : null,
          supportsMillionContext: form.supportsMillionContext,
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
        if (form.apiKey.trim()) req.apiKey = form.apiKey
        await updateProvider(req)
      } else {
        await createProvider({
          name: form.name.trim(),
          provider: form.provider,
          defaultModel: effectiveDefaultModel,
          modelIds,
          apiKey: form.apiKey,
          isDefault: form.isDefault,
          ...(endpoint.length > 0 && { apiEndpoint: endpoint }),
          ...(form.provider === 'openai' && { codexApiKind: form.codexApiKind }),
          supportsMillionContext: form.supportsMillionContext,
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

  const currentProviderPayload = () => ({
    ...(profileId ? { id: profileId } : {}),
    provider: form.provider,
    apiEndpoint: form.endpoint.trim().length > 0 ? form.endpoint.trim() : null,
    defaultModel: form.defaultModel.trim(),
    ...(form.provider === 'openai' ? { codexApiKind: form.codexApiKind } : {}),
    ...(form.apiKey.trim().length > 0 ? { apiKey: form.apiKey.trim() } : {}),
  })

  const handleTestConnection = async () => {
    if (!form.defaultModel.trim()) {
      setError('请先填写默认模型 ID')
      return
    }
    if (!profileId && !form.apiKey.trim()) {
      setError('测试连接需要先填写 API Key')
      return
    }
    setTestingConnection(true)
    setError('')
    try {
      const result = await testConnection(currentProviderPayload())
      if (result.healthy) {
        toast.success(`连接成功${result.latencyMs != null ? ` · ${result.latencyMs}ms` : ''}`)
      } else {
        const message = result.errorMessage ?? '连接失败'
        setError(message)
        toast.error(message)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '连接测试失败'
      setError(message)
      toast.error(message)
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
      const result = await fetchProviderModels({
        ...(profileId ? { id: profileId } : {}),
        provider: form.provider,
        apiEndpoint: form.endpoint.trim().length > 0 ? form.endpoint.trim() : null,
        ...(form.apiKey.trim().length > 0 ? { apiKey: form.apiKey.trim() } : {}),
      })
      setFetchedModels(result.models)
      const ids = result.models
        .map((model) => model.id.trim())
        .filter((id): id is string => id.length > 0)
      if (ids.length === 0) {
        toast.info('供应商返回的模型列表为空')
        return
      }
      const firstModelId = ids[0]
      if (firstModelId == null) return
      setForm((prev) => {
        const nextDefault = prev.defaultModel.trim() || firstModelId
        return {
          ...prev,
          defaultModel: nextDefault,
          modelIds: uniqPreserveOrder([nextDefault, ...ids, ...prev.modelIds]),
        }
      })
      toast.success(`已获取 ${ids.length} 个模型`)
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
  const applyPreset = (preset: ProviderPreset) => {
    lastAutoDefaultModelRef.current = null
    setForm((prev) => ({
      ...prev,
      presetId: preset.id,
      name: preset.name,
      provider: preset.provider,
      defaultModel: preset.defaultModel,
      modelIds: uniqPreserveOrder(preset.modelIds),
      endpoint: preset.apiEndpoint,
      codexApiKind: 'chat',
      supportsMillionContext: false,
      ...EMPTY_TIER_MODELS,
      modelType: preset.modelType ?? 'multimodal',
      imageProvider: normalizeImageProvider(preset.imageProvider),
      imageApiType: normalizeImageApiType(preset.mediaApiType ?? preset.imageApiType),
      ...presetMediaForm(preset),
    }))
  }

  return (
    <Drawer
      open={visible}
      onClose={onClose}
      maskClosable={!saving}
      width={960}
      title={profileId ? '编辑 Provider' : '添加 Provider'}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="default" onClick={onClose} disabled={saving}>
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
        <Alert
          type="info"
          message={
            [
              isMediaProviderModelType(form.modelType)
                ? `${form.modelType === 'image' ? '生图模型' : form.modelType === 'voice' ? '语音模型' : '视频模型'} · ${mediaProviderDisplayName(form.mediaProvider || mediaProviderFromImageKind(form.imageProvider))}/${form.mediaApiType}`
                : form.provider === 'anthropic'
                  ? 'Anthropic 格式'
                  : 'OpenAI 格式',
              'API Key 鉴权',
              form.presetId !== 'custom' ? `预设模板 · ${currentVendor?.name ?? form.presetId}` : null,
            ].filter(Boolean).join(' · ')
          }
        />

        {error && (
          <Alert
            type="error"
            icon={<Icons.AlertTriangle />}
            message={error}
            closable
            onClose={() => setError('')}
          />
        )}

        {/* ─── 基础信息 ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <Icons.Database size={11} />
            </span>
            <span className="pv_section_title">基本信息</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">模型类型</label>
              <Select
                value={form.modelType}
                onChange={(v) => {
                  const modelType = v as ProviderModelType
                  const isMedia = isMediaProviderModelType(modelType)
                  setForm((prev) => ({
                    ...prev,
                    modelType,
                    presetId: 'custom',
                    provider: isMedia ? 'openai' : prev.provider,
                    codexApiKind: isMedia ? 'chat' : prev.codexApiKind,
                    imageProvider: modelType === 'image' ? prev.imageProvider : 'openai',
                    imageApiType: modelType === 'image' ? prev.imageApiType : 'sync',
                    mediaProvider: isMedia ? (prev.mediaProvider || mediaProviderFromImageKind(prev.imageProvider)) : '',
                    mediaApiType: isMedia ? prev.mediaApiType : 'auto',
                  }))
                }}
                options={[
                  { label: '生图模型', value: 'image' },
                  { label: '文本（含编码）模型', value: 'text' },
                  { label: '多模态（含编码、生图）模型', value: 'multimodal' },
                  { label: '语音模型', value: 'voice' },
                  { label: '视频模型', value: 'video' },
                ]}
              />

              {!isMediaProviderModelType(form.modelType) && (
                <>
                  <label className="pv_form_label">
                    API 协议格式
                    <span className="pv_form_sub">决定 Provider 请求格式；OpenAI 格式可用于 Codex / Responses API</span>
                  </label>
                  <Select
                    value={form.provider}
                    onChange={(v) =>
                      setForm((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        provider: normalizeProviderKind(v),
                        codexApiKind: 'chat',
                      }))
                    }
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
                    <ProviderLogo
                      vendor={currentVendor}
                      size={36}
                      shape="rounded"
                      className="pv_form_select_preview"
                    />
                  </div>
                </>
              )}

              <label className="pv_form_label">显示名称</label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="例：Anthropic · Claude"
              />

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
              {(form.modelType === 'image' || form.modelType === 'voice' || form.modelType === 'video') && (
                <>
                  <label className="pv_form_label">
                    平台适配器
                    <span className="pv_form_sub">决定图片 / 语音 / 视频请求的端点与异步轮询策略</span>
                  </label>
                  <Select
                    value={form.mediaProvider || mediaProviderFromImageKind(form.imageProvider)}
                    onChange={(v) => set('mediaProvider', v as MediaProviderKind)}
                    options={MEDIA_PROVIDER_KINDS.map((kind) => ({
                      label: MEDIA_PROVIDER_LABELS[kind],
                      value: kind,
                    }))}
                  />

                  <label className="pv_form_label">
                    调用方式
                    <span className="pv_form_sub">sync 同步 / async 任务轮询 / auto 自动兼容</span>
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
                    <span className="pv_form_sub">勾选后会写入 mediaModelRefs，agent 与无限画布可立即发现参数 schema</span>
                  </label>
                  <div className="pv_media_model_refs">
                    <div className="pv_media_manifest_list">
                      {mediaCatalogLoading ? (
                        <div className="pv_media_manifest_empty">正在加载模型清单…</div>
                      ) : mediaCatalogForForm.length === 0 ? (
                        <div className="pv_media_manifest_empty">暂无匹配的内置模型清单</div>
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
                                <Tag size="small" color="gray">{model.providerKind}</Tag>
                                <Tag size="small" color="blue">{model.invocationMode}</Tag>
                              </div>
                              <div className="pv_media_manifest_meta">
                                {model.effectiveModelId}
                              </div>
                              <div className="pv_media_manifest_caps">
                                {model.capabilities.slice(0, 4).map((capability) => (
                                  <Tag key={capability.id} size="small" color="gray">
                                    {capability.label}
                                  </Tag>
                                ))}
                              </div>
                            </div>
                            {/* 已勾选的模型才可设为默认；按钮需阻止冒泡，避免误触 checkbox */}
                            {selectedManifestIds.has(model.manifestId) && (
                              <div className="pv_media_manifest_actions">
                                {form.defaultModel.trim() === model.effectiveModelId.trim() ? (
                                  <Tag size="small" color="green">默认</Tag>
                                ) : (
                                  <Button
                                    size="small"
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
                                <Tag size="small" color="purple">自定义</Tag>
                                <Tag size="small" color="gray">{form.mediaProvider || form.imageProvider}</Tag>
                              </div>
                              <div className="pv_media_manifest_meta">
                                {form.defaultModel.trim() === ref.modelId?.trim()
                                  ? `${ref.modelId} · 当前默认`
                                  : ref.modelId}
                              </div>
                            </div>
                            <div className="pv_media_manifest_actions">
                              {form.defaultModel.trim() === ref.modelId?.trim() ? (
                                <Tag size="small" color="green">默认</Tag>
                              ) : (
                                <Button
                                  size="small"
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
                                size="small"
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
                    <span className="pv_form_sub">内置清单之外？直接输入模型 ID 添加（原生 adapter 按默认模型 ID 调用）</span>
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
                          : form.modelType === 'video' ? '如 veo2、kling-v2、hailuo-02…'
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

                  <label className="pv_form_label">
                    支持能力
                    <span className="pv_form_sub">勾选该 provider 声明支持的多媒体能力</span>
                  </label>
                  <div className="pv_media_capabilities">
                    {MEDIA_CAPABILITY_IDS.map((capability) => (
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

                  <label className="pv_form_label">
                    参数默认值
                    <span className="pv_form_sub">留空则使用平台默认；视频/异步任务建议设置轮询间隔与超时</span>
                  </label>
                  <div className="pv_media_defaults">
                    {mediaDefaultOptionSets.imageSize.length > 0 ? (
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
                    )}
                    <Input
                      value={form.mediaImageN}
                      onChange={(e) => set('mediaImageN', e.target.value)}
                      placeholder="图片数量 n"
                    />
                    {mediaDefaultOptionSets.imageQuality.length > 0 ? (
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
                    )}
                    <Input
                      value={form.mediaAudioVoice}
                      onChange={(e) => set('mediaAudioVoice', e.target.value)}
                      placeholder="语音 voice (alloy / nova)"
                    />
                    {mediaDefaultOptionSets.audioFormat.length > 0 ? (
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
                    )}
                    {mediaDefaultOptionSets.videoAspectRatio.length > 0 ? (
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
                    )}
                    {mediaDefaultOptionSets.videoDuration.length > 0 ? (
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
                    )}
                    {mediaDefaultOptionSets.videoQuality.length > 0 ? (
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
                    )}
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
                  </div>
                </>
              )}

              {form.provider === 'openai' && !isMediaProviderModelType(form.modelType) && (
                <>
                  <label className="pv_form_label">
                    Codex API 类型
                    <span className="pv_form_sub">控制 Codex/OpenAI 执行使用 Chat Completions 还是 Responses API</span>
                  </label>
                  <Select
                    value={form.codexApiKind}
                    onChange={(v) =>
                      set('codexApiKind', v === 'responses' ? 'responses' : 'chat')
                    }
                    options={[
                      { label: 'Chat Completions', value: 'chat' },
                      { label: 'Responses API', value: 'responses' },
                    ]}
                  />
                </>
              )}

              <label className="pv_form_label">
                默认模型 ID
                <span className="pv_form_sub">{isMediaProviderModelType(form.modelType) ? '作为 adapter 默认调用模型；保存时自动跟随首个已启用模型，填写清单内某个模型可指定它为默认' : '作为主对话默认；同时自动加入下方可用模型列表（带星标）'}</span>
              </label>
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

              <label className="pv_form_label">Endpoint URL</label>
              <Input
                value={form.endpoint}
                onChange={(e) => set('endpoint', e.target.value)}
                placeholder={
                  isMediaProviderModelType(form.modelType)
                    ? 'https://api.example.com'
                    : form.modelType === 'image'
                    ? imageProviderDefaults(form.imageProvider).endpoint || 'https://api.example.com/v1'
                    : form.provider === 'anthropic'
                    ? 'https://api.anthropic.com'
                    : 'https://api.openai.com/v1'
                }
              />

              {!isMediaProviderModelType(form.modelType) && (
                <>
                  <label className="pv_form_label">
                    连接与模型
                    <span className="pv_form_sub">使用当前 Endpoint/API Key 进行检测；已保存 Provider 可复用原 Key</span>
                  </label>
                  <div className="pv_form_control_inline">
                    <Button
                      size="small"
                      type="default"
                      icon={<Icons.Wifi size={12} />}
                      loading={testingConnection}
                      disabled={saving || fetchingModels}
                      onClick={() => void handleTestConnection()}
                    >
                      测试连接
                    </Button>
                    <Button
                      size="small"
                      type="default"
                      icon={<Icons.Download size={12} />}
                      loading={fetchingModels}
                      disabled={saving || testingConnection}
                      onClick={() => void handleFetchModels()}
                    >
                      获取模型
                    </Button>
                    {fetchedModels.length > 0 && (
                      <span className="pv_form_hint">
                        已获取 {fetchedModels.length} 个
                      </span>
                    )}
                  </div>
                </>
              )}

              {!isMediaProviderModelType(form.modelType) && (
                <>
                  <label className="pv_form_label">
                    支持 1M 上下文
                    <span className="pv_form_sub">开启后该 Provider 默认按 1M token 计算；关闭时默认 200K</span>
                  </label>
                  <div className="pv_form_control_inline">
                    <Switch
                      size="small"
                      checked={form.supportsMillionContext}
                      onChange={(checked: boolean) => set('supportsMillionContext', checked)}
                    />
                    <span className="pv_form_hint">
                      {form.supportsMillionContext ? '已开启' : '关闭'}
                    </span>
                  </div>
                </>
              )}

              <label className="pv_form_label">{isMediaProviderModelType(form.modelType) ? '默认调用模型' : '默认 Provider'}</label>
              <div className="pv_form_control_inline">
                <Switch
                  size="small"
                  checked={form.isDefault}
                  onChange={(checked: boolean) => set('isDefault', checked)}
                />
                <span className="pv_form_hint">
                  {form.isDefault
                    ? (isMediaProviderModelType(form.modelType) ? '默认多媒体' : '系统默认')
                    : (isMediaProviderModelType(form.modelType) ? '备选多媒体' : '备选 Provider')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── 鉴权（API Key） ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <Icons.Lock size={11} />
            </span>
            <span className="pv_section_title">鉴权</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">
                API Key
                {profileId && <span className="pv_form_sub">留空则不更新当前 key</span>}
              </label>
              <InputPassword
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder={profileId ? '••••••••（留空不更新）' : 'sk-ant-...'}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {!isMediaProviderModelType(form.modelType) && (
          <>
            {/* ─── 可用模型 ─── */}
            <div className="pv_section">
              <div className="pv_section_head">
                <span className="pv_section_icon">
                  <Icons.Archive size={11} />
                </span>
                <span className="pv_section_title">可用模型</span>
                <span className="pv_section_hint">
                  {fetchedModels.length > 0
                    ? `远端返回 ${fetchedModels.length} 个模型；点击 chip 可切换默认`
                    : '点击 chip 即可切换为默认模型（带星标）'}
                </span>
              </div>
              <div className="pv_section_body">
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

            {/* ─── 档位映射 ─── */}
            <div className="pv_section">
              <div className="pv_section_head">
                <span className="pv_section_icon">
                  <Icons.Settings size={11} />
                </span>
                <span className="pv_section_title">档位映射</span>
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
          </>
        )}
      </div>
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
