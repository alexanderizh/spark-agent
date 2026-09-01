// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceSearchContentStreamPayload } from '@spark/protocol'
import { useWorkspaceSearch } from './useWorkspaceSearch'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const workspaceId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const sessionId = '00000000-0000-4000-8000-000000000003' as SessionId

type SearchState = ReturnType<typeof useWorkspaceSearch>

function Harness({ onState }: { onState: (state: SearchState) => void }): React.ReactElement {
  const state = useWorkspaceSearch({
    workspaceId,
    sessionId,
    mode: 'content',
    query: 'needle',
    caseSensitive: false,
    refreshToken: 0,
  })
  onState(state)
  return <span>{state.loading ? 'loading' : 'idle'}</span>
}

describe('useWorkspaceSearch', () => {
  let container: HTMLDivElement
  let root: Root | null
  const invoke = vi.fn()
  let streamHandler: ((payload: WorkspaceSearchContentStreamPayload) => void) | null

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = null
    streamHandler = null
    invoke.mockReset()
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: vi.fn(() => requestId),
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn(
          (_channel: string, handler: (payload: WorkspaceSearchContentStreamPayload) => void) => {
            streamHandler = handler
            return () => {}
          },
        ),
      },
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('Enter executes once and cancels the pending debounce scan', async () => {
    invoke.mockImplementation((channel: string, request: { requestId?: string }) => {
      if (channel === 'workspace-search:cancel') return Promise.resolve({ cancelled: true })
      return Promise.resolve({ requestId: request.requestId })
    })
    const state: { current?: SearchState } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => (state.current = current)} />)
    })

    await act(async () => {
      state.current?.runContentNow()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'workspace-search:content'),
    ).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith(
      'workspace-search:content',
      expect.objectContaining({ workspaceId, sessionId, requestId }),
    )

    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'workspace-search:content'),
    ).toHaveLength(1)
  })

  it('accepts stream batches that arrive before the invoke response resolves', async () => {
    let resolveContent: ((value: { requestId: string }) => void) | null = null
    invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace-search:cancel') return Promise.resolve({ cancelled: true })
      return new Promise<{ requestId: string }>((resolve) => {
        resolveContent = resolve
      })
    })
    const state: { current?: SearchState } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => (state.current = current)} />)
    })
    await act(async () => {
      state.current?.runContentNow()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      streamHandler?.({
        requestId,
        batch: [{ path: 'src/app.ts', line: 4, text: 'needle', column: 0, length: 6 }],
        done: false,
        truncated: false,
        cancelled: false,
      })
      streamHandler?.({
        requestId,
        batch: [],
        done: true,
        truncated: false,
        cancelled: false,
        stats: { filesScanned: 1, filesSearched: 1, matches: 1, elapsedMs: 3 },
      })
    })
    expect(state.current?.contentMatches).toHaveLength(1)
    expect(state.current?.loading).toBe(false)

    await act(async () => {
      resolveContent?.({ requestId })
      await Promise.resolve()
    })
    expect(state.current?.error).toBeNull()
  })
})
