import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { CanvasShotScriptTable } from './CanvasShotScriptTable'
import {
  CanvasAudioNodePresentation,
  type CanvasAudioNodePresentationHandle,
} from './audioNode/CanvasAudioNodePresentation'
import {
  isReadableCanvasOperationTextOutput,
  resolveCanvasTextOutputPresentation,
} from './canvasOperationOutputPresentation'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import {
  canDragCanvasAgentArtifact,
  createCanvasAgentArtifactPayload,
  writeCanvasAgentArtifactDrag,
} from './canvasAgentArtifactDrag'
import { CanvasVideoPlayer } from './videoPlayer/CanvasVideoPlayer'
import './CanvasOperationOutputPreview.less'

export type CanvasAudioPreviewActions = {
  onTrimApply?: (start: number, end: number) => Promise<void> | void
  onSpeedApply?: (factor: number) => Promise<void> | void
  onDownload?: () => void
  onPeaks?: (peaks: number[]) => void
}

function CanvasAgentArtifactDragSource({
  output,
  children,
}: {
  output: CanvasOperationOutputView
  children: ReactNode
}) {
  const payload = createCanvasAgentArtifactPayload(output)
  if (!canDragCanvasAgentArtifact(payload)) return <>{children}</>
  return (
    <div
      className="canvas-agent-artifact-drag-source nodrag"
      draggable
      title="拖入 Agent 对话"
      onDragStart={(event) => {
        event.stopPropagation()
        writeCanvasAgentArtifactDrag(event.dataTransfer, payload)
      }}
    >
      {children}
    </div>
  )
}

const IMAGE_PREVIEW_MIN_SCALE = 0.5
const IMAGE_PREVIEW_MAX_SCALE = 3
const IMAGE_PREVIEW_SCALE_STEP = 0.25

function clampImagePreviewScale(scale: number): number {
  return Math.min(IMAGE_PREVIEW_MAX_SCALE, Math.max(IMAGE_PREVIEW_MIN_SCALE, scale))
}

function CanvasOperationImagePreview({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    left: number
    top: number
  } | null>(null)

  const updateScale = (nextScale: number) => {
    const clamped = clampImagePreviewScale(nextScale)
    setScale(clamped)
    if (clamped <= 1) setOffset({ x: 0, y: 0 })
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    updateScale(scale + (event.deltaY < 0 ? 0.1 : -0.1))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scale <= 1 || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: offset.x,
      top: offset.y,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset({
      x: drag.left + event.clientX - drag.x,
      y: drag.top + event.clientY - drag.y,
    })
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="canvas-operation-output-image-preview is-detail nowheel">
      <div
        className={`canvas-operation-output-image-stage${scale > 1 ? ' is-pannable' : ''}`}
        aria-label="图片预览，可使用滚轮或工具栏缩放"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={() => updateScale(1)}
      >
        <img
          className="canvas-operation-output-media is-detail"
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
        />
      </div>
      <div className="canvas-operation-output-image-zoom" aria-label="图片缩放工具栏">
        <button
          type="button"
          aria-label="缩小图片"
          disabled={scale <= IMAGE_PREVIEW_MIN_SCALE}
          onClick={() => updateScale(scale - IMAGE_PREVIEW_SCALE_STEP)}
        >
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          aria-label="放大图片"
          disabled={scale >= IMAGE_PREVIEW_MAX_SCALE}
          onClick={() => updateScale(scale + IMAGE_PREVIEW_SCALE_STEP)}
        >
          +
        </button>
        <button type="button" className="is-fit" onClick={() => updateScale(1)}>
          适应
        </button>
      </div>
    </div>
  )
}

