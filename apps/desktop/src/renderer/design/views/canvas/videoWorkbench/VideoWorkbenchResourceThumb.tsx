/**
 * VideoWorkbenchResourceThumb — 资源缩略图（视频/图片统一）。
 *
 * 为什么单独抽：
 *  - 视频资源 thumbnailUrl 多数缺失（本机导入 / 上游收集都不带），
 *    旧的 backgroundImage:url(video.mp4) 方案浏览器不会拿视频当背景图 → 视频卡全黑。
 *  - 这里对视频改用 <video muted preload="metadata">，浏览器自动渲染首帧，零 IPC、即时。
 *  - 图片走 <img>；thumbnailUrl 优先（视频也可能有关键帧缩略图）。
 *  - onLoadedMetadata 顺带回传 durationSec / width / height，供父级防抖回填到 draft。
 *
 * 复用点：资源面板卡片、轨道片段卡、资源选择器。
 */
import { memo } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '../../../Icons'

/** 缩略图渲染所需的最小资源字段（避免强依赖完整 WorkbenchResource） */
export interface ThumbnailSource {
  kind: 'video' | 'image'
  url: string
  thumbnailUrl?: string
}

export interface ThumbnailMeta {
  durationSec?: number
  width?: number
  height?: number
}

interface Props {
  resource: ThumbnailSource | undefined
  className?: string
  /** 视频元数据加载完成时回调（用于回填 draft） */
  onMeta?: ((meta: ThumbnailMeta) => void) | undefined
  /** 无预览时的回退图标尺寸 */
  fallbackSize?: number
}

function VideoWorkbenchResourceThumb({
  resource,
  className,
  onMeta,
  fallbackSize = 20,
}: Props): ReactElement {
  const cls = className ?? ''

  // 资源缺失或 url 为空 → 回退图标
  if (!resource || !resource.url) {
    return (
      <div className={`${cls} no-preview`}>
        <Icons.Film size={fallbackSize} />
      </div>
    )
  }

  // 视频优先用 thumbnailUrl（可能是已抽好的关键帧），否则用 <video> 渲染首帧
  if (resource.kind === 'video') {
    if (resource.thumbnailUrl) {
      return <img className={cls} src={resource.thumbnailUrl} alt="" />
    }
    // 加 #t=0.1 媒体片段：强制浏览器 seek 到首帧并渲染。
    // 不加的话 preload="metadata" 在 Chrome/Edge 下多数情况只解码元数据、画面保持黑屏。
    // duration 不受 fragment 影响，onLoadedMetadata 回填仍拿到完整时长。
    const videoSrc = resource.url.includes('#') ? resource.url : `${resource.url}#t=0.1`
    return (
      <video
        className={cls}
        src={videoSrc}
        muted
        preload="metadata"
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          const meta: ThumbnailMeta = {}
          if (Number.isFinite(v.duration) && v.duration > 0) meta.durationSec = v.duration
          if (v.videoWidth > 0) meta.width = v.videoWidth
          if (v.videoHeight > 0) meta.height = v.videoHeight
          if (meta.durationSec !== undefined || meta.width !== undefined) onMeta?.(meta)
        }}
      />
    )
  }

  // 图片：thumbnailUrl 优先，否则直接用 url 本身
  const imgSrc = resource.thumbnailUrl || resource.url
  return <img className={cls} src={imgSrc} alt="" />
}

export const ResourceThumb = memo(VideoWorkbenchResourceThumb)
