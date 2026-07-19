// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasToolCallEvent } from '@spark/protocol'
import type { CanvasWorkspaceActions } from './canvas.tools'
import {
  useCanvasToolHost,
  type CanvasToolHostController,
  type CanvasToolHostOptions,
} from './canvas-tool-host'

const toolMocks = vi.hoisted(() => ({
  executeCanvasTool: vi.fn(async () => ({ ok: true, nodeId: 'node-1' })),
  getCanvasToolSchemas: vi.fn(() => []),
}))

vi.mock('./canvas.tools', () => toolMocks)

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: CanvasToolHostController | null = null
let toolCallListener: ((event: CanvasToolCallEvent) => void) | null = null
const invoke = vi.fn()
const unsubscribe = vi.fn()

const baseOptions: CanvasToolHostOptions = {
  sessionId: null,
  projectId: 'project-1',
  getSnapshot: () => null,
  workspace: {} as CanvasWorkspaceActions,
}

function Harness({ options }: { options: CanvasToolHostOptions }): null {
  const controller = useCanvasToolHost(options)
  useEffect(() => {
    latest = controller
  }, [controller])
  return null
}

function controller(): CanvasToolHostController {
  if (!latest) throw new Error('hook not mounted')
  return latest
}

beforeEach(() => {
  vi.clearAllMocks()
  latest = null
  toolCallListener = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  invoke.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn((channel: string, listener: (event: CanvasToolCallEvent) => void) => {
        if (channel === 'stream:canvas:tool-call') toolCallListener = listener
        return unsubscribe
      }),
    },
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => root?.render(<Harness options={baseOptions} />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useCanvasToolHost', () => {
  it('awaits attach and deduplicates repeated ensureAttached calls', async () => {
    await act(async () => {
      await Promise.all([
        controller().ensureAttached('session-1'),
        controller().ensureAttached('session-1'),
      ])
    })

    expect(controller().status).toBe('attached')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'canvas:host-attach')).toHaveLength(
      1,
    )
  })

  it('can receive a first-turn tool call after manual attach while the prop is still null', async () => {
    await act(async () => controller().ensureAttached('session-first-turn'))
    expect(toolCallListener).not.toBeNull()

    await act(async () => {
      toolCallListener?.({
        requestId: 'request-1',
        sessionId: 'session-first-turn',
        toolName: 'canvas_get_project_summary',
        args: {},
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toolMocks.executeCanvasTool).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('canvas:tool-ack', { requestId: 'request-1' })
    expect(invoke).toHaveBeenCalledWith(
      'canvas:tool-result',
      expect.objectContaining({ requestId: 'request-1', ok: true }),
    )
  })
})
