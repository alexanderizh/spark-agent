import { useState } from 'react'
import { Check, ChevronRight, CircleAlert, Cloud, LoaderCircle, Paperclip } from 'lucide-react'
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
  model_catalog: 'remoteAgent.call.action.models',
  sessions_list: 'remoteAgent.call.action.sessions',
  session_open: 'remoteAgent.call.action.open',
  session_model_set: 'remoteAgent.call.action.setModel',
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
  const [open, setOpen] = useState(false)
  const isRunning = block.status === 'pending' || block.status === 'running'
  const statusLabel = getStatusLabel(presentation, isRunning)
  const outputText = resolveOutputText(presentation, isRunning)
  const isRemoteActive =
    presentation.remoteStatus != null &&
    ['accepted', 'uncertain', 'submitting', 'queued', 'running', 'cancel_requested'].includes(
      presentation.remoteStatus,
    )
  const isActive = isRunning || isRemoteActive
  const isError = presentation.status === 'error'
  const attachmentCount =
    presentation.action === 'message_send' && Array.isArray(block.toolInput['attachmentRefs'])
      ? block.toolInput['attachmentRefs'].length
      : 0

  return (
    <div
      className={`tool-call${open ? ' open' : ''}${isActive ? ' is-pending' : ''}${!isActive && !isError ? ' is-success' : ''}${isError ? ' is-error' : ''}`}
      data-testid="remote-agent-tool-call"
    >
      <div
        className="tool-call-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={translate(ACTION_TRANSLATION[presentation.action])}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
          }
        }}
      >
        <Cloud className="tool-icon" aria-hidden="true" />
        <span className="tool-name">{translate(ACTION_TRANSLATION[presentation.action])}</span>
        <span className="tool-arg" title={presentation.requestText}>
          {presentation.requestText}
        </span>
        <span className="tool-call-actions">
          {isActive ? (
            <LoaderCircle className="tool-status spinner" size={12} />
          ) : isError ? (
            <CircleAlert className="tool-status err" size={12} />
          ) : (
            <Check className="tool-status ok" size={12} />
          )}
          <span className="tool-duration" role="status" aria-live="polite">
            {timestamp != null && inspector ? `${formatTime(timestamp)} · ` : ''}
            {statusLabel}
          </span>
          <ChevronRight className="chev" size={12} aria-hidden="true" />
        </span>
      </div>
      {isActive && (
        <div className="tool-call-progress-bar">
          <div className="tool-call-progress-fill" />
        </div>
      )}
      {open && (
        <div className="tool-call-body" data-testid="remote-agent-tool-call-details">
          <strong>{translate('remoteAgent.call.input')}</strong>
          <pre className="tool-output-pre">{presentation.requestText}</pre>
          {attachmentCount > 0 && (
            <div>
              <Paperclip size={12} aria-hidden="true" />{' '}
              {translate('remoteAgent.call.attachments', { count: attachmentCount })}
            </div>
          )}
          <strong>{translate('remoteAgent.call.output')}</strong>
          <pre className={`tool-output-pre${isError ? ' tool-error-span' : ''}`}>
            {outputText ||
              (isActive
                ? translate('remoteAgent.call.waiting')
                : translate('remoteAgent.call.noOutput'))}
          </pre>
        </div>
      )}
    </div>
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
