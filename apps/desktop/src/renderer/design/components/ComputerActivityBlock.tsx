import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ComputerSession,
  ComputerUseEvent,
  NativeWindowDescriptor,
  SessionId,
} from '@spark/protocol'
import { useI18n } from '../i18n'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
} from './computer-activity-timeline'
import './ComputerActivityBlock.less'

const PAGE_SIZE = 500

type ComputerActivityContextValue = {
  events: ComputerUseEvent[]
  sessions: ComputerSession[]
  loadError: string | null
}

const ComputerActivityContext = createContext<ComputerActivityContextValue | null>(null)

export function ComputerActivityProvider({
  sessionId,
  children,
}: {
  sessionId: SessionId
  children: ReactNode
}) {
  return (
    <ComputerActivitySessionProvider key={sessionId} sessionId={sessionId}>
      {children}
    </ComputerActivitySessionProvider>
  )
}

function ComputerActivitySessionProvider({
  sessionId,
  children,
}: {
  sessionId: SessionId
  children: ReactNode
}) {
  const [events, setEvents] = useState<ComputerUseEvent[]>([])
  const [sessions, setSessions] = useState<ComputerSession[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    let canceled = false

    const unsubscribe = window.spark.on('stream:computer-use:activity-event', (event) => {
      if (event.sessionId !== sessionId) return
      setEvents((current) => mergeComputerActivityEvents(current, [event]))
    })

    void loadSessionActivity(sessionId)
      .then((loaded) => {
        if (!canceled) {
          setSessions(loaded.sessions)
          setEvents((current) => mergeComputerActivityEvents(loaded.events, current))
        }
      })
      .catch((error: unknown) => {
        if (!canceled)
          setLoadError(error instanceof Error ? error.message : t('computerActivity.loadFailed'))
      })

    return () => {
      canceled = true
      unsubscribe()
    }
  }, [sessionId, t])

  const value = useMemo(() => ({ events, sessions, loadError }), [events, sessions, loadError])
  return (
    <ComputerActivityContext.Provider value={value}>{children}</ComputerActivityContext.Provider>
  )
}

export function ComputerActivityBlock({ turnId }: { turnId?: string }) {
  const activity = useContext(ComputerActivityContext)
  const { lang, t } = useI18n()
  const timelines = useMemo(
    () =>
      groupComputerActivityEvents(activity?.events ?? []).filter(
        (timeline) => turnId == null || timeline.events.some((event) => event.turnId === turnId),
      ),
    [activity?.events, turnId],
  )
  const loadError = activity?.loadError ?? null
  if (timelines.length === 0 && loadError == null) return null

  return (
    <section className="computer-activity-list" aria-label={t('computerActivity.ariaLabel')}>
      {loadError != null && <div className="computer-activity-load-error">{loadError}</div>}
      {timelines.map((timeline) => (
        <ComputerActivityCard
          key={timeline.computerSessionId}
          computerSessionId={timeline.computerSessionId}
          session={
            activity?.sessions.find((item) => item.id === timeline.computerSessionId) ?? null
          }
          events={timeline.events}
          lang={lang}
          t={t}
        />
      ))}
    </section>
  )
}

async function loadSessionActivity(
  sessionId: SessionId,
): Promise<{ sessions: ComputerSession[]; events: ComputerUseEvent[] }> {
  const { computerSessions } = await window.spark.invoke('computer-use:list-sessions', {
    sessionId,
    limit: 100,
  })
  const pages = await Promise.all(computerSessions.map((session) => loadTimeline(session.id)))
  return { sessions: computerSessions, events: pages.flat() }
}

async function loadTimeline(computerSessionId: string): Promise<ComputerUseEvent[]> {
  const events: ComputerUseEvent[] = []
  let afterSeq: number | undefined
  for (;;) {
    const response = await window.spark.invoke('computer-use:get-timeline', {
      computerSessionId,
      ...(afterSeq == null ? {} : { afterSeq }),
      limit: PAGE_SIZE,
    })
    events.push(...response.events)
    if (response.events.length < PAGE_SIZE || response.nextSeq == null) return events
    afterSeq = response.nextSeq
  }
}

