import { useMemo } from 'react'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { CanvasShotScriptTable } from './CanvasShotScriptTable'
import {
  isReadableCanvasOperationTextOutput,
  resolveCanvasTextOutputPresentation,
} from './canvasOperationOutputPresentation'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import './CanvasOperationOutputPreview.less'

export function CanvasOperationOutputPreview({
  output,
  variant = 'card',
}: {
  output: CanvasOperationOutputView
  variant?: 'card' | 'detail'
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
      <video
        className={`canvas-operation-output-media is-${variant} nodrag nopan`}
        src={normalizedUrl}
        controls
        preload="metadata"
      />
    )
  }
  if (output.type === 'audio' && normalizedUrl) {
    return (
      <div className={`canvas-operation-output-audio is-${variant}`}>
        <Icons.Play size={variant === 'detail' ? 36 : 28} />
        <audio className="nodrag nopan" src={normalizedUrl} controls preload="metadata" />
      </div>
    )
  }
  if (textPresentation?.kind === 'storyboard') {
    return (
      <div className={`canvas-operation-output-storyboard is-${variant}`}>
        <CanvasShotScriptTable rows={textPresentation.rows} />
      </div>
    )
  }
  if (textPresentation?.kind === 'json') {
    return (
      <pre className={`canvas-operation-output-json is-${variant} nowheel`}>
        {textPresentation.text}
      </pre>
    )
  }
  if (textPresentation?.kind === 'text') {
    return (
      <div className={`canvas-operation-output-text is-${variant} nowheel`}>
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
export function CanvasOperationOutputList({ outputs }: { outputs: CanvasOperationOutputView[] }) {
  const commonRole = outputs[0] ? outputRoleLabel(outputs[0]) : '产物'
  const sameRole = outputs.every((output) => outputRoleLabel(output) === commonRole)

  return (
    <div className="canvas-operation-output-list nowheel">
      <div className="canvas-operation-output-list-heading">
        <span>提取结果</span>
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
            </article>
          )
        })}
      </div>
    </div>
  )
}
