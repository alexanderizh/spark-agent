import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../../Icons'
import './ApplicationSnapshotPreviewCard.less'

const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

export function ApplicationSnapshotPreviewCard({
  snapshotId,
  previewUrl,
  appName,
  windowTitle,
  capturedAt,
}: {
  snapshotId: string
  previewUrl: string
  appName: string
  windowTitle: string
  capturedAt: string
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [renewedPreview, setRenewedPreview] = useState<{
    snapshotId: string
    sourceUrl: string
    renewedUrl: string
  } | null>(null)
  const renewalAttempted = useRef<{ snapshotId: string; sourceUrl: string } | null>(null)
  const currentPreviewUrl =
    renewedPreview?.snapshotId === snapshotId && renewedPreview.sourceUrl === previewUrl
      ? renewedPreview.renewedUrl
      : previewUrl
  const displayTitle = windowTitle.trim() || appName

  const renewExpiredPreview = async (): Promise<void> => {
    if (
      renewalAttempted.current?.snapshotId === snapshotId &&
      renewalAttempted.current.sourceUrl === previewUrl
    ) {
      return
    }
    renewalAttempted.current = { snapshotId, sourceUrl: previewUrl }
    try {
      const result = await window.spark.invoke('app-snapshot:get', { id: snapshotId })
      const renewedUrl = result.snapshot?.previewUrl
      if (
        result.snapshot?.id === snapshotId &&
        renewedUrl != null &&
        renewedUrl !== currentPreviewUrl
      ) {
        setRenewedPreview({ snapshotId, sourceUrl: previewUrl, renewedUrl })
      }
    } catch {
      // Keep the failed preview visible as unavailable; renewal is deliberately single-shot.
    }
  }

  return (
    <>
      <figure data-snapshot-id={snapshotId} className="application-snapshot-card">
        <button
          type="button"
          className="application-snapshot-card-trigger"
          onClick={() => setPreviewOpen(true)}
          aria-label={`打开 ${displayTitle} 应用快照预览`}
        >
          <span className="application-snapshot-card-media">
            <img
              src={currentPreviewUrl}
              alt={`${appName} — ${windowTitle}`}
              onError={() => void renewExpiredPreview()}
              draggable={false}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <span className="application-snapshot-card-expand" aria-hidden="true">
              <Icons.Maximize size={14} />
            </span>
          </span>
          <span className="application-snapshot-card-caption">
            <span className="application-snapshot-card-title" title={displayTitle}>
              {displayTitle}
            </span>
            <span className="application-snapshot-card-kind" title={capturedAt}>
              应用快照
            </span>
          </span>
        </button>
      </figure>
      {previewOpen ? (
        <ApplicationSnapshotLightbox
          src={currentPreviewUrl}
          alt={`${appName} — ${windowTitle}`}
          title={displayTitle}
          onClose={() => setPreviewOpen(false)}
          onImageError={() => void renewExpiredPreview()}
        />
      ) : null}
    </>
  )
}

function ApplicationSnapshotLightbox({
  src,
  alt,
  title,
  onClose,
  onImageError,
}: {
  src: string
  alt: string
  title: string
  onClose: () => void
  onImageError: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      className="image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`预览应用快照 ${title}`}
      onClick={onClose}
    >
      <div
        className={`image-lightbox-topbar ${isPlatformDarwin ? 'platform-darwin-safe-area' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="image-lightbox-title" title={title}>
          {title}
        </span>
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-close"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭应用快照预览"
        >
          <Icons.X size={18} />
        </button>
      </div>
      <div className="image-lightbox-stage">
        <img
          src={src}
          alt={alt}
          className="image-lightbox-img"
          onClick={(event) => event.stopPropagation()}
          onError={onImageError}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  )
}