function ComputerActivityCard({
  computerSessionId,
  session,
  events,
  lang,
  t,
}: {
  computerSessionId: string
  session: ComputerSession | null
  events: ComputerUseEvent[]
  lang: 'zh' | 'en'
  t: Translate
}) {
  const latest = events.at(-1)
  const terminal = isTerminalComputerActivityEvent(latest)
  const status = activityStatus(latest, t)
  const visibleEvents = events.filter((event) => event.type !== 'computer_observation_created')
  const elapsed = elapsedLabel(events, t)
  const [controlStatus, setControlStatus] = useState(session?.status ?? null)
  const [windows, setWindows] = useState<NativeWindowDescriptor[] | null>(null)
  const [selectedWindowId, setSelectedWindowId] = useState('')
  const [controlError, setControlError] = useState<string | null>(null)
  const [controlBusy, setControlBusy] = useState(false)

  useEffect(() => setControlStatus(session?.status ?? null), [session?.status])

  const control = async (action: 'pause' | 'takeover' | 'stop'): Promise<void> => {
    setControlBusy(true)
    setControlError(null)
    try {
      const response =
        action === 'pause'
          ? await window.spark.invoke('computer-use:pause', { computerSessionId })
          : action === 'takeover'
            ? await window.spark.invoke('computer-use:takeover', { computerSessionId })
            : await window.spark.invoke('computer-use:stop', { computerSessionId })
      setControlStatus(response.computerSession.status)
      if (action !== 'pause') setWindows(null)
    } catch (error) {
      setControlError(error instanceof Error ? error.message : t('computerActivity.control.failed'))
    } finally {
      setControlBusy(false)
    }
  }

  const openTargetPicker = async (): Promise<void> => {
    setControlBusy(true)
    setControlError(null)
    try {
      const response = await window.spark.invoke('computer-use:list-windows', {})
      const visible = response.windows.filter((window) => !window.minimized)
      setWindows(visible)
      setSelectedWindowId(visible[0]?.window.id ?? '')
    } catch (error) {
      setControlError(error instanceof Error ? error.message : t('computerActivity.control.failed'))
    } finally {
      setControlBusy(false)
    }
  }

  const bindTarget = async (): Promise<void> => {
    if (selectedWindowId === '') return
    setControlBusy(true)
    setControlError(null)
    try {
      await window.spark.invoke('computer-use:bind-target', {
        computerSessionId,
        targetWindowId: selectedWindowId,
      })
      setWindows(null)
    } catch (error) {
      setControlError(error instanceof Error ? error.message : t('computerActivity.control.failed'))
    } finally {
      setControlBusy(false)
    }
  }

  return (
    <details className={`computer-activity-card is-${status.kind}`} open={!terminal}>
      <summary>
        <span className="computer-activity-status-dot" aria-hidden="true" />
        <span className="computer-activity-title">{t('computerActivity.title')}</span>
        <span className="computer-activity-status">{status.label}</span>
        {elapsed != null && <span className="computer-activity-elapsed">{elapsed}</span>}
      </summary>
      <ol className="computer-activity-events">
        {visibleEvents.map((event) => (
          <li key={`${computerSessionId}:${event.seq}`} className={eventClassName(event)}>
            <span>{eventLabel(event, t)}</span>
            <time>{formatTime(event.timestamp, lang)}</time>
          </li>
        ))}
      </ol>
      {session != null && !terminal && (
        <div className="computer-activity-controls">
          <span className="computer-activity-target">
            {t('computerActivity.control.target', {
              target: t('computerActivity.control.allApplications'),
            })}
          </span>
          <div className="computer-activity-control-actions">
            {controlStatus !== 'paused' && (
              <button type="button" disabled={controlBusy} onClick={() => void control('pause')}>
                {t('computerActivity.control.pause')}
              </button>
            )}
            {controlStatus === 'paused' && (
              <button type="button" disabled={controlBusy} onClick={() => void openTargetPicker()}>
                {t('computerActivity.control.changeTarget')}
              </button>
            )}
            {controlStatus !== 'paused' && (
              <button type="button" disabled={controlBusy} onClick={() => void control('takeover')}>
                {t('computerActivity.control.takeover')}
              </button>
            )}
            <button type="button" disabled={controlBusy} onClick={() => void control('stop')}>
              {t('computerActivity.control.stop')}
            </button>
          </div>
          {windows != null && (
            <div className="computer-activity-target-picker">
              <select
                aria-label={t('computerActivity.control.window')}
                value={selectedWindowId}
                onChange={(event) => setSelectedWindowId(event.target.value)}
              >
                {windows.map((window) => (
                  <option key={`${window.app.id}:${window.window.id}`} value={window.window.id}>
                    {window.app.name} — {window.window.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={controlBusy || selectedWindowId === ''}
                onClick={() => void bindTarget()}
              >
                {t('computerActivity.control.bind')}
              </button>
            </div>
          )}
          {controlError != null && (
            <div className="computer-activity-control-error">{controlError}</div>
          )}
        </div>
      )}
    </details>
  )
}

type Translate = ReturnType<typeof useI18n>['t']

function activityStatus(
  event: ComputerUseEvent | undefined,
  t: Translate,
): { kind: string; label: string } {
  if (event?.type === 'computer_session_completed')
    return { kind: 'success', label: t('computerActivity.status.completed') }
  if (event?.type === 'computer_session_failed')
    return { kind: 'error', label: t('computerActivity.status.failed') }
  if (event?.type === 'computer_session_canceled')
    return { kind: 'muted', label: t('computerActivity.status.stopped') }
  if (event?.type === 'computer_handoff_required')
    return { kind: 'warning', label: t('computerActivity.status.handoff') }
  if (event?.type === 'computer_approval_requested')
    return { kind: 'warning', label: t('computerActivity.status.approval') }
  return { kind: 'running', label: t('computerActivity.status.running') }
}

function eventClassName(event: ComputerUseEvent): string {
  return event.type.includes('failed') || event.type === 'computer_action_blocked'
    ? 'is-error'
    : event.type === 'computer_session_completed' || event.type === 'computer_action_executed'
      ? 'is-success'
      : ''
}

function eventLabel(event: ComputerUseEvent, t: Translate): string {
  switch (event.type) {
    case 'computer_session_started':
      return t('computerActivity.event.sessionStarted', {
        environment: environmentLabel(event.environment, t),
      })
    case 'computer_action_requested':
      return t('computerActivity.event.actionRequested', { riskLevel: event.riskLevel })
    case 'computer_action_blocked':
      return t('computerActivity.event.actionBlocked', { reason: repairLabel(event.errorCode, t) })
    case 'computer_action_executed':
      return t('computerActivity.event.actionExecuted')
    case 'computer_action_failed':
      return t('computerActivity.event.actionFailed', { reason: repairLabel(event.errorCode, t) })
    case 'computer_approval_requested':
      return t('computerActivity.event.approvalRequested', { riskLevel: event.riskLevel })
    case 'computer_approval_resolved':
      return t(
        event.decision === 'approved'
          ? 'computerActivity.event.approvalApproved'
          : 'computerActivity.event.approvalDenied',
      )
    case 'computer_verification_started':
      return t('computerActivity.event.verificationStarted')
    case 'computer_verification_completed':
      return t('computerActivity.event.verificationCompleted', {
        status: t(`computerActivity.verification.${event.status}`),
      })
    case 'computer_handoff_required':
      return t('computerActivity.event.handoffRequired', {
        reason: repairLabel(event.errorCode, t),
      })
    case 'computer_session_completed':
      return t('computerActivity.event.sessionCompleted')
    case 'computer_session_failed':
      return t('computerActivity.event.sessionFailed', { reason: repairLabel(event.errorCode, t) })
    case 'computer_session_canceled':
      return t('computerActivity.event.sessionCanceled')
    case 'computer_observation_created':
      return t('computerActivity.event.observationCreated')
  }
}

function repairLabel(errorCode: string, t: Translate): string {
  const labels: Record<string, string> = {
    permission_denied: t('computerActivity.repair.permissionDenied'),
    native_host_not_found: t('computerActivity.repair.nativeHostNotFound'),
    native_host_incompatible: t('computerActivity.repair.nativeHostIncompatible'),
    target_lost: t('computerActivity.repair.targetLost'),
    stale_frame: t('computerActivity.repair.staleFrame'),
    approval_required: t('computerActivity.repair.approvalRequired'),
    session_canceled: t('computerActivity.repair.sessionCanceled'),
  }
  return labels[errorCode] ?? errorCode
}

function environmentLabel(environment: string, t: Translate): string {
  if (environment === 'my_desktop') return t('computerActivity.environment.myDesktop')
  if (environment === 'safe_desktop') return t('computerActivity.environment.safeDesktop')
  return t('computerActivity.environment.safeBrowser')
}

function elapsedLabel(events: ComputerUseEvent[], t: Translate): string | null {
  const first = events[0]
  const last = events.at(-1)
  if (first == null || last == null) return null
  const elapsed = Date.parse(last.timestamp) - Date.parse(first.timestamp)
  if (!Number.isFinite(elapsed) || elapsed < 1_000) return null
  return elapsed < 60_000
    ? t('computerActivity.elapsed.seconds', { count: Math.round(elapsed / 1_000) })
    : t('computerActivity.elapsed.minutes', { count: Math.round(elapsed / 60_000) })
}

function formatTime(timestamp: string, lang: 'zh' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}
