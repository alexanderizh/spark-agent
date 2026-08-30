/**
 * 资产卡片网格（步骤模式设计文档 §5.4，P2）。
 *
 * 展示层组件：数据经 useAssetLibrary 分页取回，卡片操作全部由容器以回调注入
 * （插入画布 / 下载 / 删除 / 收藏 / 详情等），本组件不直接调用 store。
 * 视觉遵循项目扁平偏好：无渐变光晕，层级靠边框/色点/文字明暗（prj_9263e734）。
 */

import { memo, type ReactNode } from 'react'
import { Checkbox, Empty, Spin, Tooltip } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasAsset } from '../canvas.types'
import { AssetThumbnail } from '../CanvasAssetThumbnail'
import { FILM_ASSET_KIND_LABELS, readAssetKind } from '../canvasFilmAssets'
import './assetLibrary.less'

/** 卡片 hover 操作（icon-only 圆形按钮） */
export type AssetCardAction = {
  key: string
  icon: ReactNode
  label: string
  onClick: (asset: CanvasAsset, event: React.MouseEvent) => void
  danger?: boolean
}

export type AssetGridProps = {
  items: CanvasAsset[]
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  /** 空态文案 */
  emptyText?: string
  /** 卡片主体点击（打开详情等） */
  onCardClick?: ((asset: CanvasAsset) => void) | undefined
  /** 批量选择态：给出已选 id 集合时展示 checkbox */
  selectedIds?: ReadonlySet<string> | undefined
  onToggleSelect?: ((asset: CanvasAsset) => void) | undefined
  /** 引用计数（assetId → 未软删引用数），用于卡片角标 */
  usageCounts?: ReadonlyMap<string, number> | undefined
  /** 生成中的资产 id 集合（R3：卡片左上角「生成中」角标） */
  generatingIds?: ReadonlySet<string> | undefined
  /** hover 操作按钮组 */
  cardActions?: AssetCardAction[] | undefined
  /** 是否收藏（默认读 metadata.favorite） */
  isFavorite?: ((asset: CanvasAsset) => boolean) | undefined
}

function AssetCardInner({
  asset,
  usage,
  generating,
  selected,
  selectionActive,
  favorite,
  actions,
  onCardClick,
  onToggleSelect,
}: {
  asset: CanvasAsset
  usage: number
  generating: boolean
  selected: boolean
  selectionActive: boolean
  favorite: boolean
  actions: AssetCardAction[]
  onCardClick?: ((asset: CanvasAsset) => void) | undefined
  onToggleSelect?: ((asset: CanvasAsset) => void) | undefined
}) {
  const kind = readAssetKind(asset)
  return (
    <div
      className={`asset-library-card${selected ? ' is-selected' : ''}${selectionActive ? ' is-selecting' : ''}`}
      onClick={() => {
        if (selectionActive && onToggleSelect) onToggleSelect(asset)
        else onCardClick?.(asset)
      }}
    >
      <div className="asset-library-card-thumb">
        <AssetThumbnail asset={asset} />
        {generating ? (
          <span className="asset-library-card-generating" title="设定图生成中">
            <span className="asset-library-gen-spinner" aria-hidden />
            生成中
          </span>
        ) : null}
        {favorite ? <span className="asset-library-card-fav">★</span> : null}
        {selectionActive ? (
          <span
            className="asset-library-card-check"
            onClick={(event) => {
              event.stopPropagation()
              onToggleSelect?.(asset)
            }}
          >
            <Checkbox checked={selected} />
          </span>
        ) : null}
        {usage > 0 ? (
          <span className="asset-library-card-usage" title={`被 ${usage} 个节点引用`}>
            {usage} 引用
          </span>
        ) : null}
      </div>
      <div className="asset-library-card-meta">
        <div className="asset-library-card-title" title={asset.title ?? asset.id}>
          {asset.title ?? asset.id}
        </div>
        <div className="asset-library-card-sub">
          {kind ? (
            <>
              <span className={`asset-library-kind-dot kind-${kind}`} />
              <span className="asset-library-kind-label">{FILM_ASSET_KIND_LABELS[kind]}</span>
            </>
          ) : (
            <span className="asset-library-kind-label">{asset.type}</span>
          )}
        </div>
      </div>
      {actions.length > 0 ? (
        <div className="asset-library-card-actions" onClick={(event) => event.stopPropagation()}>
          {actions.map((action) => (
            <Tooltip key={action.key} title={action.label}>
              <Button
                className={`asset-library-card-action${action.danger ? ' is-danger' : ''}`}
                icon={action.icon}
                size="small"
                type="text"
                onClick={(event) => action.onClick(asset, event)}
              />
            </Tooltip>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const AssetCard = memo(AssetCardInner)

export function AssetGrid({
  items,
  loading = false,
  hasMore = false,
  onLoadMore,
  emptyText = '暂无资产',
  onCardClick,
  selectedIds,
  onToggleSelect,
  usageCounts,
  generatingIds,
  cardActions = [],
  isFavorite,
}: AssetGridProps) {
  if (!loading && items.length === 0) {
    return <Empty className="asset-library-empty" description={emptyText} />
  }
  const selectionActive = selectedIds != null && onToggleSelect != null
  return (
    <div className="asset-library-grid-wrap">
      <div className="asset-library-grid">
        {items.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            usage={usageCounts?.get(asset.id) ?? 0}
            generating={generatingIds?.has(asset.id) ?? false}
            selected={selectedIds?.has(asset.id) ?? false}
            selectionActive={selectionActive}
            favorite={isFavorite ? isFavorite(asset) : asset.metadata?.['favorite'] === true}
            actions={cardActions}
            onCardClick={onCardClick}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
      <div className="asset-library-grid-footer">
        {loading ? <Spin size="small" /> : null}
        {!loading && hasMore && onLoadMore ? (
          <Button className="asset-library-load-more" variant="outlined" onClick={onLoadMore}>
            加载更多
          </Button>
        ) : null}
      </div>
    </div>
  )
}