export function CanvasOperationOutputPreview({
  output,
  variant = 'card',
  isolateWheel = true,
  selected = false,
  audioActions,
  audioPresentationRef,
  onVideoMetadata,
  onVideoEdit,
}: {
  output: CanvasOperationOutputView
  variant?: 'card' | 'detail'
  /** 位于未选中的画布节点中时关闭，让滚轮继续交给画布。 */
  isolateWheel?: boolean
  /** 操作节点被选中时，音频预览复用资源节点的操作工具栏。 */
  selected?: boolean
  audioActions?: CanvasAudioPreviewActions
  audioPresentationRef?: Ref<CanvasAudioNodePresentationHandle>
  onVideoMetadata?: (dimensions: { width: number; height: number }) => void
  onVideoEdit?: () => void
}) {
  const normalizedUrl = output.url ? normalizeEduAssetUrl(output.url) : ''
  const normalizedThumbnail = output.thumbnailUrl
    ? normalizeEduAssetUrl(output.thumbnailUrl)
    : normalizedUrl
  const textPresentation = useMemo(
    () =>
      isReadableCanvasOperationTextOutput(output)
        ? resolveCanvasTextOutputPresentation(output.text)
        : null,
    [output],
  )

  if (output.type === 'image' && normalizedThumbnail) {
    if (variant === 'detail') {
      return (
        <CanvasAgentArtifactDragSource output={output}>
          <CanvasOperationImagePreview
            key={`${output.id}:${normalizedThumbnail}`}
            src={normalizedThumbnail}
            title={output.title}
          />
        </CanvasAgentArtifactDragSource>
      )
    }
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <img
          className={`canvas-operation-output-media is-${variant}`}
          src={normalizedThumbnail}
          alt={output.title}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </CanvasAgentArtifactDragSource>
    )
  }
  if (output.type === 'video' && normalizedUrl) {
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <CanvasVideoPlayer
          className={`canvas-operation-output-media is-${variant}`}
          src={normalizedUrl}
          onVideoMetadata={({ width, height }) => {
            if (width > 0 && height > 0) onVideoMetadata?.({ width, height })
          }}
          onDoubleClickEdit={onVideoEdit}
        />
      </CanvasAgentArtifactDragSource>
    )
  }
  if (output.type === 'audio' && normalizedUrl) {
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <div className={`canvas-operation-output-audio is-${variant}`}>
          <CanvasAudioNodePresentation
            ref={audioPresentationRef}
            src={normalizedUrl}
            fileName={output.title}
            durationSec={0}
            selected={selected && Boolean(output.nodeId)}
            actions={audioActions ?? {}}
          />
        </div>
      </CanvasAgentArtifactDragSource>
    )
  }
  if (textPresentation?.kind === 'storyboard') {
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <div className={`canvas-operation-output-storyboard is-${variant}`}>
          <CanvasShotScriptTable rows={textPresentation.rows} isolateWheel={isolateWheel} />
        </div>
      </CanvasAgentArtifactDragSource>
    )
  }
  if (textPresentation?.kind === 'json') {
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <pre
          className={`canvas-operation-output-json is-${variant}${isolateWheel ? ' nowheel' : ''}`}
        >
          {textPresentation.text}
        </pre>
      </CanvasAgentArtifactDragSource>
    )
  }
  if (textPresentation?.kind === 'text') {
    return (
      <CanvasAgentArtifactDragSource output={output}>
        <div
          className={`canvas-operation-output-text is-${variant}${isolateWheel ? ' nowheel' : ''}`}
        >
          {output.pipelineRole === 'character' ? (
            <Icons.User size={variant === 'detail' ? 26 : 20} />
          ) : output.pipelineRole === 'scene' ? (
            <Icons.Box size={variant === 'detail' ? 26 : 20} />
          ) : (
            <Icons.File size={variant === 'detail' ? 26 : 20} />
          )}
          <div className="md-surface">
            <MarkdownText content={textPresentation.text} />
          </div>
        </div>
      </CanvasAgentArtifactDragSource>
    )
  }

  return (
    <CanvasAgentArtifactDragSource output={output}>
      <div className={`canvas-operation-output-empty is-${variant}`}>
        {output.type === 'video' || output.type === 'audio' ? (
          <Icons.Play size={variant === 'detail' ? 38 : 30} />
        ) : output.type === 'image' ? (
          <Icons.Image size={variant === 'detail' ? 38 : 30} />
        ) : (
          <Icons.File size={variant === 'detail' ? 38 : 30} />
        )}
        <span>{output.title}</span>
      </div>
    </CanvasAgentArtifactDragSource>
  )
}

