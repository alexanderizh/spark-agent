// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionGetQueueResponse } from '@spark/protocol'
import { RemoteQueuePanel } from './RemoteQueuePanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteQueuePanel', () => {
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

  it('shows queued messages and redacts hidden internal prompt text', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    const snapshot: SessionGetQueueResponse = {
      sessionId,
      running: true,
      queuedTurns: [
        {
          turnId: 't1',
          message: 'Visible follow-up',
          enqueuedAt: '2026-11-16T00:00:00.000Z',
        },
        {
          turnId: 't2',
          message: 'secret internal prompt',
          enqueuedAt: '2026-11-16T00:01:00.000Z',
          userMessageVisibility: 'hidden',
        },
      ],
    }

    act(() => root.render(<RemoteQueuePanel snapshot={snapshot} />))

    expect(container.textContent).toContain('等待执行 · 2')
    expect(container.textContent).toContain('Visible follow-up')
    expect(container.textContent).toContain('内部任务自动执行')
    expect(container.textContent).not.toContain('secret internal prompt')
  })

  it('renders nothing when there are no queued turns', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    act(() =>
      root.render(<RemoteQueuePanel snapshot={{ sessionId, running: true, queuedTurns: [] }} />),
    )
    expect(container.querySelector('.rc-queue-panel')).toBeNull()
  })
})
