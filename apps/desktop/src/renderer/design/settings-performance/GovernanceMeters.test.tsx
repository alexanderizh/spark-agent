// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DispatchGovernorGetDiagnosticsResponse } from '@spark/protocol'
import { GovernanceMeters } from './GovernanceMeters'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 口径回归：底部小字必须区分「真实运行中会话数」与「计入主池预算的宿主占用」。
 * 旧实现只渲染 hostEffectiveCount（被宿主封顶截断后的值）并称「宿主在途」，
 * 6 会话满载时会显示成 5，且无法回答「这些进度条和运行中的会话有什么关系」。
 */
function makeDiagnostics(overrides: {
  hostInflightCount: number
  hostEffectiveCount: number
  hostInflightCap?: number
  totalAgentProcessBudget?: number
}): DispatchGovernorGetDiagnosticsResponse {
  const hostInflightCap = overrides.hostInflightCap ?? 5
  const totalAgentProcessBudget = overrides.totalAgentProcessBudget ?? 8
  return {
    available: true,
    diagnostics: {
      enabled: true,
      config: {
        enabled: true,
        totalAgentProcessBudget,
        hostInflightCap,
        minMemberSlots: 3,
        maxMemberDispatches: 6,
        nestedDispatchSlots: 2,
        deadlockEscapeAfterMs: 15000,
        gateWaitTimeoutMs: 120000,
      },
      hostInflightCount: overrides.hostInflightCount,
      hostEffectiveCount: overrides.hostEffectiveCount,
      mainCapacity: totalAgentProcessBudget - overrides.hostEffectiveCount,
      mainInUse: 0,
      mainWaiting: 0,
      nestedSlots: 2,
      nestedInUse: 0,
      nestedWaiting: 0,
      escapeInFlight: 0,
      counters: {
        acquisitions: 0,
        releases: 0,
        gateTimeouts: 0,
        canceledWhileWaiting: 0,
        escapeGrants: 0,
      },
    },
  }
}

describe('GovernanceMeters 底部口径行', () => {
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

  const render = async (diagnostics: DispatchGovernorGetDiagnosticsResponse): Promise<string> => {
    await act(async () => {
      root.render(<GovernanceMeters diagnostics={diagnostics} summary={null} loading={false} />)
    })
    const line = container.querySelector<HTMLElement>('.meter-row .m-sub')
    return line?.textContent ?? ''
  }

  it('未触顶时全文显示运行中会话数', async () => {
    const text = await render(
      makeDiagnostics({ hostInflightCount: 3, hostEffectiveCount: 3, hostInflightCap: 5 }),
    )
    expect(text).toContain('运行中会话 3（全部计入并发预算）')
    expect(text).toContain('全局并发预算 8')
    expect(text).not.toContain('宿主在途')
  })

  it('触顶时如实标出被截断的差额与宿主封顶', async () => {
    const text = await render(
      makeDiagnostics({ hostInflightCount: 6, hostEffectiveCount: 5, hostInflightCap: 5 }),
    )
    expect(text).toContain('运行中会话 6 · 计入并发预算 5（宿主封顶 5）')
  })
})
