/**
 * ProvidersView — 模型供应商与协议配置（独立视图）
 *
 * 原嵌在 SettingsView 的 ProvidersSection 已抽到此处，作为一级菜单入口。
 * 包含：
 *   - ProvidersView（默认导出）：列表 + 预设模板目录
 *   - ProviderEditPanel（命名导出）：滑入式编辑面板
 *
 * 本文件在 nav-and-shell 重构基础上做 UI/UX 升级：
 *   - 真实 logo 集成：ProviderCardX / VendorPresetCard / 编辑面板 hero 全部用真实 SVG，
 *     失败时回退到 emoji + vendor 颜色
 *   - 可用模型列表：textarea 改为 ChipList（input + add + 锁定默认模型）
 *   - 编辑面板：分节卡片布局（基本信息 / 模型 / 档位 / 鉴权），hero 区突出 logo + 协议
 *   - 输入控件密度统一：36px 高、12px 内边距、明显 border、强 focus 态
 *
 * 导入/导出（2026-06 import-export）：
 *   - 顶部"导入/导出"按钮组：写文件 + 复制到剪贴板
 *   - 多选模式：勾选卡片 → 批量导出 / 删除
 *   - 导入预览 Modal：显示 conflict、模式 merge/replace
 *   - API Key 随导入导出一并处理（方便迁移备份）
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Icons } from '../Icons'
import { SparkInput, SparkSelect } from '../components/FormControls'
import { ChipList } from '../components/ChipList'
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
      <div className="settings-section">
        <div className="row section-header-row">
          <div className="row row-gap-xs">
            <button
              className={`btn ${showPresetCatalog ? 'active' : ''}`}
              onClick={() => setShowPresetCatalog((prev) => !prev)}
            >
              <Icons.Layers size={12} /> 从模板添加
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setEditingId(null)
                setInitialPresetId(null)
                setTweak('showProviderEdit', true)
              }}
            >
              <Icons.Plus size={12} /> 自定义添加
            </button>
          </div>
          <span className="flex1" />
          {/* 导入导出区（import-export） */}
          <div className="row row-gap-xs">
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text-secondary)] transition-colors"
              onClick={refresh}
              title="刷新 (Ctrl+R)"
            >
              <Icons.Refresh size={12} />
            </button>
            <button
              ref={importButtonRef}
              className="btn"
              onClick={handleImportFromFile}
              disabled={importing}
              title="从 .json 导入 Provider 配置"
            >
              <Icons.Upload size={12} /> 导入
            </button>
            <button
              className="btn"
              onClick={handleImportFromClipboard}
              disabled={importing}
              title="从剪贴板 JSON 字符串导入"
            >
              <Icons.Copy size={12} /> 从剪贴板导入
            </button>
            <button
              className="btn"
              onClick={handleExportAll}
              disabled={profiles.length === 0}
              title="导出全部 Provider 到 .json"
            >
              <Icons.Download size={12} /> 导出
            </button>
            <button
              className="btn ghost"
              onClick={() => handleCopyToClipboard([])}
              disabled={profiles.length === 0}
              title="复制全部 Provider JSON 到剪贴板"
            >
              <Icons.Copy size={12} /> 复制
            </button>
            {!multiSelect ? (
              <button
                className="btn ghost"
                onClick={enterMultiSelect}
                disabled={profiles.length === 0}
                title="进入多选模式"
              >
                <Icons.CheckSquare size={12} /> 批量
              </button>
            ) : null}
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
            onDeleteSelected={handleDeleteSelected}
            deleting={importing}
          />
        )}

        {/* ─── 预设模板目录 ─── */}
        {showPresetCatalog && (
          <div className="preset-catalog">
            <div className="preset-catalog-hint">
              选择供应商模板快速配置，选择后仍可自定义所有字段。
            </div>
            <div className="preset-catalog-grid">
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
          <div className="empty-placeholder-lg">
            尚未配置 Provider — 点击"从模板添加"快速开始，或"自定义添加"手动配置
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
                detail={
                  builtin
                    ? '由本地 claude CLI 凭证驱动'
                    : h?.latencyMs != null
                      ? `延迟 ${h.latencyMs}ms`
                      : `${p.modelIds.length} 个模型${p.isDefault ? ' · 默认 Provider' : ''}`
                }
                modelIds={builtin ? [] : p.modelIds}
                defaultModel={p.defaultModel}
                isBuiltin={builtin}
                multiSelect={multiSelect && !builtin}
                selected={selectedIds.has(p.id)}
                onToggleSelect={() => toggleSelected(p.id)}
                onEdit={() => {
                  setEditingId(p.id)
                  setTweak('showProviderEdit', true)
                }}
                onDelete={() => handleDelete(p.id)}
                onHealthCheck={() => handleHealthCheck(p.id)}
              />
            )
          })
        )}
      </div>

      {/* Provider 编辑面板 */}
      {showProviderEdit && (
        <ProviderEditPanel
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
    <div className={`preset-card${isAdded ? ' preset-added' : ''}`}>
      <div className="preset-card-main" onClick={() => onSelectVendor(vendor.id)}>
        <ProviderLogo vendor={vendor} size={32} shape="rounded" />
        <div className="preset-card-info">
          <div className="preset-card-name">
            {vendor.name}
            {isAdded && <span className="preset-card-badge">已添加</span>}
          </div>
          <div className="preset-card-desc">{vendor.desc}</div>
        </div>
      </div>
    </div>
  )
}

