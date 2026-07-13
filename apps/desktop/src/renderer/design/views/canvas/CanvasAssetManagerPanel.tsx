import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Popconfirm, Tag, Tooltip, message } from 'antd'
import { Button, SearchBar as LobeSearchBar, Select as LobeSelect, Segmented } from '@lobehub/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { downloadCanvasResourceBatch } from './CanvasAssetsPanel'
import { CanvasCharacterSubviewPreview } from './CanvasCharacterSubviewPreview'
import {
  CHARACTER_SUBVIEW_KIND_LABELS,
  readCharacterSubviews,
  resolveCharacterSourceImageAsset,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'
import { readAssetKind } from './canvasFilmAssets'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

type AssetTypeFilter = 'all' | CanvasAsset['type']

const HIDDEN_ASSET_KINDS = new Set(['manuscript', 'chapter'])

/**
 * 多选上限。批量插入/下载/移除在大量资产时会产生密集 DOM / 网络请求，
 * 把单次选择封顶在 30 个，避免面板卡死。
 */
const MAX_SELECTION = 30

/**
 * 左侧工作台「资产管理」tab（文档 §7.2）。
 *
 * 偏治理：列表/网格视图切换、多选、批量下载/插入/移除引用、
 * 查看被哪些节点引用、由哪个任务生成、落盘路径。
 * 资产删除两段式（文档 §11.3）：这里只做「移除引用」，不做「删文件」。
 */
export function CanvasAssetManagerPanel({
  assets,
  nodes,
  tasks,
  onInsertAssets,
  onRemoveReferences,
  onInsertOne,
  onInsertSubview,
  onDownloadOne,
  detailResetKey,
  onOpenDetail,
}: {
  assets: CanvasAsset[]
  nodes: CanvasNode[]
  tasks: CanvasTask[]
  onInsertAssets: (assetIds: string[]) => void
  onRemoveReferences: (assetIds: string[]) => Promise<void> | void
  onInsertOne: (assetId: string) => void
  onInsertSubview: (
    ownerAsset: CanvasAsset,
    sourceImageAsset: CanvasAsset,
    subview: FilmCharacterSubview,
  ) => Promise<void> | void
  onDownloadOne: (asset: CanvasAsset) => Promise<void>
  detailResetKey?: number
  onOpenDetail?: () => void
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detailAsset, setDetailAsset] = useState<CanvasAsset | null>(null)

  // 引用反查：assetId → 引用它的节点列表；assetId → 生成它的任务
  const referencesByAsset = useMemo(() => {
    const map = new Map<string, CanvasNode[]>()
    for (const node of nodes) {
      if (!node.assetId) continue
      const list = map.get(node.assetId) ?? []
      list.push(node)
      map.set(node.assetId, list)
    }
    return map
  }, [nodes])

  const originTaskByAsset = useMemo(() => {
    const map = new Map<string, CanvasTask>()
    for (const task of tasks) {
      for (const assetId of task.outputAssetIds) {
        if (!map.has(assetId)) map.set(assetId, task)
      }
    }
    return map
  }, [tasks])

  const subviewEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (typeFilter !== 'all' && typeFilter !== 'image') return []
    return assets
      .flatMap((asset) => {
        const subviews = readCharacterSubviews(asset.metadata)
        if (subviews.length === 0) return []
        const sourceImageAsset =
          asset.type === 'image'
            ? asset
            : resolveCharacterSourceImageAsset(asset, assets, {
                nodes,
                tasks,
              })
        if (!sourceImageAsset) return []
        return subviews.map((subview) => ({
          key: `${asset.id}:${subview.id}`,
          ownerAsset: asset,
          sourceImageAsset,
          subview,
        }))
      })
      .filter((entry) => {
        if (!keyword) return true
        return [
          entry.ownerAsset.title,
          entry.sourceImageAsset.title,
          entry.subview.label,
          CHARACTER_SUBVIEW_KIND_LABELS[entry.subview.kind],
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword))
      })
  }, [assets, nodes, query, tasks, typeFilter])

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return assets.filter((asset) => {
      const kind = readAssetKind(asset)
      if (kind && HIDDEN_ASSET_KINDS.has(kind)) return false
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false
      if (!keyword) return true
      return [asset.title, asset.contentText, asset.mimeType, asset.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [assets, query, typeFilter])

  const hiddenInternalAssetCount = useMemo(
    () =>
      assets.reduce((count, asset) => {
        const kind = readAssetKind(asset)
        return kind && HIDDEN_ASSET_KINDS.has(kind) ? count + 1 : count
      }, 0),
    [assets],
  )

  // —— 虚拟滚动 ——
  // 列表/网格各自维护一个滚动容器 ref + virtualizer。资产面板的卡顿根因是全量 .map() 渲染 +
  // 缩略图 <img> 并发请求；虚拟滚动把 DOM 节点数压到常量级（可视区 + overscan）。
  // 行高半动态（meta 多 tag 时 flex-wrap 撑高），用 measureElement 实测校正 estimateSize。
  const GRID_COLUMN_COUNT = 2
  const listScrollRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: filteredAssets.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  })
  const gridRowCount = Math.ceil(filteredAssets.length / GRID_COLUMN_COUNT)
  const gridRowVirtualizer = useVirtualizer({
    count: gridRowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => 210,
    overscan: 4,
  })

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((asset) => selectedSet.has(asset.id))

  const toggleSelect = (assetId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(assetId)) return prev.filter((id) => id !== assetId)
      if (prev.length >= MAX_SELECTION) {
        message.warning(`为避免卡顿，最多同时选择 ${MAX_SELECTION} 个资产`)
        return prev
      }
      return [...prev, assetId]
    })
  }
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds([])
      return
    }
    // 超 MAX_SELECTION 个时只选前 MAX_SELECTION 个，避免一次选几百个卡死面板
    const next =
      filteredAssets.length > MAX_SELECTION
        ? filteredAssets.slice(0, MAX_SELECTION).map((asset) => asset.id)
        : filteredAssets.map((asset) => asset.id)
    setSelectedIds(next)
    if (filteredAssets.length > MAX_SELECTION) {
      message.info(`已选前 ${MAX_SELECTION} 个（最多 ${MAX_SELECTION}）`)
    }
  }
  const showDetail = (asset: CanvasAsset) => {
    onOpenDetail?.()
    setDetailAsset(asset)
  }

  useEffect(() => {
    setDetailAsset(null)
  }, [detailResetKey])

  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) return
    // 批量下载：只弹一次目录选择对话框，一次性写入，不再逐个弹窗
    const selectedAssets = filteredAssets.filter((asset) => selectedSet.has(asset.id))
    const succeeded = await downloadCanvasResourceBatch(selectedAssets)
    if (succeeded > 0) setSelectedIds([])
  }

  const handleBatchInsert = () => {
    if (selectedIds.length === 0) return
    onInsertAssets(selectedIds)
    setSelectedIds([])
  }

  const handleBatchRemove = async () => {
    if (selectedIds.length === 0) return
    await onRemoveReferences(selectedIds)
    message.success(`已移除 ${selectedIds.length} 个资产的节点引用`)
    setSelectedIds([])
  }

  return (
    <div className="canvas-asset-manager">
      <div className="canvas-asset-manager-filters">
        <LobeSearchBar
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索资产..."
        />
        <div className="canvas-asset-manager-filter-row">
          <LobeSelect
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as AssetTypeFilter)}
            style={{ flex: 1 }}
            options={[
              { label: '全部类型', value: 'all' },
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '音频', value: 'audio' },
              { label: '文本', value: 'text' },
              { label: 'Prompt', value: 'prompt' },
              { label: '文件', value: 'file' },
            ]}
          />
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value as 'list' | 'grid')}
            options={[
              { label: '', value: 'list', icon: <Icons.Menu size={14} /> },
              { label: '', value: 'grid', icon: <Icons.Layers size={14} /> },
            ]}
          />
        </div>
      </div>

      {hiddenInternalAssetCount > 0 && (
        <div className="canvas-asset-manager-batchbar">
          <span className="canvas-asset-manager-batchbar-count">
            已隐藏 {hiddenInternalAssetCount} 个文稿分片/章节资产
          </span>
        </div>
      )}

      {subviewEntries.length > 0 && (
        <div className="canvas-asset-subview-library">
          <div className="canvas-asset-subview-library-head">
            <div>
              <strong>图片子视图库</strong>
              <span>项目里已保存的子视图，可直接插回画布继续使用。</span>
            </div>
            <span className="canvas-asset-subview-library-count">{subviewEntries.length} 个</span>
          </div>
          <div className="canvas-asset-subview-library-grid">
            {subviewEntries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="canvas-asset-subview-card"
                onClick={() =>
                  void onInsertSubview(entry.ownerAsset, entry.sourceImageAsset, entry.subview)
                }
              >
                <div className="canvas-asset-subview-card-thumb">
                  <CanvasCharacterSubviewPreview
                    asset={entry.sourceImageAsset}
                    subview={entry.subview}
                    alt={entry.subview.label}
                  />
                </div>
                <div className="canvas-asset-subview-card-main">
                  <strong title={entry.subview.label}>{entry.subview.label}</strong>
                  <span>{CHARACTER_SUBVIEW_KIND_LABELS[entry.subview.kind]}</span>
                  <span
                    className="canvas-asset-subview-card-source"
                    title={entry.ownerAsset.title ?? entry.sourceImageAsset.title ?? '未命名图片'}
                  >
                    来自 {entry.ownerAsset.title ?? entry.sourceImageAsset.title ?? '未命名图片'}
                  </span>
                </div>
                <span className="canvas-asset-subview-card-action">
                  <Icons.Plus size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="canvas-asset-manager-batchbar">
          <span className="canvas-asset-manager-batchbar-count">
            已选 {selectedIds.length}
            {filteredAssets.length > MAX_SELECTION && selectedIds.length >= MAX_SELECTION
              ? ` / 上限 ${MAX_SELECTION}`
              : ''}
          </span>
          <div className="canvas-asset-manager-batchbar-actions">
            <Popconfirm
              title={`确定将 ${selectedIds.length} 个资产插入到当前视口？`}
              okText="插入"
              cancelText="取消"
              onConfirm={handleBatchInsert}
            >
              <Tooltip title="批量插入到当前视口">
                <Button size="middle" type="text" shape="circle" icon={<Icons.Plus size={13} />} />
              </Tooltip>
            </Popconfirm>
            <Popconfirm
              title={`确定下载 ${selectedIds.length} 个资产？`}
              okText="下载"
              cancelText="取消"
              onConfirm={() => void handleBatchDownload()}
            >
              <Tooltip title="批量下载">
                <Button
                  size="middle"
                  type="text"
                  shape="circle"
                  icon={<Icons.Download size={13} />}
                />
              </Tooltip>
            </Popconfirm>
            <Popconfirm
              title={`确定移除 ${selectedIds.length} 个资产的节点引用？（不删文件）`}
              okText="移除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleBatchRemove()}
            >
              <Tooltip title="移除节点引用（不删文件）">
                <Button
                  size="middle"
                  type="text"
                  danger
                  shape="circle"
                  icon={<Icons.Trash size={13} />}
                />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
      )}

      {filteredAssets.length === 0 ? (
        <div className="canvas-assets-empty">暂无资产</div>
      ) : viewMode === 'grid' ? (
        <div ref={gridScrollRef} className="canvas-asset-manager-grid">
          <div
            style={{
              height: gridRowVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {gridRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const startIndex = virtualRow.index * GRID_COLUMN_COUNT
              const rowAssets = filteredAssets.slice(startIndex, startIndex + GRID_COLUMN_COUNT)
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridRowVirtualizer.measureElement}
                  className="canvas-asset-manager-grid-row"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rowAssets.map((asset) => (
                    <AssetGridCardMemo
                      key={asset.id}
                      asset={asset}
                      selected={selectedSet.has(asset.id)}
                      referenceCount={referencesByAsset.get(asset.id)?.length ?? 0}
                      onToggle={() => toggleSelect(asset.id)}
                      onShowDetail={() => showDetail(asset)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="canvas-asset-manager-list-head">
            <Button size="middle" type="link" onClick={toggleSelectAll}>
              {allFilteredSelected
                ? '取消全选'
                : filteredAssets.length > MAX_SELECTION
                  ? `全选前 ${MAX_SELECTION} 个`
                  : '全选'}
            </Button>
          </div>
          <div ref={listScrollRef} className="canvas-asset-manager-list">
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
                width: '100%',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                // virtualizer count 来自 filteredAssets.length，index 必在范围内
                const asset = filteredAssets[virtualItem.index]
                if (!asset) return null
                const originTask = originTaskByAsset.get(asset.id)
                return (
                  <div
                    key={asset.id}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <AssetManagerRowMemo
                      asset={asset}
                      selected={selectedSet.has(asset.id)}
                      referenceCount={referencesByAsset.get(asset.id)?.length ?? 0}
                      {...(originTask ? { originTask } : {})}
                      onToggle={() => toggleSelect(asset.id)}
                      onShowDetail={() => showDetail(asset)}
                      onInsertOne={onInsertOne}
                      onDownloadOne={onDownloadOne}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {(() => {
        const originTask = detailAsset ? originTaskByAsset.get(detailAsset.id) : undefined
        return (
          <AssetDetailModal
            asset={detailAsset}
            references={detailAsset ? (referencesByAsset.get(detailAsset.id) ?? []) : []}
            {...(originTask ? { originTask } : {})}
            onClose={() => setDetailAsset(null)}
          />
        )
      })()}
    </div>
  )
}

function AssetGridCard({
  asset,
  selected,
  referenceCount,
  onToggle,
  onShowDetail,
}: {
  asset: CanvasAsset
  selected: boolean
  referenceCount: number
  onToggle: () => void
  onShowDetail: () => void
}) {
  return (
    <div
      className={`canvas-asset-grid-card${selected ? ' selected' : ''}`}
      onClick={onToggle}
      onDoubleClick={onShowDetail}
    >
      <div className="canvas-asset-grid-thumb">
        <AssetThumbnail asset={asset} />
      </div>
      <div className="canvas-asset-grid-info">
        <span className="canvas-asset-grid-name" title={asset.title ?? asset.type}>
          {asset.title ?? asset.type}
        </span>
        {referenceCount > 0 && (
          <span className="canvas-asset-grid-refs">{referenceCount} 引用</span>
        )}
      </div>
    </div>
  )
}

const AssetGridCardMemo = memo(AssetGridCard)

function AssetManagerRow({
  asset,
  selected,
  referenceCount,
  originTask,
  onToggle,
  onShowDetail,
  onInsertOne,
  onDownloadOne,
}: {
  asset: CanvasAsset
  selected: boolean
  referenceCount: number
  originTask?: CanvasTask
  onToggle: () => void
  onShowDetail: () => void
  onInsertOne: (assetId: string) => void
  onDownloadOne: (asset: CanvasAsset) => Promise<void>
}) {
  return (
    <div className={`canvas-asset-manager-row${selected ? ' selected' : ''}`} onClick={onToggle}>
      <div className="canvas-asset-mini-thumb">
        <AssetThumbnail asset={asset} />
      </div>
      <div className="canvas-asset-manager-row-main">
        <div className="canvas-asset-mini-title" title={asset.title ?? asset.type}>
          {asset.title ?? asset.type}
        </div>
        <div className="canvas-asset-manager-row-meta">
          <span className="canvas-asset-meta-type">{asset.type}</span>
          <span className="canvas-asset-meta-sep">·</span>
          <span className="canvas-asset-meta-source">{asset.source}</span>
          {referenceCount > 0 && (
            <>
              <span className="canvas-asset-meta-sep">·</span>
              <span className="canvas-asset-ref-count">{referenceCount} 引用</span>
            </>
          )}
          {originTask && (
            <span
              className="canvas-asset-origin-task"
              title={originTask.title ?? originTask.operation}
            >
              · 由 {originTask.title ?? originTask.operation} 生成
            </span>
          )}
        </div>
      </div>
      <div className="canvas-asset-manager-row-actions">
        <Tooltip title="插入到当前视口">
          <Button
            size="middle"
            type="text"
            icon={<Icons.Plus size={13} />}
            onClick={(event) => {
              event.stopPropagation()
              onInsertOne(asset.id)
            }}
          />
        </Tooltip>
        <Tooltip title="下载">
          <Button
            size="middle"
            type="text"
            icon={<Icons.Download size={13} />}
            onClick={(event) => {
              event.stopPropagation()
              void onDownloadOne(asset)
            }}
          />
        </Tooltip>
        <Button
          size="middle"
          type="text"
          icon={<Icons.Search size={13} />}
          onClick={(event) => {
            event.stopPropagation()
            onShowDetail()
          }}
        />
      </div>
    </div>
  )
}

const AssetManagerRowMemo = memo(AssetManagerRow)

function AssetDetailModal({
  asset,
  references,
  originTask,
  onClose,
}: {
  asset: CanvasAsset | null
  references: CanvasNode[]
  originTask?: CanvasTask
  onClose: () => void
}) {
  useEffect(() => {
    if (!asset) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [asset, onClose])

  return (
    <>
      {asset && (
        <div className="canvas-asset-detail-overlay" onClick={onClose}>
          <div
            className="canvas-asset-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${asset.title ?? asset.type}资产预览`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="canvas-asset-detail-head">
              <div>
                <span>资产预览</span>
                <h4>{asset.title ?? asset.type}</h4>
              </div>
              <Button size="middle" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
            </div>
            <div className="canvas-asset-detail-body">
              <div className="canvas-asset-detail-preview">
                <AssetDetailPreview asset={asset} />
                <span>{asset.type}</span>
              </div>
              <DetailItem label="类型" value={asset.type} />
              <DetailItem label="来源" value={asset.source} />
              {asset.mimeType && <DetailItem label="MIME" value={asset.mimeType} />}
              {asset.storageKey && <DetailItem label="落盘路径" value={asset.storageKey} mono />}
              {asset.sizeBytes != null && (
                <DetailItem label="大小" value={`${(asset.sizeBytes / 1024).toFixed(1)} KB`} />
              )}
              <div className="canvas-asset-detail-section">
                <div className="canvas-asset-detail-section-title">
                  引用节点（{references.length}）
                </div>
                {references.length === 0 ? (
                  <div className="canvas-asset-detail-empty">无节点引用</div>
                ) : (
                  references.map((node) => (
                    <div key={node.id} className="canvas-asset-detail-ref">
                      <Tag color="default" bordered>
                        {node.type}
                      </Tag>
                      <span>{node.title ?? node.id}</span>
                    </div>
                  ))
                )}
              </div>
              {originTask && (
                <div className="canvas-asset-detail-section">
                  <div className="canvas-asset-detail-section-title">生成任务</div>
                  <div className="canvas-asset-detail-ref">
                    <Tag color="green" bordered>
                      {originTask.operation}
                    </Tag>
                    <span>{originTask.title ?? originTask.id}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AssetDetailPreview({ asset }: { asset: CanvasAsset }) {
  const source = asset.url ? normalizeEduAssetUrl(asset.url) : null

  if (asset.type === 'image' && source) {
    return <img src={source} alt={asset.title ?? '图片资产预览'} />
  }
  if (asset.type === 'video' && source) {
    return <video src={source} controls preload="metadata" />
  }
  if (asset.type === 'audio' && source) {
    return <audio src={source} controls preload="metadata" />
  }
  return <AssetThumbnail asset={asset} />
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="canvas-asset-detail-item">
      <span className="canvas-asset-detail-label">{label}</span>
      <span
        className={mono ? 'canvas-asset-detail-value mono' : 'canvas-asset-detail-value'}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
