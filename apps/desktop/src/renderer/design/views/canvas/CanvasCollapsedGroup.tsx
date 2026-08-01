import { useState } from 'react'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { CanvasInlineNodeTitleEditor } from './CanvasInlineNodeTitleEditor'
import {
  CANVAS_GROUP_COLOR_PRESETS,
  type CanvasCollapsedGroupPresentation,
  type CanvasGroupPreview,
} from './canvasGroupCollapse'
import type { CanvasGroupColorPreset } from './canvas.types'
import './CanvasCollapsedGroup.less'

const GROUP_COLOR_LABELS: Record<CanvasGroupColorPreset, string> = {
  blue: '蓝色',
  indigo: '靛蓝色',
  purple: '紫色',
  pink: '粉色',
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  cyan: '青色',
  gray: '灰色',
}

function CanvasCollapsedGroupInsert({
  preview,
  slot,
}: {
  preview: CanvasGroupPreview
  slot: number
}) {
  const [failed, setFailed] = useState(false)
  const showImage = preview.kind === 'image' && !failed

  return (
    <div
      className={`canvas-collapsed-group-insert is-slot-${slot}${showImage ? ' has-image' : ' is-fallback'}`}
    >
      {showImage ? (
        <img
          src={normalizeEduAssetUrl(preview.url)}
          alt={preview.title}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">
          <Icons.Image size={34} />
        </span>
      )}
    </div>
  )
}

export function CanvasCollapsedGroup({
  nodeId,
  title,
  presentation,
  onRename,
  onColorChange,
  onExpand,
}: {
  nodeId: string
  title: string | null | undefined
  presentation: CanvasCollapsedGroupPresentation
  onRename(title: string | null): Promise<void> | void
  onColorChange(color: CanvasGroupColorPreset): void
  onExpand(): void
}) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const displayTitle = title?.trim() || '编组'

  return (
    <div
      className="canvas-collapsed-group-cover"
      data-group-color={presentation.color}
      aria-label={`${displayTitle}，双击展开`}
    >
      <div className="canvas-collapsed-group-back" aria-hidden="true" />
      <div className="canvas-collapsed-group-inserts">
        {presentation.previews.map((preview, index) => (
          <CanvasCollapsedGroupInsert
            key={preview.kind === 'image' ? preview.nodeId : `fallback-${preview.slot}`}
            preview={preview}
            slot={index}
          />
        ))}
      </div>
      <svg
        className="canvas-collapsed-group-front"
        viewBox="0 0 420 360"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 0 148 C 0 126, 15 113, 41 113 L 154 113 C 183 113, 195 127, 217 134 C 239 140, 258 145, 290 145 L 379 145 C 406 145, 420 158, 420 179 L 420 322 C 420 347, 403 360, 372 360 L 48 360 C 17 360, 0 347, 0 322 Z" />
        <path
          className="canvas-collapsed-group-front-highlight"
          d="M 2 148 C 2 128, 17 115, 41 115 L 154 115 C 183 115, 195 129, 217 136 C 239 142, 258 147, 290 147 L 379 147"
        />
      </svg>
      <div className="canvas-collapsed-group-icons">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M7 3v18M17 3v18M3 8h18M3 16h18" />
        </svg>
        <button
          type="button"
          className="canvas-collapsed-group-expand-trigger nodrag nopan"
          aria-label="展开编组"
          title="展开编组"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onExpand()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M8 9h9M11 15h6" />
          </svg>
        </button>
      </div>
      <div
        className="canvas-collapsed-group-copy nodrag nopan"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <small>{presentation.childCount} 个节点</small>
        <CanvasInlineNodeTitleEditor
          nodeId={nodeId}
          title={title}
          fallbackTitle="编组"
          activation="doubleClick"
          onRename={onRename}
        />
      </div>
      <div
        className="canvas-collapsed-group-color-control nodrag nopan"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {paletteOpen ? (
          <div className="canvas-collapsed-group-color-palette" role="listbox" aria-label="文件夹颜色">
            {CANVAS_GROUP_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className={`canvas-collapsed-group-color-option${color === presentation.color ? ' is-active' : ''}`}
                data-color={color}
                aria-label={`切换为${GROUP_COLOR_LABELS[color]}`}
                aria-selected={color === presentation.color}
                role="option"
                onClick={() => {
                  onColorChange(color)
                  setPaletteOpen(false)
                }}
              />
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="canvas-collapsed-group-color-trigger"
          aria-label="更改文件夹颜色"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen((current) => !current)}
        >
          <span data-color={presentation.color} />
        </button>
      </div>
    </div>
  )
}
