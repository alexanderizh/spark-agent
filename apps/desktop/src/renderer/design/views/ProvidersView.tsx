/**
 * ProvidersView — 模型供应商与协议配置（独立视图）
 *
 * 原嵌在 SettingsView 的 ProvidersSection 已抽到此处，作为一级菜单入口。
 * 包含：
 *   - ProvidersView（默认导出）：列表 + 预设模板目录
 *   - ProviderEditPanel（命名导出）：滑入式编辑面板（基于 Arco Drawer）
 *
 * 本次重设计（2026-06 arco-refresh）：
 *   - 全部使用 Arco Design 组件（Button / Tag / Badge / Checkbox / Drawer / Switch / Alert / Modal）
 *   - 图标全部换成 @arco-design/web-react/icon
 *   - 样式落在组件级 ProvidersView.less（pv_ 前缀），不再依赖 views.css 的 .provider-card / .preset-card /
 *     .slide-panel 等旧全局类，避免与其他 view 相互污染。
 *   - 布局优先使用 Tailwind 原子类，复杂状态/动画用 LESS。
 *
 * 导入/导出（2026-06 import-export）行为保持：
 *   - 顶部"导入/导出"按钮组：写文件 + 复制到剪贴板
 *   - 多选模式：勾选卡片 → 批量导出 / 删除
 *   - 导入预览 Modal：显示 conflict、模式 merge/replace
 *   - API Key 随导入导出一并处理
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Button, Tag, Badge, Checkbox, Drawer, Switch, Alert,
} from '@arco-design/web-react'
import {
  IconPlus, IconRefresh, IconUpload, IconDownload, IconCopy,
  IconCheckSquare, IconClose, IconEdit, IconStarFill,
  IconStorage, IconLock, IconArchive, IconSettings, IconExclamationCircle,
} from '@arco-design/web-react/icon'
import { SparkInput, SparkSelect } from '../components/FormControls'
import { ChipList } from '../components/ChipList'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
import { ProviderLogo } from '../components/ProviderLogo'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useToast } from '../components/Toast'
import {
  PROVIDER_PRESETS,
  getProviderPresetById,
  getVendorMeta,
  getPresetsByVendor,
  getUniqueVendorIds,
  isLocalCliProvider,
  LOCAL_CLI_PROVIDER_ID,
} from '@spark/protocol'
import type {
  ProviderPreset,
  VendorMeta,
  ProviderHealthCheckResponse,
  ProviderProfile,
  ProviderUpdateRequest,
  ProviderExportPayload,
  ProviderImportMode,
  ImageGenApiType,
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
      if (id === LOCAL_CLI_PROVIDER_ID) continue
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

  const handleExportAll = useCallback(() => {
    handleExportToFile([])
  }, [handleExportToFile])

  const handleExportSelected = useCallback(() => {
    handleExportToFile(Array.from(selectedIds))
  }, [handleExportToFile, selectedIds])

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

  /** 已配置的 vendor 名称集合（用于标记已添加） */
  const configuredNames = useMemo(() => new Set(profiles.map((p) => p.name)), [profiles])

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
              type={showPresetCatalog ? 'primary' : 'outline'}
              icon={<IconPlus />}
              onClick={() => setShowPresetCatalog((prev) => !prev)}
            >
              从模板添加
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<IconPlus />}
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
              icon={<IconRefresh />}
              onClick={refresh}
              title="刷新 (Ctrl+R)"
              aria-label="刷新"
            />
            <Button
              ref={importButtonRef as any}
              size="small"
              icon={<IconUpload />}
              onClick={() => void handleImportFromFile()}
              disabled={importing}
              title="从 .json 导入 Provider 配置"
            >
              导入
            </Button>
            <Button
              size="small"
              icon={<IconCopy />}
              onClick={() => void handleImportFromClipboard()}
              disabled={importing}
              title="从剪贴板 JSON 字符串导入"
            >
              从剪贴板
            </Button>
            <Button
              size="small"
              type="outline"
              icon={<IconDownload />}
              onClick={handleExportAll}
              disabled={profiles.length === 0}
              title="导出全部 Provider 到 .json"
            >
              导出
            </Button>
            <Button
              size="small"
              icon={<IconCopy />}
              onClick={() => void handleCopyToClipboard([])}
              disabled={profiles.length === 0}
              title="复制全部 Provider JSON 到剪贴板"
            >
              复制
            </Button>
            {!multiSelect && (
              <Button
                size="small"
                type="outline"
                icon={<IconCheckSquare />}
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

        {/* ─── 预设模板目录 ─── */}
        {showPresetCatalog && (
          <div className="pv_catalog">
            <div className="pv_catalog_hint">
              选择供应商模板快速配置，选择后仍可自定义所有字段。
            </div>
            <div className="pv_catalog_grid">
              {getUniqueVendorIds().map((vendorId) => {
                const meta = getVendorMeta(vendorId)
                if (!meta) return null
                const isAdded = configuredNames.has(meta.name)
                return (
                  <VendorPresetCard
                    key={vendorId}
                    vendor={meta}
                    isAdded={isAdded}
                    onSelectVendor={handleSelectVendor}
                  />
                )
              })}
            </div>
          </div>
        )}

        {profiles.length === 0 && !showPresetCatalog ? (
          <div className="pv_empty">
            尚未配置 Provider — 点击「从模板添加」快速开始，或「自定义添加」手动配置
          </div>
        ) : (
          profiles.map((p) => {
            const h = healthMap[p.id]
            const status = h == null ? 'unknown' : h.healthy ? 'ok' : 'error'
            const vendor = guessVendorByName(p.name, getUniqueVendorIds())
            const builtin = isLocalCliProvider(p)
            return (
              <ProviderCardX
                key={p.id}
                vendor={vendor}
                name={p.name}
                desc={
                  builtin
                    ? '内置 · 沿用宿主机本地 Claude CLI 配置（无需 API Key）'
                    : `${p.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'} · 默认 ${p.defaultModel}`
                }
                status={status}
                modelIds={builtin ? [] : p.modelIds}
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

/* ─── VENDOR PRESET CARD（模板目录卡片） ─── */
function VendorPresetCard({
  vendor,
  isAdded,
  onSelectVendor,
}: {
  vendor: VendorMeta
  isAdded: boolean
  onSelectVendor: (vendorId: string) => void
}) {
  return (
    <div
      className={`pv_vendor_card${isAdded ? ' pv_vendor_added' : ''}`}
      onClick={() => !isAdded && onSelectVendor(vendor.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isAdded) {
          e.preventDefault()
          onSelectVendor(vendor.id)
        }
      }}
    >
      <ProviderLogo vendor={vendor} size={36} shape="rounded" />
      <div className="pv_vendor_info">
        <div className="pv_vendor_name">
          {vendor.name}
          {isAdded && <Tag size="small" color="gray">已添加</Tag>}
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
            <Tag size="small" color="arcoblue" icon={<IconStarFill />}>
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
                {m === defaultModel && <IconStarFill style={{ fontSize: 9 }} />}
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
            <Button
              size="mini"
              type="text"
              icon={<IconEdit />}
              onClick={onEdit}
            >
              编辑
            </Button>
          )}
          <Button
            size="mini"
            shape="circle"
            type="text"
            icon={<IconRefresh />}
            onClick={onHealthCheck}
            title="健康检查"
            aria-label="健康检查"
          />
          {!isBuiltin && (
            <Button
              size="mini"
              shape="circle"
              type="text"
              status="danger"
              icon={<IconClose />}
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
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { invoke: listProviders } = useIpcInvoke('provider:list')

  // 编辑模式：加载现有 profile；新建模式：支持 initialPresetId 预填
  // 仅在 Drawer 打开时执行，避免关闭后 form 被错误重置
  useEffect(() => {
    if (!visible) return
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
              imageApiType: normalizeImageApiType(preset.imageApiType),
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
            imageApiType: normalizeImageApiType(p.imageApiType),
          })
        }
      })
      .catch(console.error)
  }, [listProviders, profileId, initialPresetId, visible])

  // ── 衍生：当前选中 preset 对应的 vendor（用于 hero 渲染真实 logo） ──
  const currentVendor: VendorMeta | null = useMemo(() => {
    if (form.presetId !== 'custom') {
      const preset = getProviderPresetById(form.presetId)
      if (preset) {
        const meta = getVendorMeta(preset.vendorId)
        if (meta) return meta
      }
    }
    // 自定义模式：尝试按 name 反推 vendor
    return guessVendorByName(form.name, getUniqueVendorIds())
  }, [form.presetId, form.name])

  const handleSave = async () => {
    if (!form.name.trim() || !form.defaultModel.trim()) {
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
      const modelIds = uniqPreserveOrder([form.defaultModel, ...form.modelIds])
      const haiku = form.haikuModel.trim()
      const sonnet = form.sonnetModel.trim()
      const opus = form.opusModel.trim()
      if (profileId) {
        const req: ProviderUpdateRequest = {
          id: profileId,
          name: form.name.trim(),
          defaultModel: form.defaultModel.trim(),
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
          imageApiType: form.modelType === 'image' ? form.imageApiType : null,
        }
        if (form.provider === 'openai') req.codexApiKind = form.codexApiKind
        if (form.apiKey.trim()) req.apiKey = form.apiKey
        await updateProvider(req)
      } else {
        await createProvider({
          name: form.name.trim(),
          provider: form.provider,
          defaultModel: form.defaultModel.trim(),
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
          imageApiType: form.modelType === 'image' ? form.imageApiType : null,
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

  const set = <K extends keyof ProviderForm>(k: K, v: ProviderForm[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))
  const applyPreset = (preset: ProviderPreset) => {
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
      imageApiType: normalizeImageApiType(preset.imageApiType),
    }))
  }

  return (
    <Drawer
      visible={visible}
      onCancel={onClose}
      onOk={() => void handleSave()}
      maskClosable={!saving}
      width={960}
      title={profileId ? '编辑 Provider' : '添加 Provider'}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      bodyStyle={{ padding: 0 }}
    >
      <div className="pv_drawer_body">
        <Alert
          type="info"
          content={
            [
              form.modelType === 'image'
                ? `生图模型 · ${form.imageProvider}/${form.imageApiType}`
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
            icon={<IconExclamationCircle />}
            content={error}
            closable
            onClose={() => setError('')}
          />
        )}

        {/* ─── 基础信息 ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <IconStorage style={{ fontSize: 11 }} />
            </span>
            <span className="pv_section_title">基本信息</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">模型类型</label>
              <SparkSelect
                value={form.modelType}
                onChange={(e) => {
                  const modelType = e.target.value as ProviderModelType
                  setForm((prev) => ({
                    ...prev,
                    modelType,
                    presetId: 'custom',
                    provider: modelType === 'image' ? 'openai' : prev.provider,
                    codexApiKind: modelType === 'image' ? 'chat' : prev.codexApiKind,
                    imageProvider: modelType === 'image' ? prev.imageProvider : 'openai',
                    imageApiType: modelType === 'image' ? prev.imageApiType : 'sync',
                  }))
                }}
              >
                <option value="image">生图模型</option>
                <option value="text">文本（含编码）模型</option>
                <option value="multimodal">多模态（含编码、生图）模型</option>
                <option value="voice">语音模型</option>
                <option value="video">视频模型</option>
              </SparkSelect>

              <label className="pv_form_label">
                供应商模板
                <span className="pv_form_sub">基于官方公开文档预填，后续仍可修改</span>
              </label>
              <div className="pv_form_select_row">
                <SparkSelect
                  width={220}
                  value={form.presetId}
                  disabled={!!profileId}
                  onChange={(e) => {
                    const presetId = e.target.value
                    if (presetId === 'custom') {
                      set('presetId', 'custom')
                      return
                    }
                    const preset = getProviderPresetById(presetId)
                    if (preset) applyPreset(preset)
                  }}
                >
                  <option value="custom">自定义</option>
                  {PROVIDER_PRESETS.filter((preset) =>
                    form.modelType === 'image' ? preset.modelType === 'image' : preset.modelType !== 'image'
                  ).map((preset) => {
                    const meta = getVendorMeta(preset.vendorId)
                    const baseName = preset.name || meta?.name || preset.vendorId
                    return (
                      <option key={preset.id} value={preset.id}>
                        {baseName}
                      </option>
                    )
                  })}
                </SparkSelect>
                <ProviderLogo
                  vendor={currentVendor}
                  size={36}
                  shape="rounded"
                  className="pv_form_select_preview"
                />
              </div>

              <label className="pv_form_label">显示名称</label>
              <SparkInput
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="例：Anthropic · Claude"
              />

              {form.modelType !== 'image' && (
                <>
                  <label className="pv_form_label">
                    API 协议格式
                    <span className="pv_form_sub">决定 Provider 请求格式；Claude 执行统一使用 Claude Agent SDK</span>
                  </label>
                  <SparkSelect
                    value={form.provider}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        provider: normalizeProviderKind(e.target.value),
                        codexApiKind: 'chat',
                      }))
                    }
                    disabled={true}
                  >
                    <option value="anthropic">Anthropic 格式</option>
                    <option value="openai">OpenAI 格式</option>
                  </SparkSelect>
                </>
              )}

              {form.modelType === 'image' && (
                <>
                  <label className="pv_form_label">
                    生图接口来源
                    <span className="pv_form_sub">决定图片请求 body、路径、尺寸参数和轮询策略</span>
                  </label>
                  <SparkSelect
                    value={form.imageProvider}
                    onChange={(e) => {
                      const imageProvider = normalizeImageProvider(e.target.value)
                      const defaults = imageProviderDefaults(imageProvider)
                      setForm((prev) => ({
                        ...prev,
                        provider: 'openai',
                        imageProvider,
                        imageApiType: defaults.mode,
                        endpoint: defaults.endpoint || prev.endpoint,
                        codexApiKind: 'chat',
                      }))
                    }}
                  >
                    {IMAGE_PROVIDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SparkSelect>

                  <label className="pv_form_label">
                    生图调用方式
                    <span className="pv_form_sub">同步直接返回图片；异步会提交任务并轮询；auto 可兼容混合响应</span>
                  </label>
                  <SparkSelect
                    value={form.imageApiType}
                    onChange={(e) => set('imageApiType', normalizeImageApiType(e.target.value))}
                  >
                    <option value="sync">sync · 同步返回</option>
                    <option value="async">async · 任务轮询</option>
                    <option value="auto">auto · 自动兼容</option>
                  </SparkSelect>
                </>
              )}

              {form.provider === 'openai' && form.modelType !== 'image' && (
                <>
                  <label className="pv_form_label">
                    Codex API 类型
                    <span className="pv_form_sub">控制 Codex/OpenAI 执行使用 Chat Completions 还是 Responses API</span>
                  </label>
                  <SparkSelect
                    value={form.codexApiKind}
                    onChange={(e) =>
                      set('codexApiKind', e.target.value === 'responses' ? 'responses' : 'chat')
                    }
                  >
                    <option value="chat">Chat Completions</option>
                    <option value="responses">Responses API</option>
                  </SparkSelect>
                </>
              )}

              <label className="pv_form_label">
                默认模型 ID
                <span className="pv_form_sub">作为主对话默认；同时自动加入下方可用模型列表（带星标）</span>
              </label>
              <SparkInput
                value={form.defaultModel}
                onChange={(e) => {
                  const next = e.target.value
                  setForm((prev) => {
                    // 把新的 defaultModel 加到 modelIds 最前（去重）
                    const ids = uniqPreserveOrder([next, ...prev.modelIds.filter((m) => m !== next)])
                    return { ...prev, defaultModel: next, modelIds: ids }
                  })
                }}
                placeholder="例：claude-sonnet-4-20250514"
              />

              <label className="pv_form_label">Endpoint URL</label>
              <SparkInput
                value={form.endpoint}
                onChange={(e) => set('endpoint', e.target.value)}
                placeholder={
                  form.modelType === 'image'
                    ? imageProviderDefaults(form.imageProvider).endpoint || 'https://api.example.com/v1'
                    : form.provider === 'anthropic'
                    ? 'https://api.anthropic.com'
                    : 'https://api.openai.com/v1'
                }
              />

              {form.modelType !== 'image' && (
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

              <label className="pv_form_label">{form.modelType === 'image' ? '默认生图模型' : '默认 Provider'}</label>
              <div className="pv_form_control_inline">
                <Switch
                  size="small"
                  checked={form.isDefault}
                  onChange={(checked: boolean) => set('isDefault', checked)}
                />
                <span className="pv_form_hint">
                  {form.isDefault
                    ? (form.modelType === 'image' ? '默认生图' : '系统默认')
                    : (form.modelType === 'image' ? '备选生图' : '备选 Provider')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── 鉴权（API Key） ─── */}
        <div className="pv_section">
          <div className="pv_section_head">
            <span className="pv_section_icon">
              <IconLock style={{ fontSize: 11 }} />
            </span>
            <span className="pv_section_title">鉴权</span>
          </div>
          <div className="pv_section_body">
            <div className="pv_form_grid">
              <label className="pv_form_label">
                API Key
                {profileId && <span className="pv_form_sub">留空则不更新当前 key</span>}
              </label>
              <SparkInput
                type="password"
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder={profileId ? '••••••••（留空不更新）' : 'sk-ant-...'}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {form.modelType !== 'image' && (
          <>
            {/* ─── 可用模型 ─── */}
            <div className="pv_section">
              <div className="pv_section_head">
                <span className="pv_section_icon">
                  <IconArchive style={{ fontSize: 11 }} />
                </span>
                <span className="pv_section_title">可用模型</span>
                <span className="pv_section_hint">点击 chip 即可切换为默认模型（带星标）</span>
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
                  <IconSettings style={{ fontSize: 11 }} />
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
                    <SparkInput
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
                    <SparkInput
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
                    <SparkInput
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
