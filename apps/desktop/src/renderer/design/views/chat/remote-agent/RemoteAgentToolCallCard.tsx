import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, Cloud, LoaderCircle, Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'
import { translate, type TranslationKey } from '../../../i18n'
import { InspectorCollapsibleSection } from '../../../components/InspectorCollapsibleSection'
import {
  presentRemoteAgentToolCall,
  type RemoteAgentToolCallBlock,
  type RemoteAgentToolCallEntry,
  type RemoteAgentToolCallPresentation,
} from './remote-agent-tool-call'
import './remote-agent.less'

const ACTION_TRANSLATION: Record<RemoteAgentToolCallPresentation['action'], TranslationKey> = {
  devices_list: 'remoteAgent.call.action.devices',
  device_inspect: 'remoteAgent.call.action.inspect',
  sessions_list: 'remoteAgent.call.action.sessions',
  session_open: 'remoteAgent.call.action.open',
  message_send: 'remoteAgent.call.action.send',
  events_read: 'remoteAgent.call.action.read',
  operation_cancel: 'remoteAgent.call.action.cancel',
  artifact_transfer: 'remoteAgent.call.action.transfer',
  unknown: 'remoteAgent.call.action.generic',
}

export function RemoteAgentToolCallCard({
  block,
  timestamp,
  inspector = false,
}: {
  block: RemoteAgentToolCallBlock
  timestamp?: string
  inspector?: boolean
}) {
  const presentation = presentRemoteAgentToolCall(block)
  const [expanded, setExpanded] = useState(false)
  const isRunning = block.status === 'pending' || block.status === 'running'
  const statusLabel = getStatusLabel(presentation, isRunning)
  const outputText = resolveOutputText(presentation, isRunning)
  const canExpand = presentation.requestText.length > 200 || outputText.length > 220

  return (
    <section
      className={`remote-agent-call-card${inspector ? ' is-inspector' : ''} is-${presentation.status}`}
      aria-label={translate(ACTION_TRANSLATION[presentation.action])}
      data-testid="remote-agent-call-card"
    >
      <header className="remote-agent-call-card__head">
        <span className="remote-agent-call-card__icon" aria-hidden="true">
          <Cloud size={14} />
        </span>
        <strong>{translate(ACTION_TRANSLATION[presentation.action])}</strong>
        {timestamp != null && inspector && (
          <time dateTime={timestamp}>{formatTime(timestamp)}</time>
        )}
        <span className="remote-agent-call-card__status" role="status" aria-live="polite">
          {isRunning ? (
            <LoaderCircle className="remote-agent-call-card__spin" size={13} />
          ) : presentation.status === 'error' ? (
            <CircleAlert size={13} />
          ) : (
            <Check size={13} />
          )}
          {statusLabel}
        </span>
        {canExpand && (
          <button
            type="button"
            className="remote-agent-call-card__toggle"
            aria-label={
              expanded
                ? translate('remoteAgent.call.collapse')
                : translate('remoteAgent.call.expand')
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            title={
              expanded
                ? translate('remoteAgent.call.collapse')
                : translate('remoteAgent.call.expand')
            }
          >
            <ChevronDown size={14} />
          </button>
        )}
      </header>
      <div className={`remote-agent-call-card__body${expanded ? ' is-expanded' : ''}`}>
        <RemoteAgentCallSection label={translate('remoteAgent.call.input')}>
          <p>{presentation.requestText}</p>
          {presentation.action === 'message_send' &&
            Array.isArray(block.toolInput['attachmentRefs']) &&
            block.toolInput['attachmentRefs'].length > 0 && (
              <span className="remote-agent-call-card__attachment-count">
                <Paperclip size={11} />
                {translate('remoteAgent.call.attachments', {
                  count: block.toolInput['attachmentRefs'].length,
                })}
              </span>
            )}
        </RemoteAgentCallSection>
        <RemoteAgentCallSection label={translate('remoteAgent.call.output')}>
          {outputText.length > 0 ? (
            <p>{outputText}</p>
          ) : (
            <p className="is-muted">
              {isRunning
                ? translate('remoteAgent.call.waiting')
                : translate('remoteAgent.call.noOutput')}
            </p>
          )}
        </RemoteAgentCallSection>
      </div>
    </section>
  )
}

export function RemoteAgentInspectorSection({ entries }: { entries: RemoteAgentToolCallEntry[] }) {
  if (entries.length === 0) return null
  return (
    <InspectorCollapsibleSection
      className="remote-agent-inspector-section"
      title={translate('remoteAgent.call.inspectorTitle')}
      summary={<span className="inspector-count">{entries.length}</span>}
    >
      <div className="remote-agent-inspector-section__list">
        {entries.map((entry) => (
          <RemoteAgentToolCallCard
            key={entry.block.toolCallId}
            block={entry.block}
            {...(entry.timestamp != null ? { timestamp: entry.timestamp } : {})}
            inspector
          />
        ))}
      </div>
    </InspectorCollapsibleSection>
  )
}

function RemoteAgentCallSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="remote-agent-call-card__section">
      <span className="remote-agent-call-card__label">{label}</span>
      <div className="remote-agent-call-card__text">{children}</div>
    </div>
  )
}

function getStatusLabel(presentation: RemoteAgentToolCallPresentation, isRunning: boolean): string {
  if (presentation.status === 'error') return translate('remoteAgent.call.status.error')
  if (isRunning) return translate('remoteAgent.call.status.running')
  const remoteStatus = presentation.remoteStatus
  if (remoteStatus != null) {
    const key: Record<string, TranslationKey> = {
      accepted: 'remoteAgent.call.status.accepted',
      uncertain: 'remoteAgent.call.status.uncertain',
      submitting: 'remoteAgent.call.status.submitting',
      queued: 'remoteAgent.call.status.queued',
      running: 'remoteAgent.call.status.running',
      completed: 'remoteAgent.call.status.completed',
      failed: 'remoteAgent.call.status.failed',
      cancel_requested: 'remoteAgent.call.status.cancelRequested',
      cancelled: 'remoteAgent.call.status.cancelled',
    }
    const statusKey = key[remoteStatus]
    if (statusKey != null) return translate(statusKey)
  }
  return translate('remoteAgent.call.status.done')
}

function resolveOutputText(
  presentation: RemoteAgentToolCallPresentation,
  isRunning: boolean,
): string {
  if (presentation.outputText.length > 0) return presentation.outputText
  if (isRunning && presentation.action === 'message_send') {
    return translate('remoteAgent.call.waiting')
  }
  if (!isRunning && presentation.status === 'success') {
    return translate('remoteAgent.call.result.done')
  }
  return ''
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}
