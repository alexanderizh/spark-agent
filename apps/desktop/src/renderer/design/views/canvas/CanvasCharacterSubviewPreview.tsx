import { Icons } from '../../Icons'
import type { CanvasAsset } from './canvas.types'
import {
  characterSourceImageUrl,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'

export function CanvasCharacterSubviewPreview({
  asset,
  subview,
  alt,
  className = '',
}: {
  asset: CanvasAsset | null
  subview?: FilmCharacterSubview | null
  alt: string
  className?: string
}) {
  const src = characterSourceImageUrl(asset)
  if (!asset || !src) {
    return (
      <div className={`canvas-character-subview-fallback ${className}`.trim()}>
        <Icons.Image size={20} />
      </div>
    )
  }

  if (
    subview &&
    typeof asset.width === 'number' &&
    asset.width > 0 &&
    typeof asset.height === 'number' &&
    asset.height > 0
  ) {
    return (
      <svg
        className={`canvas-character-subview-svg ${className}`.trim()}
        viewBox={`${subview.cropPx.x} ${subview.cropPx.y} ${subview.cropPx.width} ${subview.cropPx.height}`}
        preserveAspectRatio="xMidYMid slice"
        aria-label={alt}
        role="img"
      >
        <image href={src} x="0" y="0" width={asset.width} height={asset.height} />
      </svg>
    )
  }

  return <img className={`canvas-character-subview-img ${className}`.trim()} src={src} alt={alt} />
}
