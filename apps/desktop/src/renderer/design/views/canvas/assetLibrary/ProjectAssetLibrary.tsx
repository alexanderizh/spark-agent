/**
 * 项目资产库主容器（步骤模式设计文档 §5.4，P2）。
 *
 * 取代 3306 行的 CanvasFilmAssetCenter 成为画布模式 / 步骤模式共用的资产库
 * 入口。数据统一经 P1 的 AssetRepository（useAssetLibrary 分页），操作经
 * FilmCenterHandlers 回调注入 —— 与 CanvasWorkspaceView 既有接线兼容。
 *
 * P2 第一版能力边界：
 *  - 标准分类（全部/收藏/角色/场景/道具/特效/文稿/剧本）：新分页网格 + 批量
 *    插入/下载/删除（单次 IPC）+ 详情抽屉；
 *  - 分镜分组：分组治理（AssetShotsView）；
 *  - 提示词库 / Files：嵌入既有成熟 tab 组件；
 *  - 文稿导入、剧本编辑等重编辑链路仍走旧中心（onOpenLegacyCenter），
 *    由 P4/P5 步骤模式逐步承接后下线旧中心。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input, Modal, Select, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../../Icons'
import type { CanvasAsset, CanvasSnapshot } from '../canvas.types'
import { canvasApi } from '../canvas.api'
import { type FilmAssetKind, readAssetKind } from '../canvasFilmAssets'
import { type FilmCenterHandlers } from '../CanvasFilmAssetCenter'
import { downloadCanvasResourceBatch } from '../CanvasAssetsPanel'
import { CanvasFilmPromptLibraryTab } from '../CanvasFilmPromptLibraryTab'
import { CanvasProviderFilesTab } from '../CanvasProviderFilesTab'
import { countAssetReferences } from './assetReferences'
import { collectAssetGenerationStatuses } from './assetGenerationStatus'
import { AssetGrid, type AssetCardAction } from './AssetGrid'
import { AssetDetailDrawer, type AssetDetailAction } from './AssetDetailDrawer'
import { AssetLibrarySidebar, type AssetLibraryCategory } from './AssetLibrarySidebar'
import { AssetBatchActions } from './AssetBatchActions'
import { AssetShotsView } from './AssetShotsView'
import { useAssetLibrary } from './useAssetLibrary'

/** 标准分类 → 影视 kind 过滤；null = 不限 kind（收藏视图仍限定顶层 kind 集，避免章节等子资产混入） */
const KIND_BY_CATEGORY: Partial<Record<AssetLibraryCategory, FilmAssetKind[] | null>> = {
  all: ['manuscript', 'script', 'character', 'scene', 'prop', 'effect'],
  favorite: ['manuscript', 'script', 'character', 'scene', 'prop', 'effect'],
  character: ['character'],
  scene: ['scene'],
  prop: ['prop'],
  effect: ['effect'],
  manuscript: ['manuscript'],
  script: ['script'],
}

const SORT_OPTIONS = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近创建' },
  { value: 'title', label: '名称' },
  { value: 'usage', label: '引用最多' },
] as const

const GRID_CATEGORIES: ReadonlySet<AssetLibraryCategory> = new Set([
  'all',
  'favorite',
  'character',
  'scene',
  'prop',
  'effect',
  'manuscript',
  'script',
])

export type ProjectAssetLibraryProps = {
  open: boolean
  onClose: () => void
  projectId: string | null
  projectTitle?: string | null
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  initialCategory?: AssetLibraryCategory
  /** 打开旧资产中心（文稿导入 / 剧本编辑等重编辑链路的过渡入口，P4/P5 承接后移除） */
  onOpenLegacyCenter?: () => void
  /**
   * 容器直接经 canvasApi 写库（收藏 / 批量删除）后调用；CanvasWorkspaceView
   * 应重新 openSnapshot 并 setSnapshot，驱动 usageCounts / 分类计数 / 详情刷新
   * （仓储 list 返回 db 内元素引用，快照不换新时 memo 卡片不会感知变化）。
   */
  onDataMutated?: () => void
}

