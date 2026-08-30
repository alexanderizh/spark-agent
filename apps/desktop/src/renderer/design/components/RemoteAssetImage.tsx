import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes } from 'react'

type RemoteAssetImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | undefined
  retryLabel?: string
}

/**
 * Remote artwork loader shared by onboarding and Canvas prompt examples.
 * It preloads through Image(), fades in only after decode succeeds, and keeps
 * network failures local to the card with a retry action.
 */
export function RemoteAssetImage({
  src,
  alt = '',
  className = '',
  style,
  retryLabel = '重试',
  ...imgProps
}: RemoteAssetImageProps) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    if (!src) {
      setStatus('error')
      return () => {
        cancelled = true
      }
    }

    setStatus('loading')
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!cancelled) setStatus('loaded')
    }
    image.onerror = () => {
      if (!cancelled) setStatus('error')
    }
    image.src = src
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [src, attempt])

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  }

  if (status === 'error') {
    return (
      <div className={`remote-asset-image ${className}`.trim()} style={wrapperStyle} role="img" aria-label={alt}>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            minHeight: 64,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            boxSizing: 'border-box',
            color: 'var(--text-tertiary, #8c8c8c)',
            background: 'var(--surface-muted, rgba(127, 127, 127, 0.08))',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          <span>图片加载失败</span>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            style={{
              border: '1px solid currentColor',
              borderRadius: 999,
              padding: '2px 9px',
              color: 'inherit',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {retryLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`remote-asset-image ${className}`.trim()} style={wrapperStyle}>
      {status === 'loading' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(100deg, var(--surface-muted, rgba(127, 127, 127, 0.08)) 30%, rgba(255, 255, 255, 0.16) 50%, var(--surface-muted, rgba(127, 127, 127, 0.08)) 70%)',
            backgroundSize: '200% 100%',
            animation: 'spark-remote-asset-shimmer 1.35s ease-in-out infinite',
          }}
        />
      )}
      <img
        {...imgProps}
        src={src}
        alt={alt}
        className={className}
        draggable={imgProps.draggable ?? false}
        onLoad={(event) => {
          setStatus('loaded')
          imgProps.onLoad?.(event)
        }}
        onError={(event) => {
          setStatus('error')
          imgProps.onError?.(event)
        }}
        style={{
          ...style,
          opacity: status === 'loaded' ? 1 : 0,
          transition: 'opacity 180ms ease-out',
        }}
      />
    </div>
  )
}

export function preloadRemoteAsset(src: string | undefined): Promise<void> {
  if (!src) return Promise.resolve()
  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = src
  })
}
