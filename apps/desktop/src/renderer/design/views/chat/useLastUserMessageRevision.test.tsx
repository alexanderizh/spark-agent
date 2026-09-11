// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionId, TurnId } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLastUserMessageRevision } from './useLastUserMessageRevision'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ipcMocks = vi.hoisted(() => ({ rewindLastTurn: vi.fn() }))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: ipcMocks.rewindLastTurn }),
}))

describe('useLastUserMessageRevision', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ipcMocks.rewindLastTurn.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('restores the edited draft if another submit wins the race', async () => {
    const restoreDraft = vi.fn()
    const info = vi.fn()
    function Harness() {
      useLastUserMessageRevision({
        request: {
          requestId: 1,
          payload: {
            sessionId: 'session-1' as SessionId,
            turnId: 'turn-1' as TurnId,
            text: 'edited',
            attachments: [],
          },
        },
        sessionId: 'session-1' as SessionId,
        providerAvailable: true,
        submitGate: { tryEnter: () => false, leave: vi.fn() },
        setSending: vi.fn(),
        dispatchMessage: vi.fn(),
        restoreDraft,
        toast: { info, error: vi.fn() },
      })
      return null
    }

    await act(async () => root.render(<Harness />))
    expect(restoreDraft).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'edited', attachments: [] }),
    )
    expect(info).toHaveBeenCalledOnce()
  })

  it('reports the retracted turn so an immediately cancelled optimistic bubble can be removed', async () => {
    ipcMocks.rewindLastTurn.mockResolvedValue({ turnCount: 1, logicalMessageCount: 2 })
    const onApplied = vi.fn()
    const dispatchMessage = vi.fn().mockResolvedValue(undefined)

    function Harness() {
      useLastUserMessageRevision({
        request: {
          requestId: 2,
          payload: {
            sessionId: 'session-1' as SessionId,
            turnId: 'turn-cancelled' as TurnId,
            text: 'edited after cancel',
            attachments: [],
          },
        },
        sessionId: 'session-1' as SessionId,
        providerAvailable: true,
        submitGate: { tryEnter: () => true, leave: vi.fn() },
        setSending: vi.fn(),
        dispatchMessage,
        onApplied,
        restoreDraft: vi.fn(),
        toast: { info: vi.fn(), error: vi.fn() },
      })
      return null
    }

    await act(async () => root.render(<Harness />))
    await vi.waitFor(() => expect(dispatchMessage).toHaveBeenCalledOnce())
    expect(onApplied).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-cancelled',
      turnCount: 1,
      logicalMessageCount: 2,
    })
  })
})
