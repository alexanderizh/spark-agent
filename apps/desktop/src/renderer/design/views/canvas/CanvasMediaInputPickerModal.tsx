import { useEffect, useMemo, useState } from 'react'
import { Modal } from 'antd'
import { Button } from '@lobehub/ui'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset } from './canvas.types'

export type MediaInputPickerItem = {
  id: string
  label: string
  type: 'image' | 'video' | 'audio'
  asset: CanvasAsset | null
  previewUrl?: string | null
}

function MediaInputPickerThumb({ item }: { item: MediaInputPickerItem }) {
  if (item.asset) {
    return <AssetThumbnail asset={item.asset} />
  }
  if (item.type === 'audio') return <Icons.AudioLines size={24} />
  const previewUrl = item.previewUrl?.trim()
  if (previewUrl) {
    return (
      <img src={normalizeEduAssetUrl(previewUrl)} alt={item.label} />
    )
  }
  return item.type === 'video' ? <Icons.Play size={24} /> : <Icons.Image size={24} />
}

export function CanvasMediaInputPickerModal({
  open,
  title,
  items,
  selectedIds,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  items: MediaInputPickerItem[]
  selectedIds: string[]
  onCancel: () => void
  onConfirm: (nextIds: string[]) => void
}) {
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds)

  useEffect(() => {
    if (open) setDraftIds(selectedIds)
  }, [open, selectedIds])

  const selectedSet = useMemo(() => new Set(draftIds), [draftIds])
  const availableIdSet = useMemo(() => new Set(items.map((item) => item.id)), [items])

  const toggleItem = (id: string) => {
    setDraftIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id],
    )
  }

  return (
    <Modal
      open={open}
      title={title}
      width={720}
      centered
      destroyOnHidden
      className="canvas-media-input-picker-modal"
      onCancel={onCancel}
      footer={
        <div className="canvas-media-input-picker-footer">
          <span className="canvas-media-input-picker-count">
            已选 {draftIds.filter((id) => availableIdSet.has(id)).length} / {items.length}
          </span>
          <div className="canvas-media-input-picker-footer-actions">
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              onClick={() =>
                onConfirm(draftIds.filter((id) => availableIdSet.has(id)))
              }
            >
              确定
            </Button>
          </div>
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="canvas-media-input-picker-empty">暂无可选图片资源</div>
      ) : (
        <div className="canvas-media-input-picker-grid">
          {items.map((item) => {
            const active = selectedSet.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                className={`canvas-media-input-picker-item${active ? ' is-selected' : ''}`}
                aria-pressed={active}
                onClick={() => toggleItem(item.id)}
              >
                <div className="canvas-media-input-picker-thumb">
                  <MediaInputPickerThumb item={item} />
                  {item.type === 'video' ? (
                    <span className="canvas-media-input-picker-video-badge">
                      <Icons.Play size={12} />
                    </span>
                  ) : null}
                  {active ? (
                    <span className="canvas-media-input-picker-check">
                      <Icons.Check size={14} />
                    </span>
                  ) : null}
                </div>
                <span className="canvas-media-input-picker-label" title={item.label}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
