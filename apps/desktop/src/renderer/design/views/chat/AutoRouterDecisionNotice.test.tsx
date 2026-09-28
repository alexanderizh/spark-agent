// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AutoRouterDecisionEvent } from '@spark/protocol'
import { AutoRouterDecisionNotice } from './AutoRouterDecisionNotice'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const decision: AutoRouterDecisionEvent = {
  id: 'event-1',
  type: 'auto_router_decision',
  sessionId: 'session-1',
  turnId: 'turn-1',
  timestamp: '2026-09-29T00:00:00.000Z',
  seq: 1,
  routerId: 'router-1',
  routerName: '默认分流器',
  intensity: 'high',
  resolvedProviderId: 'provider-1',
  resolvedModelId: 'deepseek-v4.1-flash',
  modelDisplayName: 'deepseek-v4.1-flash',
  reason:
    '分流降级（http｜HTTP 400：Request is missing x-opencode-session and cannot be routed），规则判定为high',
  fallbackUsed: true,
  fallbackStage: 'http',
  latencyMs: 321,
  prevIntensity: 'balanced',
  reasoningEffort: null,
  decompose: false,
}

describe('AutoRouterDecisionNotice', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders one status icon without a duplicate warning glyph', () => {
    act(() => root.render(<AutoRouterDecisionNotice decision={decision} />))

    const content = container.querySelector('.model-switch-notice-content')
    expect(content?.querySelectorAll(':scope > svg')).toHaveLength(1)
    expect(container.querySelector('.auto-router-notice-summary')?.textContent).not.toContain('⚠')
  })

  it('exposes the full routing detail from the truncated summary', () => {
    act(() => root.render(<AutoRouterDecisionNotice decision={decision} />))

    const detail = container.querySelector('.auto-router-notice-detail')
    const tooltip = container.querySelector('[role="tooltip"]')
    expect(detail?.getAttribute('tabindex')).toBe('0')
    expect(detail?.getAttribute('aria-describedby')).toBe(tooltip?.id)
    expect(tooltip?.textContent).toContain(decision.reason)
    expect(tooltip?.textContent).toContain('默认分流器')
  })
})
