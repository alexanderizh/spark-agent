// __SPARK_DEBUG_START__ sid=message-bubble-render-latency round=1
const DEBUG_ENDPOINT = 'http://127.0.0.1:43827/ingest'
const PROBE_TIMEOUT_MS = 30_000

interface OptimisticRenderProbe {
  clientId: string
  messageId: string
  sessionId: string
  startedAt: number
  createdAt: string
  hiddenUntilStarted: boolean
  reportedStages: Set<string>
  timeoutId: number
}

interface OptimisticRenderProbeInput {
  clientId: string
  sessionId: string
  createdAt: string
  hiddenUntilStarted: boolean
  contentLength: number
}

const probes = new Map<string, OptimisticRenderProbe>()
let longTaskObserverStarted = false

function canReport(): boolean {
  return typeof window !== 'undefined' && 'spark' in window
}

function elapsed(probe: OptimisticRenderProbe): number {
  return Math.round((performance.now() - probe.startedAt) * 10) / 10
}

function report(
  probe: OptimisticRenderProbe,
  tag: string,
  data: Record<string, unknown> = {},
): void {
  if (!canReport()) return
  const payload = {
    clientId: probe.clientId,
    messageId: probe.messageId,
    sessionId: probe.sessionId,
    elapsedMs: elapsed(probe),
    hiddenUntilStarted: probe.hiddenUntilStarted,
    ...data,
  }
  try {
    // Windows packaged builds can always expose this through F12 even when the
    // session-scoped DebugLogServer tool is unavailable to the investigating agent.
    console.warn(`[BUG-DEBUG] optimistic-render ${JSON.stringify({ tag, ...payload })}`)
    void fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sid: 'message-bubble-render-latency',
        round: 1,
        tag,
        source: 'renderer',
        ts: new Date().toISOString(),
        data: payload,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 调试上报绝不能影响消息发送。
  }
}

function reportStage(
  probe: OptimisticRenderProbe,
  stage: string,
  data: Record<string, unknown> = {},
): void {
  if (probe.reportedStages.has(stage)) return
  probe.reportedStages.add(stage)
  report(probe, stage, data)
}

function ensureLongTaskObserver(): void {
  if (longTaskObserverStarted || !canReport() || typeof PerformanceObserver === 'undefined') return
  longTaskObserverStarted = true
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        for (const probe of probes.values()) {
          if (entry.startTime + entry.duration < probe.startedAt) continue
          report(probe, 'main-thread-long-task', {
            taskStartOffsetMs: Math.round((entry.startTime - probe.startedAt) * 10) / 10,
            durationMs: Math.round(entry.duration * 10) / 10,
          })
        }
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // 当前 Chromium 不支持 longtask 时，仍可依靠 microtask/timer/RAF 延迟判断。
  }
}

export function beginOptimisticMessageRenderProbe(input: OptimisticRenderProbeInput): void {
  if (!canReport()) return
  const messageId = `optimistic-${input.clientId}`
  const previous = probes.get(messageId)
  if (previous != null) window.clearTimeout(previous.timeoutId)

  const probe: OptimisticRenderProbe = {
    clientId: input.clientId,
    messageId,
    sessionId: input.sessionId,
    startedAt: performance.now(),
    createdAt: input.createdAt,
    hiddenUntilStarted: input.hiddenUntilStarted,
    reportedStages: new Set<string>(),
    timeoutId: 0,
  }
  probes.set(messageId, probe)
  reportStage(probe, 'optimistic-send-start', {
    createdAt: input.createdAt,
    contentLength: input.contentLength,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    navigatorPlatform: navigator.platform,
    userAgent: navigator.userAgent,
  })
  ensureLongTaskObserver()

  queueMicrotask(() => reportStage(probe, 'event-loop-microtask'))
  window.setTimeout(() => reportStage(probe, 'event-loop-timeout-0'), 0)
  window.requestAnimationFrame(() => reportStage(probe, 'event-loop-animation-frame'))
  probe.timeoutId = window.setTimeout(() => {
    reportStage(probe, 'optimistic-row-mount-timeout')
    probes.delete(messageId)
  }, PROBE_TIMEOUT_MS)
}

export function markOptimisticBeginReturned(clientId: string): void {
  const probe = probes.get(`optimistic-${clientId}`)
  if (probe != null) reportStage(probe, 'optimistic-on-begin-returned')
}

export function markOptimisticVisiblePaintWaitResolved(clientId: string): void {
  const probe = probes.get(`optimistic-${clientId}`)
  if (probe != null) reportStage(probe, 'optimistic-visible-paint-wait-resolved')
}

export function markOptimisticLifecycleSettled(
  clientId: string,
  outcome: 'commit' | 'fail' | 'cancel',
  data: Record<string, unknown> = {},
): void {
  const probe = probes.get(`optimistic-${clientId}`)
  if (probe != null) reportStage(probe, `optimistic-lifecycle-${outcome}`, data)
}

export function markVirtualMessageRowMounted(item: unknown, node: Element | null): void {
  if (node == null || typeof item !== 'object' || item == null || !('id' in item)) return
  const messageId = (item as { id?: unknown }).id
  if (typeof messageId !== 'string') return
  const probe = probes.get(messageId)
  if (probe == null) return

  reportStage(probe, 'optimistic-row-mounted', {
    connected: node.isConnected,
    createdAt: probe.createdAt,
  })
  window.requestAnimationFrame(() => {
    reportStage(probe, 'optimistic-row-next-frame')
    window.clearTimeout(probe.timeoutId)
    probes.delete(messageId)
  })
}
// __SPARK_DEBUG_END__
