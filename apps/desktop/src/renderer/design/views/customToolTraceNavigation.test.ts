// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumePendingCustomToolTrace,
  hasPendingCustomToolTrace,
  OPEN_CUSTOM_TOOL_TRACE_EVENT,
  requestOpenCustomToolTrace,
  targetFromCustomToolTraceEvent,
} from './customToolTraceNavigation'

describe('customToolTraceNavigation', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('persists and dispatches a trace target for cross-view mounting', () => {
    const received: unknown[] = []
    window.addEventListener(
      OPEN_CUSTOM_TOOL_TRACE_EVENT,
      (event) => {
        received.push((event as CustomEvent<unknown>).detail)
      },
      { once: true },
    )

    requestOpenCustomToolTrace({ toolId: 'vision_fallback', traceId: 42 })

    expect(received).toEqual([{ toolId: 'vision_fallback', traceId: 42 }])
    expect(hasPendingCustomToolTrace()).toBe(true)
    expect(consumePendingCustomToolTrace()).toEqual({ toolId: 'vision_fallback', traceId: 42 })
    expect(hasPendingCustomToolTrace()).toBe(false)
  })

  it('rejects malformed live targets', () => {
    expect(
      targetFromCustomToolTraceEvent(
        new CustomEvent(OPEN_CUSTOM_TOOL_TRACE_EVENT, {
          detail: { toolId: '', traceId: -1 },
        }),
      ),
    ).toBeNull()
  })
})
