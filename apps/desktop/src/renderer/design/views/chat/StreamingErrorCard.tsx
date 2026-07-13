import { useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Info,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { RuntimeEventOrigin } from '@spark/protocol'
import './StreamingErrorCard.css'

export interface StreamingErrorCardProps {
  code?: string
  title: string
  message: string
  level: 'info' | 'warning' | 'error'
  retryable: boolean
  actionHint?: string
  details?: Array<{ label: string; value: string }>
  origin?: RuntimeEventOrigin
  occurrenceCount?: number
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
  origin,
  occurrenceCount = 1,
  onRetry,
}: StreamingErrorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const StatusIcon = level === 'error' ? AlertCircle : level === 'warning' ? TriangleAlert : Info
  const sourceLabel = origin?.kind === 'subagent' ? `协作 Agent · ${origin.name}` : origin?.name
  const retryProgress = details.find((detail) => detail.label === '重试进度')?.value
  const httpStatus = details.find((detail) => detail.label === 'HTTP 状态')?.value
  const compactMeta = [
    sourceLabel,
    retryProgress != null ? `重试 ${retryProgress}` : undefined,
    httpStatus != null ? `HTTP ${httpStatus}` : undefined,
    occurrenceCount > 1 ? `累计 ${occurrenceCount} 次` : undefined,
  ].filter((value): value is string => value != null)

  return (
    <section
      className={`runtime-diagnostic-card is-${level}${expanded ? ' is-expanded' : ''}`}
      role="group"
      aria-label={`${title}${code != null ? ` (${code})` : ''}`}
    >
      <button
        type="button"
        className="runtime-diagnostic-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <StatusIcon className="runtime-diagnostic-status-icon" size={16} aria-hidden="true" />
        <span className="runtime-diagnostic-heading">
          <span className="runtime-diagnostic-title-row">
            <strong>{title}</strong>
            {compactMeta.map((item) => (
              <span className="runtime-diagnostic-meta" key={item}>
                {item}
              </span>
            ))}
          </span>
          {!expanded && <span className="runtime-diagnostic-preview">{message}</span>}
        </span>
        {code != null && code.length > 0 && <code>{code}</code>}
        {expanded ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="runtime-diagnostic-body">
          <p>{message}</p>
          {details.length > 0 && (
            <dl className="runtime-diagnostic-details">
              {details.map((detail, index) => (
                <div key={`${detail.label}:${detail.value}:${index}`}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {(actionHint != null || (retryable && onRetry != null)) && (
            <div className="runtime-diagnostic-actions">
              {actionHint != null && <span>{actionHint}</span>}
              {retryable && onRetry != null && (
                <button type="button" onClick={onRetry}>
                  <RefreshCw size={13} aria-hidden="true" />
                  重试
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