function outputRoleLabel(output: CanvasOperationOutputView): string {
  if (output.pipelineRole === 'character') return '角色'
  if (output.pipelineRole === 'scene') return '场景'
  if (output.pipelineRole === 'prop') return '道具'
  if (output.type === 'image') return '图片'
  if (output.type === 'video') return '视频'
  if (output.type === 'audio') return '音频'
  return '文本'
}

function outputSummary(output: CanvasOperationOutputView): string {
  return (output.text ?? '')
    .replace(/[`*_#>]/g, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/g, ' ')
    .trim()
}

function CollectionOutputIcon({ output }: { output: CanvasOperationOutputView }) {
  if (output.pipelineRole === 'character') return <Icons.User size={18} />
  if (output.pipelineRole === 'scene' || output.pipelineRole === 'prop') {
    return <Icons.Box size={18} />
  }
  if (output.type === 'image') return <Icons.Image size={18} />
  if (output.type === 'video' || output.type === 'audio') return <Icons.Play size={18} />
  return <Icons.File size={18} />
}

/** 集合型任务的节点内列表投影；只消费现有 outputs，不改变持久化数据格式。 */
export function CanvasOperationOutputList({
  outputs,
  isolateWheel = true,
  onExpandOutput,
  onDeleteOutput,
}: {
  outputs: CanvasOperationOutputView[]
  /** 位于未选中的画布节点中时关闭，让滚轮继续交给画布。 */
  isolateWheel?: boolean
  /** 节点内直接展开单个产物；未提供时隐藏该入口。 */
  onExpandOutput?: (output: CanvasOperationOutputView) => void
  /** 节点内直接删除单个产物；未提供时隐藏该入口。 */
  onDeleteOutput?: (output: CanvasOperationOutputView) => void
}) {
  const commonRole = outputs[0] ? outputRoleLabel(outputs[0]) : '产物'
  const sameRole = outputs.every((output) => outputRoleLabel(output) === commonRole)

  return (
    <div className={`canvas-operation-output-list${isolateWheel ? ' nowheel' : ''}`}>
      <div className="canvas-operation-output-list-heading">
        <span>产物列表</span>
        <strong>{sameRole ? `${outputs.length} 个${commonRole}` : `${outputs.length} 项`}</strong>
      </div>
      <div className="canvas-operation-output-list-items">
        {outputs.map((output, index) => {
          const summary = outputSummary(output)
          const normalizedThumbnail = output.thumbnailUrl
            ? normalizeEduAssetUrl(output.thumbnailUrl)
            : output.type === 'image' && output.url
              ? normalizeEduAssetUrl(output.url)
              : ''
          return (
            <article className="canvas-operation-output-list-item" key={output.id}>
              <div
                className="canvas-operation-output-list-icon"
                data-output-role={output.pipelineRole ?? output.type}
                aria-hidden="true"
              >
                {normalizedThumbnail ? (
                  <img src={normalizedThumbnail} alt="" loading="lazy" decoding="async" />
                ) : (
                  <CollectionOutputIcon output={output} />
                )}
              </div>
              <div className="canvas-operation-output-list-copy">
                <div className="canvas-operation-output-list-title">
                  <strong>{output.title || `产物 ${index + 1}`}</strong>
                  <span>{outputRoleLabel(output)}</span>
                </div>
                {summary ? <p title={summary}>{summary}</p> : <p>暂无文字说明</p>}
              </div>
              <div className="canvas-operation-output-list-actions nodrag nopan">
                {onExpandOutput ? (
                  <button
                    type="button"
                    className="canvas-operation-output-list-expand"
                    aria-label={`展开产物 ${output.title || index + 1}`}
                    title="展开产物"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onExpandOutput(output)
                    }}
                  >
                    <Icons.Layers size={13} />
                    <span>展开</span>
                  </button>
                ) : null}
                {onDeleteOutput ? (
                  <button
                    type="button"
                    className="canvas-operation-output-list-delete"
                    aria-label={`删除产物 ${output.title || index + 1}`}
                    title="删除产物"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onDeleteOutput(output)
                    }}
                  >
                    <Icons.Trash size={13} />
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
