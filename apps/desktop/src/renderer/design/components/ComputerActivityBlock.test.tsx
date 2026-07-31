// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerUseEvent, SessionId } from '@spark/protocol'
import { ComputerActivityBlock } from './ComputerActivityBlock'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../i18n', () => {
  const t = (key: string, params?: Record<string, string | number | null | undefined>) =>
    key === 'computerActivity.event.actionRequested' ? `risk=${params?.riskLevel ?? ''}` : key
  return { useI18n: () => ({ lang: 'en', t }) }
})

function actionRequested(computerSessionId: string, riskLevel: 'L1' | 'L2'): ComputerUseEvent {
  return {
    id: `event-${computerSessionId}`,
    type: 'computer_action_requested',
    sessionId: `session-${computerSessionId}`,
    turnId: `turn-${computerSessionId}`,
    computerSessionId,
    timestamp: '2026-07-31T00:00:00.000Z',
    seq: 0,
    actionId: `action-${computerSessionId}`,
    riskLevel,
  }
}

describe('ComputerActivityBlock', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveSecondSession:
    | ((value: { computerSessions: Array<{ id: string }> }) => void)
    | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        on: vi.fn(() => vi.fn()),
        invoke: vi.fn(
          (channel: string, input: { sessionId?: string; computerSessionId?: string }) => {
            if (channel === 'computer-use:list-sessions') {
              if (input.sessionId === 'session-2') {
                return new Promise<{ computerSessions: Array<{ id: string }> }>((resolve) => {
                  resolveSecondSession = resolve
                })
              }
              return Promise.resolve({ computerSessions: [{ id: 'computer-1' }] })
            }
            const isSecondSession = input.computerSessionId === 'computer-2'
            return Promise.resolve({
              events: [
                actionRequested(
                  isSecondSession ? 'computer-2' : 'computer-1',
                  isSecondSession ? 'L2' : 'L1',
                ),
              ],
              nextSeq: 0,
            })
          },
        ),
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('removes the previous timeline immediately while the next session loads', async () => {
    await act(async () => {
      root.render(<ComputerActivityBlock sessionId={'session-1' as SessionId} />)
    })
    expect(container.textContent).toContain('risk=L1')

    act(() => root.render(<ComputerActivityBlock sessionId={'session-2' as SessionId} />))
    expect(container.textContent).toBe('')

    await act(async () => {
      resolveSecondSession?.({ computerSessions: [{ id: 'computer-2' }] })
    })
    expect(container.textContent).toContain('risk=L2')
  })
})
