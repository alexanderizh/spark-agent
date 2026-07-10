import { Popover } from 'antd'
import { Button } from '@lobehub/ui'
import type { CSSProperties } from 'react'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset } from './canvas.types'

/** 编辑弹窗内媒体输入缩略图：悬浮时用 Popover 预览大图，避免被弹窗 overflow 截断。 */

export type CanvasMediaInputRole =
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'input_video'

export type CanvasMediaInputUsageStatus = 'used' | 'unused' | 'overflow'

const ROLE_BADGE: Record<CanvasMediaInputRole, { label: string; bg: string; color: string }> = {
  first_frame: { label: '首帧', bg: '#1677ff', color: '#fff' },
  last_frame: { label: '尾帧', bg: '#722ed1', color: '#fff' },
  reference_image: { label: '参考图', bg: '#13c2c2', color: '#fff' },
  reference_video: { label: '参考视频', bg: '#52c41a', color: '#fff' },
  reference_audio: { label: '参考音频', bg: '#fa8c16', color: '#fff' },
  input_video: { label: '输入视频', bg: '#fa541c', color: '#fff' },
}

function CornerBadge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 2,
        left: 2,
        background: bg,
        color,
        fontSize: 10,
        lineHeight: '14px',
        padding: '0 4px',
        borderRadius: 3,
        pointerEvents: 'none',
        zIndex: 2,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  )
}

export function CanvasMediaInputThumb({
  asset,
  label,
  variant = 'composer',
  onRemove,
  removeDisabled,
  role,
  usageStatus = 'used',
}: {
  asset: CanvasAsset | null
  label?: string
  variant?: 'composer' | 'panel'
  onRemove?: () => void
  removeDisabled?: boolean
  /** 当前图片被分配的角色；不传则不显示角色徽章（向后兼容）。 */
  role?: CanvasMediaInputRole | undefined
  /** 当前图片的使用状态：used=已分配角色；unused=未被任何角色选中；overflow=超出模型声明上限但仍尝试传递。 */
  usageStatus?: CanvasMediaInputUsageStatus | undefined
}) {
  const rootClass =
    variant === 'composer'
      ? 'canvas-operation-composer-asset'
      : 'canvas-operation-panel-input-card'

  const badge = role ? ROLE_BADGE[role] : null
  const isUnused = usageStatus === 'unused'
  const isOverflow = usageStatus === 'overflow'

  const rootStyle: CSSProperties = { position: 'relative' }
  if (isOverflow) {
    rootStyle.borderColor = '#ff4d4f'
    rootStyle.boxShadow = '0 0 0 1px #ff4d4f'
  }

  const card = (
    <div className={rootClass} style={rootStyle}>
      <div
        className={
          variant === 'composer'
            ? 'canvas-operation-composer-asset-thumb'
            : 'canvas-operation-panel-input-thumb'
        }
        style={isUnused ? { opacity: 0.4, filter: 'grayscale(1)' } : undefined}
      >
        {asset ? (
          <AssetThumbnail asset={asset} />
        ) : (
          <Icons.Image size={variant === 'composer' ? 22 : 20} />
        )}
      </div>
      {badge ? (
        <div
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            background: badge.bg,
            color: badge.color,
            fontSize: 10,
            lineHeight: '14px',
            padding: '0 4px',
            borderRadius: 3,
            pointerEvents: 'none',
            zIndex: 2,
            whiteSpace: 'nowrap',
          }}
        >
          {badge.label}
        </div>
      ) : null}
      {isUnused ? <CornerBadge text="未使用" bg="rgba(0,0,0,0.6)" color="#fff" /> : null}
      {isOverflow ? <CornerBadge text="可能不支持" bg="#ff4d4f" color="#fff" /> : null}
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
            size="middle"
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
          {badge ? (
            <div style={{ marginTop: 4, fontSize: 12, color: badge.bg }}>
              角色：{badge.label}
              {isUnused ? '（未使用）' : ''}
              {isOverflow ? '（超出模型声明，仍会尝试传递）' : ''}
            </div>
          ) : null}
        </div>
      }
    >
      {card}
    </Popover>
  )
}
