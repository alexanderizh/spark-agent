// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionId, TurnId } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLastUserMessageRevision } from './useLastUserMessageRevision'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: vi.fn() }),
}))

describe('useLastUserMessageRevision', () => {
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
})