function ProviderCardX({
  vendor,
  name,
  desc,
  status,
  detail,
  modelIds,
  defaultModel,
  isBuiltin = false,
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
  detail: string
  modelIds: string[]
  defaultModel: string
  /** 内置 provider：隐藏编辑/删除按钮，多选时不可勾选 */
  isBuiltin?: boolean
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

  return (
    <div
      className={`provider-card${multiSelect ? ' multi-select' : ''}${selected ? ' selected' : ''}`}
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
        <label
          className="provider-card-checkbox"
          onClick={(e) => e.stopPropagation()}
          title={selected ? '取消选择' : '选择'}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`选择 Provider ${name}`}
          />
        </label>
      )}
      <ProviderLogo vendor={fallbackVendor} size={44} shape="rounded" />
      <div className="provider-info">
        <div className="row row-gap-sm">
          <span className="name">{name}</span>
          {isBuiltin && <span className="badge dot">内置</span>}
          {status === 'ok' && <span className="badge success dot">在线</span>}
          {status === 'warning' && <span className="badge warning dot">需注意</span>}
          {status === 'error' && <span className="badge danger dot">错误</span>}
          {status === 'off' && <span className="badge dot">未启用</span>}
          {status === 'unknown' && <span className="badge dot">未验证</span>}
        </div>
        <div className="desc">{desc}</div>
        {modelIds.length > 0 && (
          <div className="models-row">
            {visibleModels.map((m) => (
              <span
                key={m}
                className="model-pill"
                title={m}
                style={m === defaultModel ? { background: 'var(--primary-soft)', color: 'var(--primary)' } : undefined}
              >
                {m === defaultModel && <Icons.Star size={9} style={{ marginRight: 3, verticalAlign: -1 }} />}
                {m}
              </span>
            ))}
            {moreCount > 0 && <span className="model-pill-more">+{moreCount}</span>}
          </div>
        )}
        {detail && <div className="muted detail-sm">{detail}</div>}
      </div>
      {!multiSelect && (
        <div className="row row-gap-xs self-start mt-sm" onClick={(e) => e.stopPropagation()}>
          {!isBuiltin && (
            <button className="btn ghost sm" onClick={onEdit}>
              <Icons.Edit size={11} /> 编辑
            </button>
          )}
          <button className="icon-btn" title="健康检查" onClick={onHealthCheck}>
            <Icons.Refresh size={13} />
          </button>
          {!isBuiltin && (
            <button className="icon-btn" title="删除" onClick={onDelete}>
              <Icons.X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ───────── PROVIDER EDIT slide panel ───────── */
export function ProviderEditPanel({
  profileId = null,
  initialPresetId = null,
  onClose,
}: {
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
  useEffect(() => {
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
  }, [listProviders, profileId, initialPresetId])

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
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div className="slide-panel" onClick={(e) => e.stopPropagation()}>
        {/* ─── HERO HEADER ─── */}
        <div className="slide-panel-h">
          <ProviderLogo vendor={currentVendor} size={40} shape="rounded" />
          <div className="flex1">
            <div className="h-title">{profileId ? '编辑 Provider' : '添加 Provider'}</div>
            <div className="h-sub">
              {form.modelType === 'image'
                ? `生图模型 · ${form.imageProvider}/${form.imageApiType}`
                : form.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'}
              <span className="dot" />
              API Key 鉴权
              {form.presetId !== 'custom' && (
                <>
                  <span className="dot" />
                  预设模板 · {currentVendor?.name ?? form.presetId}
                </>
              )}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <Icons.X />
          </button>
        </div>

        <div className="slide-panel-body">
          {error && (
            <div className="alert-banner" role="alert">
              <span className="alert-banner-icon">
                <Icons.AlertTriangle size={14} />
              </span>
              <span className="alert-banner-content">{error}</span>
            </div>
          )}

          {/* ─── 基础信息 ─── */}
          <div className="provider-form-section">
            <div className="provider-form-section-title">
              <span className="icon">
                <Icons.Server size={11} />
              </span>
              基本信息
            </div>
            <div className="form-grid">
              <label>模型类型</label>
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

              <label>
                供应商模板
                <span className="sub">基于官方公开文档预填，后续仍可修改</span>
              </label>
              <div className="provider-form-select-row">
                <SparkSelect
                  style={{width: 200}}
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
                    // 同一 vendor 可能对应多个 preset（如 openai-official / openai-images / apimart-images），
                    // 这里显示 preset 自己的 name 让用户能区分；带 image 类型的 preset 追加提示。
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
                  className="provider-form-select-preview"
                />
              </div>

              <label>显示名称</label>
              <SparkInput
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="例：Anthropic · Claude"
              />

              {form.modelType !== 'image' && (<>
              <label>
                API 协议格式
                <span className="sub">决定 Provider 请求格式；Claude 执行统一使用 Claude Agent SDK</span>
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
              </>)}

              {form.modelType === 'image' && (
                <>
                  <label>
                    生图接口来源
                    <span className="sub">决定图片请求 body、路径、尺寸参数和轮询策略</span>
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

                  <label>
                    生图调用方式
                    <span className="sub">同步直接返回图片；异步会提交任务并轮询；auto 可兼容混合响应</span>
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
                  <label>
                    Codex API 类型
                    <span className="sub">控制 Codex/OpenAI 执行使用 Chat Completions 还是 Responses API</span>
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

              <label>
                默认模型 ID
                <span className="sub">作为主对话默认；同时自动加入下方可用模型列表（带星标）</span>
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
                className="mono-sm"
              />

              <label>Endpoint URL</label>
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
                className="mono-sm"
              />

              {form.modelType !== 'image' && (<>
              <label>
                支持 1M 上下文
                <span className="sub">开启后该 Provider 默认按 1M token 计算；关闭时默认 200K</span>
              </label>
              <div className="control">
                <div
                  className={`switch ${form.supportsMillionContext ? 'on' : ''}`}
                  onClick={() => set('supportsMillionContext', !form.supportsMillionContext)}
                  role="switch"
                  aria-checked={form.supportsMillionContext}
                />
                <span className="muted" style={{ fontSize: 'var(--font-xs)' }}>
                  {form.supportsMillionContext ? '已开启' : '关闭'}
                </span>
              </div>
              </>)}

              <label>{form.modelType === 'image' ? '默认生图模型' : '默认 Provider'}</label>
              <div className="control">
                <div
                  className={`switch ${form.isDefault ? 'on' : ''}`}
                  onClick={() => set('isDefault', !form.isDefault)}
                  role="switch"
                  aria-checked={form.isDefault}
                />
                <span className="muted" style={{ fontSize: 'var(--font-xs)' }}>
                  {form.isDefault
                    ? (form.modelType === 'image' ? '默认生图' : '系统默认')
                    : (form.modelType === 'image' ? '备选生图' : '备选 Provider')}
                </span>
              </div>
            </div>
          </div>

          {/* ─── 鉴权（API Key）放在可用模型上方 ─── */}
          <div className="provider-form-section">
            <div className="provider-form-section-title">
              <span className="icon">
                <Icons.Lock size={11} />
              </span>
              鉴权
            </div>
            <div className="form-grid">
              <label>
                API Key
                {profileId && <span className="sub">留空则不更新当前 key</span>}
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

          {form.modelType !== 'image' && (<>
          {/* ─── 可用模型 ─── */}
          <div className="provider-form-section">
            <div className="provider-form-section-title">
              <span className="icon">
                <Icons.Box size={11} />
              </span>
              可用模型
              <span
                className="muted"
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--font-xs)',
                  fontWeight: 400,
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                点击 chip 即可切换为默认模型（带星标）
              </span>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
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
          <div className="provider-form-section">
            <div className="provider-form-section-title">
              <span className="icon">
                <Icons.Sliders size={11} />
              </span>
              档位映射
              <span
                className="muted"
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--font-xs)',
                  fontWeight: 400,
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                可选；留空则该档自动回落"默认模型 ID"
              </span>
            </div>
            <div className="tier-grid">
              <div className="tier-cell">
                <label>
                  Haiku 档
                  <span className="sub">SDK 派生子 agent / Task 工具默认走此档</span>
                </label>
                <SparkInput
                  value={form.haikuModel}
                  onChange={(e) => set('haikuModel', e.target.value)}
                  placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                  className="mono-sm"
                />
              </div>
              <div className="tier-cell">
                <label>
                  Sonnet 档
                  <span className="sub">主对话默认档；通常等同于默认模型</span>
                </label>
                <SparkInput
                  value={form.sonnetModel}
                  onChange={(e) => set('sonnetModel', e.target.value)}
                  placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                  className="mono-sm"
                />
              </div>
              <div className="tier-cell">
                <label>
                  Opus 档
                  <span className="sub">Plan / Review 等高能力 agent 使用</span>
                </label>
                <SparkInput
                  value={form.opusModel}
                  onChange={(e) => set('opusModel', e.target.value)}
                  placeholder={form.defaultModel ? `留空 → ${form.defaultModel}` : '留空 → 默认模型'}
                  className="mono-sm"
                />
              </div>
            </div>
          </div>
          </>)}
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icons.Check size={12} /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
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
