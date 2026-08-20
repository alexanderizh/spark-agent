import { useMemo, type Ref } from 'react'
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
import { CanvasVideoPlayer } from './videoPlayer/CanvasVideoPlayer'
import './CanvasOperationOutputPreview.less'

export type CanvasAudioPreviewActions = {
  onTrimApply?: (start: number, end: number) => Promise<void> | void
  onSpeedApply?: (factor: number) => Promise<void> | void
  onDownload?: () => void
  onPeaks?: (peaks: number[]) => void
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
    return (
      <img
        className={`canvas-operation-output-media is-${variant}`}
        src={normalizedThumbnail}
        alt={output.title}
        loading="lazy"
        decoding="async"
      />
    )
  }
  if (output.type === 'video' && normalizedUrl) {
    return (
      <CanvasVideoPlayer
        className={`canvas-operation-output-media is-${variant}`}
        src={normalizedUrl}
        onVideoMetadata={({ width, height }) => {
          if (width > 0 && height > 0) onVideoMetadata?.({ width, height })
        }}
        onDoubleClickEdit={onVideoEdit}
      />
    )
  }
  if (output.type === 'audio' && normalizedUrl) {
    return (
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
    )
  }
  if (textPresentation?.kind === 'storyboard') {
    return (
      <div className={`canvas-operation-output-storyboard is-${variant}`}>
        <CanvasShotScriptTable rows={textPresentation.rows} isolateWheel={isolateWheel} />
      </div>
    )
  }
  if (textPresentation?.kind === 'json') {
    return (
      <pre
        className={`canvas-operation-output-json is-${variant}${isolateWheel ? ' nowheel' : ''}`}
      >
        {textPresentation.text}
      </pre>
    )
  }
  if (textPresentation?.kind === 'text') {
    return (
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
    )
  }

  return (
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
}: {
  outputs: CanvasOperationOutputView[]
  /** 位于未选中的画布节点中时关闭，让滚轮继续交给画布。 */
  isolateWheel?: boolean
  /** 节点内直接展开单个产物；未提供时隐藏该入口。 */
  onExpandOutput?: (output: CanvasOperationOutputView) => void
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
              {onExpandOutput ? (
                <button
                  type="button"
                  className="canvas-operation-output-list-expand nodrag nopan"
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
            </article>
          )
        })}
      </div>
    </div>
  )
}
