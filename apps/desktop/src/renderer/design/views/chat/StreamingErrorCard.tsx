import { AlertCircle, Info, RefreshCw, TriangleAlert } from 'lucide-react'

export interface StreamingErrorCardProps {
  code?: string
  title: string
  message: string
  level: 'info' | 'warning' | 'error'
  retryable: boolean
  actionHint?: string
  details?: Array<{ label: string; value: string }>
  onRetry?: () => void
}

export function StreamingErrorCard({
  code,
  title,
  message,
  level,
  retryable,
  actionHint,
  details = [],
  onRetry,
}: StreamingErrorCardProps) {
  const StatusIcon = level === 'error' ? AlertCircle : level === 'warning' ? TriangleAlert : Info
  return (
    <section
      className={`streaming-error-card is-${level}`}
      role="group"
      aria-label={`${title}${code != null ? ` (${code})` : ''}`}
    >
      <div className="streaming-error-card-head">
        <StatusIcon size={15} aria-hidden="true" />
        <strong>{title}</strong>
        {code != null && code.length > 0 && <code>{code}</code>}
      </div>
      <p>{message}</p>
      {details.length > 0 && (
        <dl className="streaming-error-details">
          {details.map((detail, index) => (
            <div key={`${detail.label}:${detail.value}:${index}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(actionHint != null || (retryable && onRetry != null)) && (
        <div className="streaming-error-actions">
          {actionHint != null && <span>{actionHint}</span>}
          {retryable && onRetry != null && (
            <button type="button" onClick={onRetry}>
              <RefreshCw size={13} aria-hidden="true" />
              重试
            </button>
          )}
        </div>
      )}
    </section>
  )
}
