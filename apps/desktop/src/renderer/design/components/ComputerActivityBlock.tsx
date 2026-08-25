import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@lobehub/ui'
import type {
  ComputerSession,
  ComputerUseEvent,
  NativeWindowDescriptor,
  SessionId,
} from '@spark/protocol'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
  sliceComputerActivityTimelines,
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

/** 消息插槽里一段电脑操作记录的渲染模型（由 Bridge 切片产出） */
export interface ComputerActivitySegmentView {
  key: string
  computerSessionId: string
  /** 本段事件（seq 升序），时间上落在所属消息与其后一条消息之间 */
  events: ComputerUseEvent[]
  /** 整条 computerSession 时间线的全部事件（终态/耗时按全量判定） */
  sessionEvents: ComputerUseEvent[]
  session: ComputerSession | null
  /** 是否为该时间线切出的最后一段：状态徽标与控制按钮只跟随它 */
  isSessionLatest: boolean
  /** 会话级加载失败信息（只挂在最后一条消息的末段上显示一次） */
  loadError: string | null
}

/**
 * 消费 ComputerActivityProvider 的数据，把电脑操作时间线按消息时间锚点切片，
 * 通过 render-prop 向消息列表提供 `segmentsFor(messageId)`；每条消息后的插槽
 * 渲染自己的段，实现操作记录按时间顺序穿插在会话消息流内。
 */
export function ComputerActivitySegmentsBridge({
  messages,
  children,
}: {
  messages: ReadonlyArray<{ id: string; timestamp?: string | undefined }>
  children: (segmentsFor: (messageId: string) => ComputerActivitySegmentView[]) => ReactNode
}) {
  const activity = useContext(ComputerActivityContext)
  const timelines = useMemo(
    () => groupComputerActivityEvents(activity?.events ?? []),
    [activity?.events],
  )
  const segmentsFor = useMemo(() => {
    const segmentsByMessage = sliceComputerActivityTimelines(timelines, messages)
    const lastMessage = messages[messages.length - 1]
    return (messageId: string): ComputerActivitySegmentView[] => {
      const segments = segmentsByMessage.get(messageId) ?? []
      const views: ComputerActivitySegmentView[] = segments.map((segment) => ({
        key: `${segment.computerSessionId}:${segment.events[0]?.seq ?? 0}`,
        computerSessionId: segment.computerSessionId,
        events: segment.events,
        sessionEvents:
          timelines.find((timeline) => timeline.computerSessionId === segment.computerSessionId)
            ?.events ?? segment.events,
        session: activity?.sessions.find((item) => item.id === segment.computerSessionId) ?? null,
        isSessionLatest: segment.isSessionLatest,
        loadError: null,
      }))
      // 会话级加载失败只显示一次：挂到最后一条消息的末尾（无段时补一个纯错误段）。
      if (activity?.loadError != null && messageId === lastMessage?.id) {
        const lastView = views[views.length - 1]
        if (lastView != null) {
          views[views.length - 1] = { ...lastView, loadError: activity.loadError }
        } else {
          views.push({
            key: 'load-error',
            computerSessionId: '',
            events: [],
            sessionEvents: [],
            session: null,
            isSessionLatest: false,
            loadError: activity.loadError,
          })
        }
      }
      return views
    }
  }, [timelines, activity?.sessions, activity?.loadError, messages])
  return children(segmentsFor)
}

/** 消息插槽里的电脑操作段卡片：轻量折叠卡；控制按钮只出现在时间线的最新段 */
export function ComputerActivitySegmentCard({ view }: { view: ComputerActivitySegmentView }) {
  const { lang, t } = useI18n()
  if (view.loadError != null && view.events.length === 0) {
    return (
      <section className="computer-activity-list" aria-label={t('computerActivity.ariaLabel')}>
        <div className="computer-activity-load-error">{view.loadError}</div>
      </section>
    )
  }
  return (
    <section className="computer-activity-list" aria-label={t('computerActivity.ariaLabel')}>
      <ComputerActivityCard view={view} lang={lang} t={t} />
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
  view,
  lang,
  t,
}: {
  view: ComputerActivitySegmentView
  lang: 'zh' | 'en'
  t: Translate
}) {
  const { computerSessionId, session, isSessionLatest } = view
  const latest = view.sessionEvents.at(-1)
  const terminal = isTerminalComputerActivityEvent(latest)
  const status = activityStatus(latest, t)
  const visibleEvents = view.events.filter((event) => event.type !== 'computer_observation_created')
  const elapsed = isSessionLatest ? elapsedLabel(view.sessionEvents, t) : null
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
    <details
      className={`computer-activity-card is-${status.kind}`}
      open={isSessionLatest ? !terminal : false}
    >
      <summary>
        <Icons.ChevronRight size={12} className="computer-activity-chev" />
        <span className="computer-activity-status-dot" aria-hidden="true" />
        <span className="computer-activity-title">{t('computerActivity.title')}</span>
        <span className="computer-activity-status">
          {isSessionLatest
            ? status.label
            : t('computerActivity.segment.steps', { count: view.events.length })}
        </span>
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
      {view.loadError != null && (
        <div className="computer-activity-load-error">{view.loadError}</div>
      )}
      {isSessionLatest && session != null && !terminal && (
        <div className="computer-activity-controls">
          <div className="computer-activity-control-actions">
            {controlStatus !== 'paused' && (
              <Button
                type="text"
                size="small"
                disabled={controlBusy}
                onClick={() => void control('pause')}
              >
                {t('computerActivity.control.pause')}
              </Button>
            )}
            {controlStatus === 'paused' && (
              <Button
                type="text"
                size="small"
                disabled={controlBusy}
                onClick={() => void openTargetPicker()}
              >
                {t('computerActivity.control.changeTarget')}
              </Button>
            )}
            {controlStatus !== 'paused' && (
              <Button
                type="text"
                size="small"
                disabled={controlBusy}
                onClick={() => void control('takeover')}
              >
                {t('computerActivity.control.takeover')}
              </Button>
            )}
            <Button
              type="text"
              size="small"
              disabled={controlBusy}
              onClick={() => void control('stop')}
            >
              {t('computerActivity.control.stop')}
            </Button>
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
              <Button
                type="text"
                size="small"
                disabled={controlBusy || selectedWindowId === ''}
                onClick={() => void bindTarget()}
              >
                {t('computerActivity.control.bind')}
              </Button>
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
