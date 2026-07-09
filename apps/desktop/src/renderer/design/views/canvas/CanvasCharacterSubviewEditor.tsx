import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Modal, Segmented, Select } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasAsset } from './canvas.types'
import {
  CHARACTER_SUBVIEW_KIND_LABELS,
  characterSourceImageUrl,
  createCharacterSubviewDraft,
  type CharacterSubviewKind,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'
import { CanvasCharacterSubviewPreview } from './CanvasCharacterSubviewPreview'

type StageRect = { x: number; y: number; width: number; height: number }
type HandleId = 'nw' | 'ne' | 'se' | 'sw'
type ViewOffset = { x: number; y: number }
type EditorTool = 'crop' | 'pan'
type Interaction =
  | {
      kind: 'move'
      pointerId: number
      startX: number
      startY: number
      startRect: StageRect
    }
  | {
      kind: 'pan'
      pointerId: number
      startX: number
      startY: number
      startOffset: ViewOffset
    }
  | {
      kind: 'resize'
      pointerId: number
      handle: HandleId
      startX: number
      startY: number
      startRect: StageRect
    }
  | {
      kind: 'create'
      pointerId: number
      startX: number
      startY: number
    }

const HANDLE_IDS: HandleId[] = ['nw', 'ne', 'se', 'sw']
const MIN_STAGE_RECT_SIZE = 18
const MIN_CREATE_RECT_SIZE = 24

export function CanvasCharacterSubviewEditor({
  open,
  ownerAsset,
  sourceImageAsset,
  initialSubviews,
  onClose,
  onInsertSubview,
  onSave,
  zIndex = 1400,
}: {
  open: boolean
  ownerAsset: CanvasAsset | null
  sourceImageAsset: CanvasAsset | null
  initialSubviews: FilmCharacterSubview[]
  onClose: () => void
  onInsertSubview: (subview: FilmCharacterSubview) => Promise<void>
  onSave: (subviews: FilmCharacterSubview[]) => Promise<void>
  zIndex?: number
}) {
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<EditorTool>('crop')
  const [viewOffset, setViewOffset] = useState<ViewOffset>({ x: 0, y: 0 })
  const [subviews, setSubviews] = useState<FilmCharacterSubview[]>(initialSubviews)
  const [selectedId, setSelectedId] = useState<string | null>(initialSubviews[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [insertingSubviewId, setInsertingSubviewId] = useState<string | null>(null)
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [draftRect, setDraftRect] = useState<StageRect | null>(null)
  const initializedSessionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !stageElement) return
    const stage = stageElement
    if (!stage) return
    const update = () => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    }
    update()
    requestAnimationFrame(update)
    const timer = window.setTimeout(update, 60)
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [open, stageElement])

  const sourceUrl = characterSourceImageUrl(sourceImageAsset)
  useEffect(() => {
    if (!sourceUrl) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      setImageSize({
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0,
      })
    }
    image.onerror = () => {
      if (!cancelled) setImageSize(null)
    }
    image.src = sourceUrl
    return () => {
      cancelled = true
    }
  }, [sourceUrl])

  const editorSessionKey = open && ownerAsset ? `${ownerAsset.id}:${sourceImageAsset?.id ?? 'no-source'}` : null

  useEffect(() => {
    if (!editorSessionKey) {
      initializedSessionKeyRef.current = null
      return
    }
    if (initializedSessionKeyRef.current === editorSessionKey) return
    initializedSessionKeyRef.current = editorSessionKey
    setSubviews(initialSubviews)
    setSelectedId(initialSubviews[0]?.id ?? null)
    setZoom(1)
    setTool('crop')
    setViewOffset({ x: 0, y: 0 })
    setDraftRect(null)
    setInteraction(null)
  }, [editorSessionKey, initialSubviews])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setTool((current) => (current === 'crop' ? 'pan' : 'crop'))
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  const naturalSize = useMemo(() => {
    const width = sourceImageAsset?.width ?? imageSize?.width ?? null
    const height = sourceImageAsset?.height ?? imageSize?.height ?? null
    return width && height ? { width, height } : null
  }, [imageSize, sourceImageAsset?.height, sourceImageAsset?.width])

  const displayRect = useMemo(() => {
    if (!naturalSize || stageSize.width <= 0 || stageSize.height <= 0) return null
    const baseScale = Math.min(stageSize.width / naturalSize.width, stageSize.height / naturalSize.height)
    const scale = baseScale * zoom
    const width = naturalSize.width * scale
    const height = naturalSize.height * scale
    const offset = clampViewOffset(viewOffset, { width, height }, stageSize)
    return {
      x: (stageSize.width - width) / 2 + offset.x,
      y: (stageSize.height - height) / 2 + offset.y,
      width,
      height,
    }
  }, [naturalSize, stageSize.height, stageSize.width, viewOffset, zoom])

  useEffect(() => {
    if (!displayRect) return
    const clamped = clampViewOffset(viewOffset, displayRect, stageSize)
    if (clamped.x !== viewOffset.x || clamped.y !== viewOffset.y) {
      setViewOffset(clamped)
    }
  }, [displayRect, stageSize, viewOffset])

  const activeSelectedId =
    selectedId && subviews.some((item) => item.id === selectedId)
      ? selectedId
      : (subviews[0]?.id ?? null)
  const selectedSubview =
    subviews.find((item) => item.id === activeSelectedId) ?? subviews[0] ?? null
  const toolOptions = useMemo<Array<{ label: string; value: EditorTool }>>(
    () => [
      { label: '框选', value: 'crop' },
      { label: '拖图', value: 'pan' },
    ],
    [],
  )

  useEffect(() => {
    if (!interaction || !displayRect || !naturalSize) return
    const handlePointerMove = (event: PointerEvent) => {
      const point = stagePointFromClient(event.clientX, event.clientY, stageElement)
      if (interaction.kind === 'pan') {
        if (!point) return
        setViewOffset(
          clampViewOffset(
            {
              x: interaction.startOffset.x + point.x - interaction.startX,
              y: interaction.startOffset.y + point.y - interaction.startY,
            },
            displayRect,
            stageSize,
          ),
        )
        return
      }
      if (interaction.kind === 'create') {
        setDraftRect(createStageRectFromPoints(interaction.startX, interaction.startY, point, displayRect))
        return
      }
      const nextRect = updateInteractionRect(interaction, point, displayRect)
      if (!nextRect || !selectedSubview) return
      const nextCrop = stageRectToCrop(nextRect, displayRect, naturalSize)
      setSubviews((current) =>
        current.map((item) =>
          item.id === selectedSubview.id
            ? {
                ...item,
                cropPx: nextCrop,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      )
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return
      if (
        interaction.kind === 'create' &&
        draftRect &&
        sourceImageAsset &&
        draftRect.width >= MIN_CREATE_RECT_SIZE &&
        draftRect.height >= MIN_CREATE_RECT_SIZE
      ) {
        const crop = stageRectToCrop(draftRect, displayRect, naturalSize)
        const next = createCharacterSubviewDraft(sourceImageAsset.id, subviews.length, crop, {
          label: `视图 ${subviews.length + 1}`,
          kind: 'portrait',
        })
        setSubviews((current) => [...current, next])
        setSelectedId(next.id)
      }
      setDraftRect(null)
      setInteraction(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    displayRect,
    draftRect,
    interaction,
    naturalSize,
    selectedSubview,
    sourceImageAsset,
    stageElement,
    stageSize,
    subviews.length,
  ])

  if (!open || !ownerAsset) return null

  const handleDeleteSubview = () => {
    if (!selectedSubview) return
    const filtered = subviews
      .filter((item) => item.id !== selectedSubview.id)
      .map((item, index) => ({ ...item, order: index }))
    setSubviews(filtered)
    setSelectedId(filtered[0]?.id ?? null)
  }

  const handleMoveSubview = (direction: -1 | 1) => {
    if (!selectedSubview) return
    const index = subviews.findIndex((item) => item.id === selectedSubview.id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= subviews.length) return
    const next = [...subviews]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(nextIndex, 0, item)
    setSubviews(next.map((entry, order) => ({ ...entry, order })))
  }

  const updateSelectedSubview = (patch: Partial<FilmCharacterSubview>) => {
    if (!selectedSubview) return
    setSubviews((current) =>
      current.map((item) =>
        item.id === selectedSubview.id
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(subviews.map((item, index) => ({ ...item, order: index })))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleInsertSubview = async (subview: FilmCharacterSubview) => {
    setInsertingSubviewId(subview.id)
    try {
      await onInsertSubview(subview)
    } finally {
      setInsertingSubviewId((current) => (current === subview.id ? null : current))
    }
  }

  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const modalWidth = Math.min(1640, Math.max(360, viewportWidth - 32))
  const modalTop = Math.max(16, Math.min(76, Math.round(viewportHeight * 0.08)))
  const zoomPercent = Math.round(zoom * 100)

  return (
    <Modal
      open
      onCancel={onClose}
      width={modalWidth}
      zIndex={zIndex}
      className="canvas-character-subview-editor-modal"
      style={{ top: modalTop }}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          onClick={() => void handleSave()}
          disabled={!sourceImageAsset}
        >
          保存子视图
        </Button>,
      ]}
      title={
        <span className="canvas-character-subview-editor-title">
          <Icons.Crop size={16} />
          子视图编辑器
        </span>
      }
    >
      <div className="canvas-character-subview-editor">
        <div className="canvas-character-subview-stage-wrap">
          <div className="canvas-character-subview-stage-toolbar">
            <div>
              <strong>{ownerAsset.title ?? '图片'}</strong>
              <span>可先拖动画面找位置，再切回框选工具创建或微调子视图。</span>
            </div>
            <div className="canvas-character-subview-stage-toolbar-right">
              <div className="canvas-character-subview-stage-tip">
                {tool === 'pan'
                  ? '当前为拖图模式，可拖动画面位置。'
                  : selectedSubview
                    ? '拖动框体可移动，拖拽四角可微调大小。'
                    : '先在左侧图片上拖出一个框。'}
              </div>
              <Segmented<EditorTool>
                value={tool}
                size="middle"
                options={toolOptions}
                onChange={(value) => setTool(value)}
              />
              <div className="canvas-character-subview-zoom-controls">
                <Button
                  size="middle"
                  type="text"
                  disabled={!sourceImageAsset}
                  onClick={() => setZoom((current) => clampZoom(current - 0.15))}
                >
                  缩小
                </Button>
                <span>{zoomPercent}%</span>
                <Button
                  size="middle"
                  type="text"
                  disabled={!sourceImageAsset}
                  onClick={() => setZoom((current) => clampZoom(current + 0.15))}
                >
                  放大
                </Button>
                <Button
                  size="middle"
                  type="text"
                  disabled={!sourceImageAsset}
                  onClick={() => setZoom(1)}
                >
                  还原
                </Button>
              </div>
            </div>
          </div>
          <div
            ref={setStageElement}
            className={`canvas-character-subview-stage canvas-character-subview-stage-${tool}${sourceUrl && displayRect ? ' is-ready' : ''}${interaction?.kind === 'pan' ? ' is-panning' : ''}`}
            onWheel={(event) => {
              if (!sourceImageAsset) return
              event.preventDefault()
              const delta = event.deltaY < 0 ? 0.12 : -0.12
              setZoom((current) => clampZoom(current + delta))
            }}
            onPointerDown={(event) => {
              if (!displayRect || !sourceImageAsset) return
              const point = stagePointFromClient(event.clientX, event.clientY, stageElement)
              if (!point) return
              event.preventDefault()
              event.stopPropagation()
              if (tool === 'pan') {
                setInteraction({
                  kind: 'pan',
                  pointerId: event.pointerId,
                  startX: point.x,
                  startY: point.y,
                  startOffset: viewOffset,
                })
                return
              }
              if (!isPointInsideRect(point, displayRect)) return
              setSelectedId(null)
              setDraftRect(null)
              setInteraction({
                kind: 'create',
                pointerId: event.pointerId,
                startX: point.x,
                startY: point.y,
              })
            }}
          >
            {sourceUrl ? (
              displayRect ? (
                <>
                  <img
                    src={sourceUrl}
                    alt={ownerAsset.title ?? '图片参考图'}
                    className="canvas-character-subview-stage-image"
                    style={{
                      left: displayRect.x,
                      top: displayRect.y,
                      width: displayRect.width,
                      height: displayRect.height,
                    }}
                  />
                  <div className="canvas-character-subview-stage-overlay">
                    <span>{tool === 'pan' ? '拖动画面调整取景位置' : '拖拽框选要裁切的区域'}</span>
                  </div>
                  {subviews.map((subview) => {
                    if (!naturalSize) return null
                    const rect = cropToStageRect(subview.cropPx, displayRect, naturalSize)
                    const active = subview.id === selectedSubview?.id
                    return (
                      <button
                        key={subview.id}
                        type="button"
                        className={`canvas-character-subview-box${active ? ' is-active' : ''}`}
                        style={{
                          left: rect.x,
                          top: rect.y,
                          width: rect.width,
                          height: rect.height,
                        }}
                        onPointerDown={(event) => {
                          if (tool !== 'crop') return
                          event.preventDefault()
                          event.stopPropagation()
                          setSelectedId(subview.id)
                          const point = stagePointFromClient(event.clientX, event.clientY, stageElement)
                          if (!point) return
                          setInteraction({
                            kind: 'move',
                            pointerId: event.pointerId,
                            startX: point.x,
                            startY: point.y,
                            startRect: rect,
                          })
                        }}
                      >
                        <span className="canvas-character-subview-box-label">
                          {CHARACTER_SUBVIEW_KIND_LABELS[subview.kind]} · {subview.label}
                        </span>
                        {HANDLE_IDS.map((handle) => (
                          <span
                            key={handle}
                            className={`canvas-character-subview-handle handle-${handle}`}
                            onPointerDown={(event) => {
                              if (tool !== 'crop') return
                              event.preventDefault()
                              event.stopPropagation()
                              setSelectedId(subview.id)
                              const point = stagePointFromClient(
                                event.clientX,
                                event.clientY,
                                stageElement,
                              )
                              if (!point) return
                              setInteraction({
                                kind: 'resize',
                                handle,
                                pointerId: event.pointerId,
                                startX: point.x,
                                startY: point.y,
                                startRect: rect,
                              })
                            }}
                          />
                        ))}
                      </button>
                    )
                  })}
                  {draftRect ? (
                    <div
                      className={`canvas-character-subview-box is-draft${draftRect.width < MIN_CREATE_RECT_SIZE || draftRect.height < MIN_CREATE_RECT_SIZE ? ' is-too-small' : ''}`}
                      style={{
                        left: draftRect.x,
                        top: draftRect.y,
                        width: draftRect.width,
                        height: draftRect.height,
                      }}
                    >
                      <span className="canvas-character-subview-box-label">
                        {draftRect.width < MIN_CREATE_RECT_SIZE || draftRect.height < MIN_CREATE_RECT_SIZE
                          ? '继续拖大一点'
                          : '松手创建子视图'}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="canvas-character-subview-stage-empty">正在加载角色参考图…</div>
              )
            ) : (
              <div className="canvas-character-subview-stage-empty">当前角色没有可用参考图</div>
            )}
          </div>
        </div>

        <aside className="canvas-character-subview-side">
          <div className="canvas-character-subview-side-preview">
            <CanvasCharacterSubviewPreview
              asset={sourceImageAsset}
              subview={selectedSubview}
              alt={selectedSubview?.label ?? ownerAsset.title ?? '图片视图'}
            />
          </div>

          <div className="canvas-character-subview-side-fields">
            <label className="canvas-character-subview-field">
              <span>视图名称</span>
              <Input
                value={selectedSubview?.label ?? ''}
                placeholder="例如：脸部特写 / 站姿全身"
                disabled={!selectedSubview}
                onChange={(event) => updateSelectedSubview({ label: event.target.value })}
              />
            </label>
            <label className="canvas-character-subview-field">
              <span>视图类型</span>
              <Select<CharacterSubviewKind>
                value={selectedSubview?.kind ?? null}
                disabled={!selectedSubview}
                options={Object.entries(CHARACTER_SUBVIEW_KIND_LABELS).map(([value, label]) => ({
                  label,
                  value: value as CharacterSubviewKind,
                }))}
                onChange={(value) => updateSelectedSubview({ kind: value })}
              />
            </label>

            {selectedSubview ? (
              <div className="canvas-character-subview-meta">
                <span>
                  区域：{Math.round(selectedSubview.cropPx.width)} ×{' '}
                  {Math.round(selectedSubview.cropPx.height)}
                </span>
                <span>
                  位置：({Math.round(selectedSubview.cropPx.x)}, {Math.round(selectedSubview.cropPx.y)})
                </span>
                <span>顺序只影响角色库中的展示次序，不影响裁切结果。</span>
              </div>
            ) : (
              <div className="canvas-character-subview-meta">
                <span>还没有选中子视图。</span>
                <span>请先在左侧原图上拖拽画出要保留的区域。</span>
              </div>
            )}

            <div className="canvas-character-subview-actions">
              <Button
                size="middle"
                type="primary"
                onClick={() => selectedSubview && void handleInsertSubview(selectedSubview)}
                disabled={!selectedSubview}
                loading={selectedSubview ? insertingSubviewId === selectedSubview.id : false}
              >
                插入画布
              </Button>
              <Button size="middle" onClick={() => handleMoveSubview(-1)} disabled={!selectedSubview}>
                上移
              </Button>
              <Button size="middle" onClick={() => handleMoveSubview(1)} disabled={!selectedSubview}>
                下移
              </Button>
              <Button size="middle" danger onClick={handleDeleteSubview} disabled={!selectedSubview}>
                删除
              </Button>
            </div>
          </div>

          <div className="canvas-character-subview-list">
            {subviews.length === 0 ? (
              <div className="canvas-character-subview-list-empty">
                还没有子视图，先在左侧图片上拖一个框。
              </div>
            ) : (
              subviews.map((subview) => (
                <button
                  key={subview.id}
                  type="button"
                  className={`canvas-character-subview-list-item${subview.id === selectedSubview?.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(subview.id)}
                >
                  <div className="canvas-character-subview-list-item-main">
                    <strong>{subview.label}</strong>
                    <span>{CHARACTER_SUBVIEW_KIND_LABELS[subview.kind]}</span>
                  </div>
                  <div className="canvas-character-subview-list-item-actions">
                    <span className="canvas-character-subview-list-index">#{subview.order + 1}</span>
                    <Button
                      size="middle"
                      type="text"
                      loading={insertingSubviewId === subview.id}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void handleInsertSubview(subview)
                      }}
                    >
                      插入画布
                    </Button>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
    </Modal>
  )
}

function stagePointFromClient(
  clientX: number,
  clientY: number,
  stage: HTMLDivElement | null,
): { x: number; y: number } | null {
  if (!stage) return null
  const rect = stage.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function cropToStageRect(
  crop: FilmCharacterSubview['cropPx'],
  displayRect: StageRect,
  naturalSize: { width: number; height: number },
): StageRect {
  return {
    x: displayRect.x + (crop.x / naturalSize.width) * displayRect.width,
    y: displayRect.y + (crop.y / naturalSize.height) * displayRect.height,
    width: (crop.width / naturalSize.width) * displayRect.width,
    height: (crop.height / naturalSize.height) * displayRect.height,
  }
}

function stageRectToCrop(
  rect: StageRect,
  displayRect: StageRect,
  naturalSize: { width: number; height: number },
): FilmCharacterSubview['cropPx'] {
  const x = ((rect.x - displayRect.x) / displayRect.width) * naturalSize.width
  const y = ((rect.y - displayRect.y) / displayRect.height) * naturalSize.height
  const width = (rect.width / displayRect.width) * naturalSize.width
  const height = (rect.height / displayRect.height) * naturalSize.height
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function clampStageRect(rect: StageRect, bounds: StageRect): StageRect {
  const width = Math.min(Math.max(rect.width, MIN_STAGE_RECT_SIZE), bounds.width)
  const height = Math.min(Math.max(rect.height, MIN_STAGE_RECT_SIZE), bounds.height)
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width)
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height)
  return { x, y, width, height }
}

function clampPointToRect(
  point: { x: number; y: number },
  bounds: StageRect,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.width),
    y: Math.min(Math.max(point.y, bounds.y), bounds.y + bounds.height),
  }
}

function createStageRectFromPoints(
  startX: number,
  startY: number,
  point: { x: number; y: number } | null,
  bounds: StageRect,
): StageRect | null {
  if (!point) return null
  const start = clampPointToRect({ x: startX, y: startY }, bounds)
  const end = clampPointToRect(point, bounds)
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  }
}

function isPointInsideRect(point: { x: number; y: number }, rect: StageRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}

function updateInteractionRect(
  interaction: Extract<Interaction, { kind: 'move' | 'resize' }>,
  point: { x: number; y: number } | null,
  bounds: StageRect,
): StageRect | null {
  if (!point) return null
  const dx = point.x - interaction.startX
  const dy = point.y - interaction.startY
  if (interaction.kind === 'move') {
    return clampStageRect(
      {
        x: interaction.startRect.x + dx,
        y: interaction.startRect.y + dy,
        width: interaction.startRect.width,
        height: interaction.startRect.height,
      },
      bounds,
    )
  }
  const next = { ...interaction.startRect }
  if (interaction.handle === 'nw' || interaction.handle === 'sw') {
    next.x += dx
    next.width -= dx
  }
  if (interaction.handle === 'ne' || interaction.handle === 'se') {
    next.width += dx
  }
  if (interaction.handle === 'nw' || interaction.handle === 'ne') {
    next.y += dy
    next.height -= dy
  }
  if (interaction.handle === 'sw' || interaction.handle === 'se') {
    next.height += dy
  }
  return clampStageRect(next, bounds)
}

function clampViewOffset(
  offset: ViewOffset,
  imageRect: { width: number; height: number },
  stageSize: { width: number; height: number },
): ViewOffset {
  const maxX =
    imageRect.width >= stageSize.width
      ? Math.max(0, (imageRect.width - stageSize.width) / 2) + 24
      : Math.max(0, (stageSize.width - imageRect.width) / 2)
  const maxY =
    imageRect.height >= stageSize.height
      ? Math.max(0, (imageRect.height - stageSize.height) / 2) + 24
      : Math.max(0, (stageSize.height - imageRect.height) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
}

function clampZoom(value: number): number {
  return Math.min(3, Math.max(0.6, Number(value.toFixed(2))))
}
