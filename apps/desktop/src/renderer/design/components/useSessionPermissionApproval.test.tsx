// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PermissionApprovalRequest, PermissionApprovalResolved } from '@spark/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionPermissionApproval } from './useSessionPermissionApproval'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ApprovalEventMap = {
  'stream:permission:approval-request': PermissionApprovalRequest
  'stream:permission:approval-resolved': PermissionApprovalResolved
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (!item) continue
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function request(sessionId: string, requestId: string): PermissionApprovalRequest {
  return {
    sessionId,
    requestId,
    toolName: 'Bash',
    action: 'execute',
    toolInput: { command: 'pnpm test' },
    riskLevel: 'medium',
    persistentScopes: [],
  }
}

describe('useSessionPermissionApproval', () => {
  it('keeps listening while the host is hidden and routes events precisely', async () => {
    const listeners = new Map<keyof ApprovalEventMap, Set<(payload: never) => void>>()
    const on = vi.fn((channel: keyof ApprovalEventMap, listener: (payload: never) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set<(payload: never) => void>()
      channelListeners.add(listener)
      listeners.set(channel, channelListeners)
      return () => channelListeners.delete(listener)
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { on },
    })

    const emit = <Channel extends keyof ApprovalEventMap>(
      channel: Channel,
      payload: ApprovalEventMap[Channel],
    ) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload as never)
    }
    function Host({ sessionId, open }: { sessionId: string; open: boolean }) {
      const { approvalRequest } = useSessionPermissionApproval(sessionId)
      return open && approvalRequest ? <span>{approvalRequest.requestId}</span> : null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(<Host sessionId="session-a" open={false} />))
    await act(async () => {
      emit('stream:permission:approval-request', request('session-a', 'request-a'))
    })
    expect(container.textContent).toBe('')

    await act(async () => root.render(<Host sessionId="session-a" open />))
    expect(container.textContent).toBe('request-a')

    await act(async () => root.render(<Host sessionId="session-b" open />))
    expect(container.textContent).toBe('')

    await act(async () => {
      emit('stream:permission:approval-request', request('session-a', 'stale-request'))
      emit('stream:permission:approval-request', request('session-b', 'request-b'))
    })
    expect(container.textContent).toBe('request-b')

    await act(async () => {
      emit('stream:permission:approval-resolved', {
        sessionId: 'session-b',
        requestId: 'different-request',
        reason: 'cancelled',
      })
    })
    expect(container.textContent).toBe('request-b')

    await act(async () => {
      emit('stream:permission:approval-resolved', {
        sessionId: 'session-b',
        requestId: 'request-b',
        reason: 'cancelled',
      })
    })
    expect(container.textContent).toBe('')
  })
})
