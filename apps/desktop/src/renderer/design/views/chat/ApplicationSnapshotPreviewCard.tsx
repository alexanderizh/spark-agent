import { useRef, useState } from 'react'

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
    <figure
      data-snapshot-id={snapshotId}
      style={{
        margin: 0,
        overflow: 'hidden',
        border: '1px solid var(--border-secondary, rgba(127,127,127,.24))',
        borderRadius: 12,
        background: 'var(--color-bg-container, rgba(127,127,127,.06))',
      }}
    >
      <img
        src={currentPreviewUrl}
        alt={`${appName} — ${windowTitle}`}
        onError={() => void renewExpiredPreview()}
        draggable={false}
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{ display: 'block', width: '100%', maxHeight: 520, objectFit: 'contain' }}
      />
      <figcaption
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 12px',
          fontSize: 12,
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <strong>{appName}</strong>
          {windowTitle ? ` · ${windowTitle}` : ''}
        </span>
        <span style={{ flexShrink: 0, opacity: 0.64 }} title={capturedAt}>
          应用快照
        </span>
      </figcaption>
    </figure>
  )
}
