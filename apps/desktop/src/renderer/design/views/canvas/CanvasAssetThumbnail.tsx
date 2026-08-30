import { useState } from 'react'
import { Icons } from '../../Icons'
import { normalizeEduAssetUrl } from '@spark/shared'
import type { CanvasAsset, CanvasAssetType } from './canvas.types'

/**
 * 资产缩略图（文档 §7.2）。
 *
 * - 图片：直接显示缩略图
 * - 视频：有 thumbnail 显示缩略图，否则显示 Play 占位图标
 * - 音频：显示 File 占位图标（无可用音频图标）
 * - 文本/Prompt/file：显示对应类型图标
 * 统一处理 url 缺失 / 加载失败（onError 回退），避免空白方块。
 */
export function AssetThumbnail({ asset }: { asset: CanvasAsset }) {
  const fallback = (
    <span className="canvas-asset-thumb-fallback">
      <span className="canvas-asset-thumb-icon">{assetTypeIcon(asset.type)}</span>
    </span>
  )

  // 仅图片/视频有可显示的缩略图 url；视频在无 thumbnail 时不直接把 video url 当 img src
  const showableUrl = (() => {
    if (asset.type === 'image') return asset.thumbnailUrl ?? asset.url ?? null
    if (asset.type === 'video') return asset.thumbnailUrl ?? null
    return null
  })()

  if (!showableUrl) return fallback

  return (
    <ThumbnailImgInner
      src={normalizeEduAssetUrl(showableUrl)}
      fallback={fallback}
      alt={asset.title ?? asset.type}
    />
  )
}

// 拆出来用 useState 处理加载失败（onError 回退到 fallback），避免顶层 hooks 顺序问题
function ThumbnailImgInner({
  src,
  fallback,
  alt,
}: {
  src: string
  fallback: React.ReactNode
  alt: string
}) {
  const [errored, setErrored] = useState(false)
  if (errored) return <>{fallback}</>
  return <img src={src} alt={alt} loading="lazy" onError={() => setErrored(true)} />
}

/** 各资产类型的占位图标 */
function assetTypeIcon(type: CanvasAssetType): React.ReactNode {
  switch (type) {
    case 'image':
      return <Icons.Image size={18} />
    case 'video':
      return <Icons.Play size={18} />
    case 'audio':
      return <Icons.File size={18} />
    case 'text':
      return <Icons.File size={18} />
    case 'prompt':
      return <Icons.Edit size={18} />
    case 'file':
      return <Icons.File size={18} />
    default:
      return <Icons.File size={18} />
  }
}
