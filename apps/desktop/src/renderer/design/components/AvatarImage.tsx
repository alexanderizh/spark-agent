import { useEffect, useState } from 'react'
import { getAvatarFallback } from '../avatar'

export interface AvatarImageProps {
  src: string
  seed: string
  name: string
  className?: string
  alt?: string
}

export function AvatarImage({ src, seed, name, className = '', alt = '' }: AvatarImageProps) {
  const [failed, setFailed] = useState(false)
  const fallback = getAvatarFallback(seed, name)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed || src.trim().length === 0) {
    return (
      <span
        className={`spark-avatar-fallback ${className}`}
        style={{ background: fallback.background }}
        aria-label={alt}
      />
    )
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