export function ProjectAssetLibrary({
  open,
  onClose,
  projectId,
  projectTitle,
  snapshot,
  handlers,
  initialCategory,
  onOpenLegacyCenter,
  onDataMutated,
}: ProjectAssetLibraryProps) {
  const [category, setCategory] = useState<AssetLibraryCategory>(initialCategory ?? 'all')
  // initialCategory 变化时在渲染期同步分类（React 官方「调整 state 当 prop 变化」
  // 模式，取代 effect 内 setState 的级联渲染写法）
  const [lastInitialCategory, setLastInitialCategory] = useState(initialCategory)
  if (initialCategory !== lastInitialCategory) {
    setLastInitialCategory(initialCategory)
    if (initialCategory) setCategory(initialCategory)
  }
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 收藏等就地改动不换 asset 引用，靠递增 key 强制网格重渲
  const [renderKey, setRenderKey] = useState(0)
  // snapshot 引用变化 → 列表重载（跳过首次，避免 mount 双载）
  const [dataRevision, setDataRevision] = useState(0)
  const firstSnapshotRef = useRef(true)

  useEffect(() => {
    if (firstSnapshotRef.current) {
      firstSnapshotRef.current = false
      return
    }
    setDataRevision((tick) => tick + 1)
  }, [snapshot])

  const kind = useMemo<FilmAssetKind[] | null>(() => KIND_BY_CATEGORY[category] ?? null, [category])
  const favorite = category === 'favorite'
  const isGridCategory = GRID_CATEGORIES.has(category)

  const library = useAssetLibrary(open ? projectId : null, {
    kind,
    ...(favorite ? { favorite } : {}),
    revision: dataRevision,
  })

  // 打开 / 切换分类时回第一页重载
  const firstOpenRef = useRef(true)
  useEffect(() => {
    if (!open) {
      firstOpenRef.current = true
      return
    }
    if (firstOpenRef.current) {
      firstOpenRef.current = false
      return
    }
    library.refresh()
    // 仅在打开瞬间刷新；分类切换由 useAssetLibrary 的 kind/favorite 变化自行重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const usageCounts = useMemo(() => countAssetReferences(snapshot.nodes), [snapshot.nodes])

  // 资产生成任务状态（R3）：画布模式生成走任务节点，抽屉回显最近一次状态
  const generationStatuses = useMemo(
    () => collectAssetGenerationStatuses(snapshot.nodes),
    [snapshot.nodes],
  )

  const counts = useMemo(() => {
    const result: Partial<Record<AssetLibraryCategory, number>> = {}
    let favoriteCount = 0
    for (const asset of snapshot.assets) {
      const assetKind = readAssetKind(asset)
      if (!assetKind) continue
      const key = assetKind as AssetLibraryCategory
      result[key] = (result[key] ?? 0) + 1
      if (assetKind !== 'chapter' && asset.metadata?.['favorite'] === true) favoriteCount += 1
    }
    result.all = topLevelKindsCount(snapshot.assets)
    result.favorite = favoriteCount
    return result
  }, [snapshot.assets])

  const detailAsset = useMemo(
    () =>
      detailAssetId ? (snapshot.assets.find((asset) => asset.id === detailAssetId) ?? null) : null,
    [detailAssetId, snapshot.assets],
  )

  const isFavorite = useCallback((asset: CanvasAsset) => asset.metadata?.['favorite'] === true, [])

  const toggleFavorite = useCallback(
    async (asset: CanvasAsset) => {
      if (!projectId) return
      try {
        await canvasApi.setFilmAssetFavorite(projectId, asset.id, !isFavorite(asset))
        // 仓储 list 返回 db 内可变元素引用，metadata 就地更新不会触发 memo 重渲；
        // 换 key 强制网格重建 + 通知父组件换新快照
        setRenderKey((tick) => tick + 1)
        onDataMutated?.()
      } catch {
        message.error('收藏状态更新失败')
      }
    },
    [projectId, isFavorite, onDataMutated],
  )

  const insertToCanvas = useCallback(
    (asset: CanvasAsset) => {
      handlers.onInsertAssetToCanvas(asset.id)
      message.success(`已插入「${asset.title ?? asset.id}」`)
    },
    [handlers],
  )

  const locateAsset = useCallback(
    (asset: CanvasAsset) => {
      if (!handlers.onLocateAsset) return
      handlers.onLocateAsset(asset.id)
      onClose()
    },
    [handlers, onClose],
  )

  const deleteAssets = useCallback(
    (assets: CanvasAsset[]) => {
      if (!projectId || assets.length === 0) return
      const referenced = assets.filter((asset) => (usageCounts.get(asset.id) ?? 0) > 0)
      Modal.confirm({
        title: `删除 ${assets.length} 个资产`,
        content: referenced.length
          ? `其中 ${referenced.length} 个仍被画布节点引用，删除后相关节点将被移除，且源文件一并清理。`
          : '将同时清理对应的本地与 Provider 源文件，此操作不可恢复。',
        okButtonProps: { danger: true },
        onOk: async () => {
          setBusy(true)
          try {
            const result = await canvasApi.batchDeleteFilmAssets(
              projectId,
              assets.map((asset) => asset.id),
              { hardDelete: true },
            )
            message.success(
              `已删除 ${result.deletedAssetIds.length} 个资产${
                result.removedNodeIds.length
                  ? `，移除 ${result.removedNodeIds.length} 个画布节点`
                  : ''
              }`,
            )
            setSelectedIds(new Set())
            if (detailAssetId && result.deletedAssetIds.includes(detailAssetId)) {
              setDetailAssetId(null)
            }
            library.refresh()
            onDataMutated?.()
          } catch {
            message.error('批量删除失败')
          } finally {
            setBusy(false)
          }
        },
      })
    },
    [projectId, usageCounts, detailAssetId, library, onDataMutated],
  )

  const downloadAssets = useCallback(async (assets: CanvasAsset[]) => {
    if (assets.length === 0) return
    // 结果提示由 downloadCanvasResourceBatch 内部统一弹出（成功 / 部分失败 / 取消 / 错误）
    await downloadCanvasResourceBatch(assets)
  }, [])

  // —— 卡片 hover 操作（icon-only）——
  const cardActions = useMemo<AssetCardAction[]>(() => {
    const actions: AssetCardAction[] = [
      {
        key: 'insert',
        icon: <Icons.Plus size={13} />,
        label: '插入画布',
        onClick: (asset) => insertToCanvas(asset),
      },
    ]
    if (handlers.onLocateAsset) {
      actions.push({
        key: 'locate',
        icon: <Icons.Crosshair size={13} />,
        label: '定位引用节点',
        onClick: (asset) => locateAsset(asset),
      })
    }
    actions.push(
      {
        key: 'favorite',
        icon: <Icons.Star size={13} />,
        label: '收藏 / 取消收藏',
        onClick: (asset) => toggleFavorite(asset),
      },
      {
        key: 'delete',
        icon: <Icons.Trash size={13} />,
        label: '删除',
        danger: true,
        onClick: (asset) => deleteAssets([asset]),
      },
    )
    return actions
  }, [handlers, insertToCanvas, locateAsset, toggleFavorite, deleteAssets])

  // —— 详情抽屉操作 ——
  const detailActions = useMemo<AssetDetailAction[]>(() => {
    const actions: AssetDetailAction[] = []
    const kindOf = (asset: CanvasAsset) => readAssetKind(asset)
    actions.push({
      key: 'insert',
      label: '插入画布',
      icon: <Icons.Plus size={13} />,
      onClick: (asset) => insertToCanvas(asset),
    })
    if (handlers.onGenerateAssetReference) {
      actions.push({
        key: 'reference',
        label: '生成参考图',
        icon: <Icons.Sparkles size={13} />,
        onClick: (asset) => {
          if (['character', 'scene', 'prop', 'effect'].includes(kindOf(asset) ?? '')) {
            handlers.onGenerateAssetReference?.(asset)
          }
        },
      })
    }
    if (handlers.onBreakdownScriptAsset) {
      actions.push({
        key: 'breakdown',
        label: '拆解剧本',
        icon: <Icons.Wand size={13} />,
        onClick: (asset) => {
          if (kindOf(asset) === 'script') handlers.onBreakdownScriptAsset?.(asset)
        },
      })
    }
    actions.push({
      key: 'download',
      label: '下载',
      icon: <Icons.Download size={13} />,
      onClick: (asset) => downloadAssets([asset]),
    })
    actions.push({
      key: 'delete',
      label: '删除',
      icon: <Icons.Trash size={13} />,
      danger: true,
      onClick: (asset) => deleteAssets([asset]),
    })
    return actions
  }, [handlers, insertToCanvas, downloadAssets, deleteAssets])

  // —— 批量操作 ——
  const selectedAssets = useMemo(
    () => library.items.filter((asset) => selectedIds.has(asset.id)),
    [library.items, selectedIds],
  )

  const toggleSelect = useCallback((asset: CanvasAsset) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(asset.id)) next.delete(asset.id)
      else next.add(asset.id)
      return next
    })
  }, [])

  const allPageSelected =
    library.items.length > 0 && library.items.every((asset) => selectedIds.has(asset.id))

  const toggleSelectPage = useCallback(() => {
    setSelectedIds((current) => {
      if (library.items.length > 0 && library.items.every((asset) => current.has(asset.id))) {
        const next = new Set(current)
        for (const asset of library.items) next.delete(asset.id)
        return next
      }
      const next = new Set(current)
      for (const asset of library.items) next.add(asset.id)
      return next
    })
  }, [library.items])

  // ESC：先关详情，再退出批量态，最后关库（capture 拦截，避免漏给画布快捷键）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 输入框内的 ESC 交给组件自身（antd Input 的清空/失焦），但同样不能漏给画布快捷键
      const target = event.target as HTMLElement | null
      const inField =
        target != null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      event.stopPropagation()
      if (inField) return
      if (detailAssetId) setDetailAssetId(null)
      else if (selectionMode) {
        setSelectionMode(false)
        setSelectedIds(new Set())
      } else onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, detailAssetId, selectionMode, onClose])

  if (!open) return null

  const headerNote =
    (category === 'manuscript' || category === 'script') && onOpenLegacyCenter
      ? '完整文稿 / 剧本编辑工具'
      : null

  return createPortal(
    <div
      className="asset-library-root"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="asset-library-panel">
        <div className="asset-library-header">
          <div className="asset-library-header-title">
            <strong>项目资产库</strong>
            <span>{projectTitle ?? ''}</span>
          </div>
          {isGridCategory ? (
            <Button
              size="small"
              type={selectionMode ? 'primary' : 'text'}
              onClick={() => {
                setSelectionMode((current) => !current)
                setSelectedIds(new Set())
              }}
            >
              {selectionMode ? '退出批量' : '批量管理'}
            </Button>
          ) : null}
          {headerNote ? (
            <Button size="small" type="text" onClick={onOpenLegacyCenter}>
              {headerNote}
            </Button>
          ) : null}
          <button className="asset-library-close" onClick={onClose} aria-label="关闭资产库">
            ✕
          </button>
        </div>

        <div className="asset-library-content">
          <AssetLibrarySidebar active={category} onSelect={setCategory} counts={counts} />

          <div className="asset-library-main">
            {isGridCategory ? (
              <>
                <div className="asset-library-toolbar">
                  <Input
                    allowClear
                    size="small"
                    style={{ width: 220 }}
                    placeholder="搜索名称 / 描述 / 标签"
                    value={library.keyword}
                    onChange={(event) => library.setKeyword(event.target.value)}
                  />
                  <Select
                    size="small"
                    style={{ width: 116 }}
                    value={library.sortBy}
                    options={[...SORT_OPTIONS]}
                    onChange={(value) => library.setSortBy(value)}
                  />
                  <div className="asset-library-toolbar-spacer" />
                  <span className="asset-library-total">共 {library.total} 项</span>
                </div>
                {library.error ? (
                  <div className="asset-library-error">
                    <span>资产列表加载失败，请检查后重试</span>
                    <Button size="small" onClick={() => library.refresh()}>
                      重试
                    </Button>
                  </div>
                ) : null}
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <AssetGrid
                    key={renderKey}
                    items={library.items}
                    loading={library.loading}
                    hasMore={library.hasMore}
                    onLoadMore={library.loadMore}
                    onCardClick={(asset) => setDetailAssetId(asset.id)}
                    selectedIds={selectionMode ? selectedIds : undefined}
                    onToggleSelect={selectionMode ? toggleSelect : undefined}
                    usageCounts={usageCounts}
                    cardActions={cardActions}
                    isFavorite={isFavorite}
                    emptyText={
                      library.keyword
                        ? '当前过滤条件下没有匹配的资产'
                        : favorite
                          ? '还没有收藏的资产'
                          : '暂无资产'
                    }
                  />
                  {selectionMode ? (
                    <AssetBatchActions
                      selectedCount={selectedIds.size}
                      allPageSelected={allPageSelected}
                      onToggleSelectPage={toggleSelectPage}
                      onClearSelection={() => setSelectedIds(new Set())}
                      onInsertSelected={() => {
                        for (const asset of selectedAssets) handlers.onInsertAssetToCanvas(asset.id)
                        message.success(`已插入 ${selectedAssets.length} 个资产`)
                      }}
                      onDownloadSelected={() => downloadAssets(selectedAssets)}
                      onDeleteSelected={() => deleteAssets(selectedAssets)}
                      busy={busy}
                    />
                  ) : null}
                  {detailAsset ? (
                    <AssetDetailDrawer
                      asset={detailAsset}
                      usageCount={usageCounts.get(detailAsset.id) ?? 0}
                      onClose={() => setDetailAssetId(null)}
                      actions={detailActions}
                      generationStatus={generationStatuses.get(detailAsset.id) ?? undefined}
                    />
                  ) : null}
                </div>
              </>
            ) : category === 'shots' ? (
              <AssetShotsView snapshot={snapshot} handlers={handlers} />
            ) : category === 'prompt_library' ? (
              <CanvasFilmPromptLibraryTab snapshot={snapshot} handlers={handlers} />
            ) : (
              <CanvasProviderFilesTab
                onAddToCanvas={(file, providerProfileId) =>
                  handlers.onInsertProviderFileToCanvas?.({
                    providerProfileId,
                    fileId: file.id,
                    fileName: file.filename,
                    mimeType: file.purpose,
                  })
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 顶层 kind（不含 chapter 子资产）总数，供「全部资产」计数 */
function topLevelKindsCount(assets: readonly CanvasAsset[]): number {
  const topLevel = new Set<FilmAssetKind>(KIND_BY_CATEGORY.all ?? [])
  let count = 0
  for (const asset of assets) {
    const kind = readAssetKind(asset)
    if (kind && topLevel.has(kind)) count += 1
  }
  return count
}
