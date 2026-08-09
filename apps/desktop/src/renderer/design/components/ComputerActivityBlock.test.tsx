// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerSession, ComputerUseEvent, SessionId } from '@spark/protocol'
import { ComputerActivityBlock, ComputerActivityProvider } from './ComputerActivityBlock'
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

function computerSession(
  id: string,
  status: ComputerSession['status'] = 'observing',
): ComputerSession {
  return {
    id,
    sessionId: `session-${id}`,
    turnId: `turn-${id}`,
    workflowRunId: null,
    environment: 'my_desktop',
    status,
    providerProfileId: 'provider-1',
    modelId: 'model-1',
    taskContract: {
      objective: 'Edit the target',
      successCriteria: [
        {
          kind: 'application_state',
          appId: 'app-1',
          assertion: { operator: 'frontmost', expected: true },
        },
      ],
      allowedApps: [{ kind: 'bundle_id', value: 'com.spark.Editor' }],
      allowedDomains: [],
      allowedDataClasses: ['public'],
      forbiddenActions: [],
      maxSteps: 10,
      maxRuntimeMs: 60_000,
      maxConsecutiveNoops: 3,
      userPresence: 'required',
    },
    actuatorLeaseId: 'lease-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('ComputerActivityBlock', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveSecondSession: ((value: { computerSessions: ComputerSession[] }) => void) | undefined

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
                return new Promise<{ computerSessions: ComputerSession[] }>((resolve) => {
                  resolveSecondSession = resolve
                })
              }
              return Promise.resolve({ computerSessions: [computerSession('computer-1')] })
            }
            if (channel === 'computer-use:pause') {
              return Promise.resolve({ computerSession: computerSession('computer-1', 'paused') })
            }
            if (channel === 'computer-use:list-windows') {
              return Promise.resolve({
                windows: [
                  {
                    app: { id: 'app-1', name: 'Editor', bundleId: 'com.spark.Editor' },
                    window: {
                      id: 'window-2',
                      title: 'Draft',
                      bounds: { x: 0, y: 0, width: 800, height: 600 },
                    },
                    display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
                    focused: false,
                    minimized: false,
                  },
                  {
                    app: { id: 'app-2', name: 'bilibili', bundleId: 'tv.danmaku.bilianime' },
                    window: {
                      id: 'window-bilibili',
                      title: 'Home',
                      bounds: { x: 800, y: 0, width: 800, height: 600 },
                    },
                    display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
                    focused: false,
                    minimized: false,
                  },
                ],
              })
            }
            if (channel === 'computer-use:bind-target') {
              return Promise.resolve({
                computerSession: computerSession('computer-1', 'paused'),
                targetWindowId: 'window-2',
              })
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
      root.render(
        <ComputerActivityProvider sessionId={'session-1' as SessionId}>
          <ComputerActivityBlock />
        </ComputerActivityProvider>,
      )
    })
    expect(container.textContent).toContain('risk=L1')

    act(() =>
      root.render(
        <ComputerActivityProvider sessionId={'session-2' as SessionId}>
          <ComputerActivityBlock />
        </ComputerActivityProvider>,
      ),
    )
    expect(container.textContent).toBe('')

    await act(async () => {
      resolveSecondSession?.({ computerSessions: [computerSession('computer-2')] })
    })
    expect(container.textContent).toContain('risk=L2')
  })

  it('pauses before offering every visible application in the target picker', async () => {
    await act(async () => {
      root.render(
        <ComputerActivityProvider sessionId={'session-1' as SessionId}>
          <ComputerActivityBlock />
        </ComputerActivityProvider>,
      )
    })
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((item) => item.textContent === label)

    await act(async () => button('computerActivity.control.pause')?.click())
    await act(async () => button('computerActivity.control.changeTarget')?.click())
    expect([...container.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Editor — Draft',
      'bilibili — Home',
    ])
    await act(async () => button('computerActivity.control.bind')?.click())

    expect(window.spark.invoke).toHaveBeenCalledWith('computer-use:bind-target', {
      computerSessionId: 'computer-1',
      targetWindowId: 'window-2',
    })
  })

  it('renders activity only in the matching conversation turn', async () => {
    await act(async () => {
      root.render(
        <ComputerActivityProvider sessionId={'session-1' as SessionId}>
          <div data-testid="matching">
            <ComputerActivityBlock turnId="turn-computer-1" />
          </div>
          <div data-testid="unrelated">
            <ComputerActivityBlock turnId="turn-unrelated" />
          </div>
        </ComputerActivityProvider>,
      )
    })

    expect(container.querySelector('[data-testid="matching"]')?.textContent).toContain('risk=L1')
    expect(container.querySelector('[data-testid="unrelated"]')?.textContent).toBe('')
  })
})
