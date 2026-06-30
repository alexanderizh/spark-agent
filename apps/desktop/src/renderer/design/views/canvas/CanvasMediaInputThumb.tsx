import { Popover } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset } from './canvas.types'

/** 编辑弹窗内媒体输入缩略图：悬浮时用 Popover 预览大图，避免被弹窗 overflow 截断。 */
export function CanvasMediaInputThumb({
  asset,
  label,
  variant = 'composer',
  onRemove,
  removeDisabled,
}: {
  asset: CanvasAsset | null
  label?: string
  variant?: 'composer' | 'panel'
  onRemove?: () => void
  removeDisabled?: boolean
}) {
  const rootClass =
    variant === 'composer'
      ? 'canvas-operation-composer-asset'
      : 'canvas-operation-panel-input-card'

  const card = (
    <div className={rootClass}>
      <div
        className={
          variant === 'composer'
            ? 'canvas-operation-composer-asset-thumb'
            : 'canvas-operation-panel-input-thumb'
        }
      >
        {asset ? (
          <AssetThumbnail asset={asset} />
        ) : (
          <Icons.Image size={variant === 'composer' ? 22 : 20} />
        )}
      </div>
      {variant === 'panel' && label ? (
        <div className="canvas-operation-panel-input-name">{label}</div>
      ) : null}
      {onRemove ? (
        variant === 'composer' ? (
          <button
            type="button"
            aria-label="移除输入"
            disabled={removeDisabled === true}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <Icons.X size={11} />
          </button>
        ) : (
          <Button
            size="small"
            type="text"
            icon={<Icons.X size={12} />}
            aria-label="移除输入"
            {...(removeDisabled === true ? { disabled: true } : {})}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          />
        )
      ) : null}
    </div>
  )

  if (!asset) return card

  return (
    <Popover
      trigger="hover"
      mouseEnterDelay={0.14}
      mouseLeaveDelay={0.08}
      placement="top"
      arrow={false}
      overlayClassName="canvas-media-input-hover-preview-popover"
      getPopupContainer={() => document.body}
      content={
        <div className="canvas-media-input-hover-preview">
          <div className="canvas-media-input-hover-preview-media">
            <AssetThumbnail asset={asset} />
          </div>
          {label ? <div className="canvas-media-input-hover-preview-label">{label}</div> : null}
        </div>
      }
    >
      {card}
    </Popover>
  )
}
