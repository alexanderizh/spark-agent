import { useEffect, useMemo, useState } from 'react'
import { Tag, Tooltip, message } from 'antd'
import { Button, SearchBar as LobeSearchBar, Select as LobeSelect, Segmented } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { downloadAsset } from './CanvasAssetsPanel'
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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((asset) => selectedSet.has(asset.id))

  const toggleSelect = (assetId: string) => {
    setSelectedIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    )
  }
  const toggleSelectAll = () => {
    setSelectedIds(allFilteredSelected ? [] : filteredAssets.map((asset) => asset.id))
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
    let ok = 0
    for (const asset of filteredAssets) {
      if (selectedSet.has(asset.id)) {
        try {
          await downloadAsset(asset)
          ok += 1
        } catch {
          // 单个失败不阻断批量
        }
      }
    }
    message.success(`已下载 ${ok} 个资产`)
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
            <Tag color="gold" bordered>
              {subviewEntries.length} 个子视图
            </Tag>
          </div>
          <div className="canvas-asset-subview-library-grid">
            {subviewEntries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="canvas-asset-subview-card"
                onClick={() => void onInsertSubview(entry.ownerAsset, entry.sourceImageAsset, entry.subview)}
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
                  <span className="canvas-asset-subview-card-source" title={entry.ownerAsset.title ?? entry.sourceImageAsset.title ?? '未命名图片'}>
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
          <span className="canvas-asset-manager-batchbar-count">已选 {selectedIds.length}</span>
          <div className="canvas-asset-manager-batchbar-actions">
            <Tooltip title="批量插入到当前视口">
              <Button size="small" type="primary" shape="circle" icon={<Icons.Plus size={13} />} onClick={handleBatchInsert} />
            </Tooltip>
            <Tooltip title="批量下载">
              <Button size="small" type="default" shape="circle" icon={<Icons.Download size={13} />} onClick={() => void handleBatchDownload()} />
            </Tooltip>
            <Tooltip title="移除节点引用（不删文件）">
              <Button size="small" type="default" danger shape="circle" icon={<Icons.Trash size={13} />} onClick={() => void handleBatchRemove()} />
            </Tooltip>
          </div>
        </div>
      )}

      {filteredAssets.length === 0 ? (
        <div className="canvas-assets-empty">暂无资产</div>
      ) : viewMode === 'grid' ? (
        <div className="canvas-asset-manager-grid">
          {filteredAssets.map((asset) => (
            <AssetGridCard
              key={asset.id}
              asset={asset}
              selected={selectedSet.has(asset.id)}
              referenceCount={referencesByAsset.get(asset.id)?.length ?? 0}
              onToggle={() => toggleSelect(asset.id)}
              onShowDetail={() => showDetail(asset)}
            />
          ))}
        </div>
      ) : (
        <div className="canvas-asset-manager-list">
          <div className="canvas-asset-manager-list-head">
            <Button size="small" type="link" onClick={toggleSelectAll}>
              {allFilteredSelected ? '取消全选' : '全选'}
            </Button>
          </div>
          {filteredAssets.map((asset) => {
            const originTask = originTaskByAsset.get(asset.id)
            return (
            <AssetManagerRow
              key={asset.id}
              asset={asset}
              selected={selectedSet.has(asset.id)}
              referenceCount={referencesByAsset.get(asset.id)?.length ?? 0}
              {...(originTask ? { originTask } : {})}
              onToggle={() => toggleSelect(asset.id)}
              onShowDetail={() => showDetail(asset)}
              onInsertOne={onInsertOne}
              onDownloadOne={onDownloadOne}
            />
            )
          })}
        </div>
      )}

      {(() => {
        const originTask = detailAsset ? originTaskByAsset.get(detailAsset.id) : undefined
        return (
      <AssetDetailModal
        asset={detailAsset}
        references={detailAsset ? referencesByAsset.get(detailAsset.id) ?? [] : []}
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
          <Tag color="blue" bordered>
            {referenceCount} 引用
          </Tag>
        )}
      </div>
    </div>
  )
}

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
    <div
      className={`canvas-asset-manager-row${selected ? ' selected' : ''}`}
      onClick={onToggle}
    >
      <div className="canvas-asset-mini-thumb">
        <AssetThumbnail asset={asset} />
      </div>
      <div className="canvas-asset-manager-row-main">
        <div className="canvas-asset-mini-title" title={asset.title ?? asset.type}>
          {asset.title ?? asset.type}
        </div>
        <div className="canvas-asset-manager-row-meta">
          <Tag color="default" bordered>
            {asset.type}
          </Tag>
          <Tag color="blue" bordered>
            {asset.source}
          </Tag>
          {referenceCount > 0 && (
            <span className="canvas-asset-ref-count">{referenceCount} 节点引用</span>
          )}
          {originTask && (
            <span className="canvas-asset-origin-task">由 {originTask.title ?? originTask.operation} 生成</span>
          )}
        </div>
      </div>
      <div className="canvas-asset-manager-row-actions">
        <Tooltip title="插入到当前视口">
          <Button size="small" type="text" icon={<Icons.Plus size={13} />} onClick={(event) => {
            event.stopPropagation()
            onInsertOne(asset.id)
          }} />
        </Tooltip>
        <Tooltip title="下载">
          <Button size="small" type="text" icon={<Icons.Download size={13} />} onClick={(event) => {
            event.stopPropagation()
            void onDownloadOne(asset)
          }} />
        </Tooltip>
        <Button size="small" type="text" icon={<Icons.Search size={13} />} onClick={(event) => {
          event.stopPropagation()
          onShowDetail()
        }} />
      </div>
    </div>
  )
}

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
  return (
    <>
      {asset && (
        <div className="canvas-asset-detail-overlay">
          <div className="canvas-asset-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="canvas-asset-detail-head">
              <h4>{asset.title ?? asset.type}</h4>
              <Button size="small" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
            </div>
            <div className="canvas-asset-detail-body">
              <DetailItem label="类型" value={asset.type} />
              <DetailItem label="来源" value={asset.source} />
              {asset.mimeType && <DetailItem label="MIME" value={asset.mimeType} />}
              {asset.storageKey && (
                <DetailItem label="落盘路径" value={asset.storageKey} mono />
              )}
              {asset.sizeBytes != null && (
                <DetailItem label="大小" value={`${(asset.sizeBytes / 1024).toFixed(1)} KB`} />
              )}
              <div className="canvas-asset-detail-section">
                <div className="canvas-asset-detail-section-title">引用节点（{references.length}）</div>
                {references.length === 0 ? (
                  <div className="canvas-asset-detail-empty">无节点引用</div>
                ) : (
                  references.map((node) => (
                    <div key={node.id} className="canvas-asset-detail-ref">
                      <Tag color="default" bordered>{node.type}</Tag>
                      <span>{node.title ?? node.id}</span>
                    </div>
                  ))
                )}
              </div>
              {originTask && (
                <div className="canvas-asset-detail-section">
                  <div className="canvas-asset-detail-section-title">生成任务</div>
                  <div className="canvas-asset-detail-ref">
                    <Tag color="green" bordered>{originTask.operation}</Tag>
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

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="canvas-asset-detail-item">
      <span className="canvas-asset-detail-label">{label}</span>
      <span className={mono ? 'canvas-asset-detail-value mono' : 'canvas-asset-detail-value'} title={value}>
        {value}
      </span>
    </div>
  )
}
