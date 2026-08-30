import type { SdkIntegrityInstallProgress } from '@spark/protocol'
import './SdkInstallProgress.css'

export function formatSdkInstallBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function SdkInstallProgressView({
  progress,
  compact = false,
}: {
  progress: SdkIntegrityInstallProgress
  compact?: boolean
}) {
  const percent =
    progress.percent == null ? null : Math.max(0, Math.min(100, Math.round(progress.percent)))
  const byteLabel =
    progress.total > 0
      ? `${formatSdkInstallBytes(progress.downloaded)} / ${formatSdkInstallBytes(progress.total)}`
      : progress.downloaded > 0
        ? `已下载 ${formatSdkInstallBytes(progress.downloaded)}`
        : null
  const progressLabel = [percent == null ? null : `${percent}%`, byteLabel]
    .filter((value): value is string => value != null)
    .join(' · ')
  const active = progress.state !== 'done' && progress.state !== 'error'

  return (
    <div className={`sdk-install-progress${compact ? ' is-compact' : ''} is-${progress.state}`}>
      <div className="sdk-install-progress-head">
        <span>{progress.message}</span>
        {progressLabel.length > 0 && <strong>{progressLabel}</strong>}
      </div>
      <div
        className={`sdk-install-progress-track${percent == null && active ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={progress.message}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent != null ? { 'aria-valuenow': percent } : {})}
      >
        <div className="sdk-install-progress-fill" style={{ width: `${percent ?? 32}%` }} />
      </div>
    </div>
  )
}
