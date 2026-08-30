// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PermissionApprovalRequest } from '@spark/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlinePermissionApproval } from './InlinePermissionApproval'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toast = {
  error: vi.fn(),
  warning: vi.fn(),
}

vi.mock('./Toast', () => ({ useToast: () => ({ toast }) }))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (!item) continue
    act(() => item.root.unmount())
    item.container.remove()
  }
  vi.restoreAllMocks()
  toast.error.mockReset()
  toast.warning.mockReset()
})

function request(): PermissionApprovalRequest {
  return {
    requestId: 'approval-1',
    sessionId: 'session-12345678',
    toolName: 'Bash',
    action: 'execute',
    toolInput: { command: 'pnpm test' },
    riskLevel: 'medium',
    persistentScopes: [],
  }
}

describe('InlinePermissionApproval', () => {
  it('submits the selected decision and only then closes the request', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () =>
      root.render(<InlinePermissionApproval request={request()} onClose={onClose} />),
    )
    const allowSession = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '会话允许',
    )
    expect(allowSession).toBeDefined()

    await act(async () => allowSession?.click())

    expect(invoke).toHaveBeenCalledWith('permission:approval-respond', {
      requestId: 'approval-1',
      decision: 'allow-session',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the approval visible when submitting the decision fails', async () => {
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: vi.fn(async () => Promise.reject(new Error('network failed'))) },
    })
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () =>
      root.render(<InlinePermissionApproval request={request()} onClose={onClose} />),
    )
    const deny = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '拒绝',
    )
    await act(async () => deny?.click())

    expect(toast.error).toHaveBeenCalledWith('network failed')
    expect(onClose).not.toHaveBeenCalled()
  })
})
