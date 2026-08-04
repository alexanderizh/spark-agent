import { useMemo, useState } from 'react'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { encodeToSafeFileUrl } from './canvas-safe-file'
import './CanvasNodeMediaPreview.less'

export type CanvasNodeMediaType = 'image' | 'video'

export function resolveCanvasNodeMediaUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(?:data:|https?:|blob:|safe-file:)/i.test(trimmed)) {
    return /^(?:data:|blob:|safe-file:)/i.test(trimmed) ? trimmed : normalizeEduAssetUrl(trimmed)
  }
  if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(trimmed)) return encodeToSafeFileUrl(trimmed)
  return ''
}

export function CanvasNodeMediaPreview({
  type,
  url,
}: {
  type: CanvasNodeMediaType
  url: string
}) {
  const previewUrl = useMemo(() => resolveCanvasNodeMediaUrl(url), [url])
  const [loadedUrl, setLoadedUrl] = useState('')
  const [failedUrl, setFailedUrl] = useState('')
  const isLoaded = Boolean(previewUrl) && loadedUrl === previewUrl
  const isFailed = Boolean(previewUrl) && failedUrl === previewUrl
  const mediaLabel = type === 'image' ? '图片' : '视频'

  if (!previewUrl) {
    return (
      <div className="canvas-node-media-preview" data-media-state="empty">
        <div className="canvas-node-media-preview-viewport is-empty">
          {type === 'image' ? <Icons.Image size={34} /> : <Icons.Play size={34} />}
          <span>输入{mediaLabel} URL 后即可预览</span>
        </div>
      </div>
    )
  }

  if (isFailed) {
    return (
      <div className="canvas-node-media-preview" data-media-state="error">
        <div className="canvas-node-media-preview-viewport is-error" role="alert">
          {type === 'image' ? <Icons.Image size={34} /> : <Icons.Play size={34} />}
          <span>{mediaLabel}加载失败，请检查 URL 或资源是否可访问</span>
        </div>
      </div>
    )
  }

  const mediaClassName = `canvas-node-media-preview-media is-${type}`
  const handleLoaded = () => setLoadedUrl(previewUrl)
  const handleError = () => setFailedUrl(previewUrl)

  return (
    <div className="canvas-node-media-preview" data-media-state={isLoaded ? 'ready' : 'loading'}>
      <div className="canvas-node-media-preview-viewport">
        {!isLoaded ? (
          <span className="canvas-node-media-preview-loading" role="status">
            正在加载{mediaLabel}…
          </span>
        ) : null}
        {type === 'image' ? (
          <img
            key={previewUrl}
            className={mediaClassName}
            src={previewUrl}
            alt={`${mediaLabel}预览`}
            loading="lazy"
            decoding="async"
            onLoad={handleLoaded}
            onError={handleError}
          />
        ) : (
          <video
            key={previewUrl}
            className={`${mediaClassName} nodrag nopan`}
            src={previewUrl}
            controls
            controlsList="noremoteplayback"
            disablePictureInPicture
            playsInline
            preload="metadata"
            onLoadedData={handleLoaded}
            onError={handleError}
          />
        )}
      </div>
    </div>
  )
}
