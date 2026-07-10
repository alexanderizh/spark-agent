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
        <Icons.File size={variant === 'detail' ? 30 : 24} />
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
