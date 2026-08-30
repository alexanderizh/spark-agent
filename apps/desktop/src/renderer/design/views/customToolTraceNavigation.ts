export const OPEN_CUSTOM_TOOL_TRACE_EVENT = 'spark:open-custom-tool-trace'
export const OPEN_CUSTOM_TOOL_TRACE_PENDING_KEY = 'spark-agent:open-custom-tool-trace-pending'

const PENDING_TTL_MS = 30_000

export interface CustomToolTraceTarget {
  toolId: string
  traceId?: number
}

interface PendingCustomToolTrace extends CustomToolTraceTarget {
  ts: number
}

function parsePending(raw: string | null): PendingCustomToolTrace | null {
  if (raw == null) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingCustomToolTrace>
    if (typeof value.toolId !== 'string' || value.toolId.trim().length === 0) return null
    if (typeof value.ts !== 'number' || Date.now() - value.ts > PENDING_TTL_MS) return null
    if (value.traceId != null && (!Number.isInteger(value.traceId) || value.traceId <= 0))
      return null
    return {
      toolId: value.toolId,
      ts: value.ts,
      ...(value.traceId != null ? { traceId: value.traceId } : {}),
    }
  } catch {
    return null
  }
}

export function requestOpenCustomToolTrace(target: CustomToolTraceTarget): void {
  if (typeof window === 'undefined') return
  const pending: PendingCustomToolTrace = { ...target, ts: Date.now() }
  try {
    window.localStorage.setItem(OPEN_CUSTOM_TOOL_TRACE_PENDING_KEY, JSON.stringify(pending))
  } catch {
    /* localStorage unavailable: the live event still handles mounted views. */
  }
  window.dispatchEvent(new CustomEvent(OPEN_CUSTOM_TOOL_TRACE_EVENT, { detail: target }))
}

export function hasPendingCustomToolTrace(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return parsePending(window.localStorage.getItem(OPEN_CUSTOM_TOOL_TRACE_PENDING_KEY)) != null
  } catch {
    return false
  }
}

export function consumePendingCustomToolTrace(): CustomToolTraceTarget | null {
  if (typeof window === 'undefined') return null
  try {
    const pending = parsePending(window.localStorage.getItem(OPEN_CUSTOM_TOOL_TRACE_PENDING_KEY))
    window.localStorage.removeItem(OPEN_CUSTOM_TOOL_TRACE_PENDING_KEY)
    if (pending == null) return null
    return {
      toolId: pending.toolId,
      ...(pending.traceId != null ? { traceId: pending.traceId } : {}),
    }
  } catch {
    return null
  }
}

export function targetFromCustomToolTraceEvent(event: Event): CustomToolTraceTarget | null {
  const detail = (event as CustomEvent<unknown>).detail
  if (detail == null || typeof detail !== 'object') return null
  const value = detail as Partial<CustomToolTraceTarget>
  if (typeof value.toolId !== 'string' || value.toolId.trim().length === 0) return null
  if (value.traceId != null && (!Number.isInteger(value.traceId) || value.traceId <= 0)) return null
  return {
    toolId: value.toolId,
    ...(value.traceId != null ? { traceId: value.traceId } : {}),
  }
}
