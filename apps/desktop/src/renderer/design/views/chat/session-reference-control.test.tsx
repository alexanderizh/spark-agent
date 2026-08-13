// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  requestSessionReferenceAdd,
  useSessionReferenceAddControl,
} from './session-reference-control'
import type { SessionReferenceDragPayload } from './session-reference-dnd'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness(props: {
  sessionId: string | null
  onAdd(payload: SessionReferenceDragPayload): void
}) {
  useSessionReferenceAddControl(props)
  return null
}

async function renderHarness(props: React.ComponentProps<typeof Harness>): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness {...props} />))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('session reference app control', () => {
  it('sends the selected session to the targeted composer', async () => {
    const onAdd = vi.fn()
    await renderHarness({ sessionId: 'chat-1', onAdd })
    const payload: SessionReferenceDragPayload = {
      sessionId: 'source-1',
      title: '源会话',
      turnCount: 4,
    }

    await expect(requestSessionReferenceAdd(payload, 'chat-1')).resolves.toBe(true)
    expect(onAdd).toHaveBeenCalledWith(payload)
  })

  it('does not deliver a request to another composer session', async () => {
    const onAdd = vi.fn()
    await renderHarness({ sessionId: 'chat-1', onAdd })

    await expect(
      requestSessionReferenceAdd({ sessionId: 'source-1', title: '源会话' }, 'chat-2'),
    ).resolves.toBe(false)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
