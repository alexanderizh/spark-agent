import { useEffect, useMemo, useState } from 'react'
import type { ComputerUseEvent, SessionId } from '@spark/protocol'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
} from './computer-activity-timeline'
import './ComputerActivityBlock.less'

const PAGE_SIZE = 500

export function ComputerActivityBlock({ sessionId }: { sessionId: SessionId }) {
  const [events, setEvents] = useState<ComputerUseEvent[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    setEvents([])
    setLoadError(null)

    const unsubscribe = window.spark.on('stream:computer-use:activity-event', (event) => {
      if (event.sessionId !== sessionId) return
      setEvents((current) => mergeComputerActivityEvents(current, [event]))
    })

    void loadSessionTimelines(sessionId)
      .then((history) => {
        if (!canceled) setEvents((current) => mergeComputerActivityEvents(history, current))
      })
      .catch((error: unknown) => {
        if (!canceled)
          setLoadError(error instanceof Error ? error.message : 'Computer Use 日志加载失败')
      })

    return () => {
      canceled = true
      unsubscribe()
    }
  }, [sessionId])

  const timelines = useMemo(() => groupComputerActivityEvents(events), [events])
  if (timelines.length === 0 && loadError == null) return null

  return (
    <section className="computer-activity-list" aria-label="Computer Use 操作日志">
      {loadError != null && <div className="computer-activity-load-error">{loadError}</div>}
      {timelines.map((timeline) => (
        <ComputerActivityCard
          key={timeline.computerSessionId}
          computerSessionId={timeline.computerSessionId}
          events={timeline.events}
        />
      ))}
    </section>
  )
}

async function loadSessionTimelines(sessionId: SessionId): Promise<ComputerUseEvent[]> {
  const { computerSessions } = await window.spark.invoke('computer-use:list-sessions', {
    sessionId,
    limit: 100,
  })
  const pages = await Promise.all(computerSessions.map((session) => loadTimeline(session.id)))
  return pages.flat()
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
  events,
}: {
  computerSessionId: string
  events: ComputerUseEvent[]
}) {
  const latest = events.at(-1)
  const terminal = isTerminalComputerActivityEvent(latest)
  const status = activityStatus(latest)
  const visibleEvents = events.filter((event) => event.type !== 'computer_observation_created')
  const elapsed = elapsedLabel(events)

  return (
    <details className={`computer-activity-card is-${status.kind}`} open={!terminal}>
      <summary>
        <span className="computer-activity-status-dot" aria-hidden="true" />
        <span className="computer-activity-title">电脑操作</span>
        <span className="computer-activity-status">{status.label}</span>
        {elapsed != null && <span className="computer-activity-elapsed">{elapsed}</span>}
      </summary>
      <ol className="computer-activity-events">
        {visibleEvents.map((event) => (
          <li key={`${computerSessionId}:${event.seq}`} className={eventClassName(event)}>
            <span>{eventLabel(event)}</span>
            <time>{formatTime(event.timestamp)}</time>
          </li>
        ))}
      </ol>
    </details>
  )
}

function activityStatus(event: ComputerUseEvent | undefined): { kind: string; label: string } {
  if (event?.type === 'computer_session_completed') return { kind: 'success', label: '已完成' }
  if (event?.type === 'computer_session_failed') return { kind: 'error', label: '失败' }
  if (event?.type === 'computer_session_canceled') return { kind: 'muted', label: '已停止' }
  if (event?.type === 'computer_handoff_required') return { kind: 'warning', label: '需要接管' }
  if (event?.type === 'computer_approval_requested') return { kind: 'warning', label: '等待确认' }
  return { kind: 'running', label: '进行中' }
}

function eventClassName(event: ComputerUseEvent): string {
  return event.type.includes('failed') || event.type === 'computer_action_blocked'
    ? 'is-error'
    : event.type === 'computer_session_completed' || event.type === 'computer_action_executed'
      ? 'is-success'
      : ''
}

function eventLabel(event: ComputerUseEvent): string {
  switch (event.type) {
    case 'computer_session_started':
      return `已连接 ${environmentLabel(event.environment)}`
    case 'computer_action_requested':
      return `准备执行操作（${event.riskLevel}）`
    case 'computer_action_blocked':
      return `操作被阻止：${repairLabel(event.errorCode)}`
    case 'computer_action_executed':
      return '操作已执行并重新观察界面'
    case 'computer_action_failed':
      return `操作失败：${repairLabel(event.errorCode)}`
    case 'computer_approval_requested':
      return `等待用户确认（${event.riskLevel}）`
    case 'computer_approval_resolved':
      return event.decision === 'approved' ? '用户已允许操作' : '用户未允许操作'
    case 'computer_verification_started':
      return '正在校验操作结果'
    case 'computer_verification_completed':
      return `结果校验：${event.status === 'passed' ? '通过' : event.status === 'failed' ? '未通过' : '无法确认'}`
    case 'computer_handoff_required':
      return `需要用户接管：${repairLabel(event.errorCode)}`
    case 'computer_session_completed':
      return '电脑操作已完成'
    case 'computer_session_failed':
      return `任务失败：${repairLabel(event.errorCode)}`
    case 'computer_session_canceled':
      return '电脑操作已停止'
    case 'computer_observation_created':
      return '已获取最新界面'
  }
}

function repairLabel(errorCode: string): string {
  const labels: Record<string, string> = {
    permission_denied: '请在系统设置中开启屏幕录制与辅助功能权限',
    native_host_not_found: '请修复或重新安装 Native Host',
    native_host_incompatible: '请更新 SparkWork 与 Native Host',
    target_lost: '目标窗口已关闭或切换，请重新选择',
    stale_frame: '界面已变化，正在重新定位',
    approval_required: '需要确认后才能继续',
    session_canceled: '会话已取消',
  }
  return labels[errorCode] ?? errorCode
}

function environmentLabel(environment: string): string {
  if (environment === 'my_desktop') return '我的桌面'
  if (environment === 'safe_desktop') return '隔离桌面'
  return '安全浏览器'
}

function elapsedLabel(events: ComputerUseEvent[]): string | null {
  const first = events[0]
  const last = events.at(-1)
  if (first == null || last == null) return null
  const elapsed = Date.parse(last.timestamp) - Date.parse(first.timestamp)
  if (!Number.isFinite(elapsed) || elapsed < 1_000) return null
  return elapsed < 60_000
    ? `${Math.round(elapsed / 1_000)} 秒`
    : `${Math.round(elapsed / 60_000)} 分钟`
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}
