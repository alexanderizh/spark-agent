// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowToolCallEvent } from '@spark/protocol'
import type { WorkflowToolContext } from './workflow.tools'
import {
  useWorkflowToolHost,
  type WorkflowToolHostController,
  type WorkflowToolHostOptions,
} from './workflow-tool-host'

const toolMocks = vi.hoisted(() => ({
  executeWorkflowTool: vi.fn(async (_ctx: WorkflowToolContext, _name: string, _input: unknown) => ({
    workflowId: 'wf-1',
    graph: { nodes: [], edges: [] },
  })),
  getWorkflowToolSchemas: vi.fn(() => []),
  READONLY_WORKFLOW_TOOL_NAMES: new Set<string>(['workflow_get_graph', 'workflow_validate']),
}))

vi.mock('./workflow.tools', () => toolMocks)

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: WorkflowToolHostController | null = null
let toolCallListener: ((event: WorkflowToolCallEvent) => void) | null = null
const invoke = vi.fn()
const unsubscribe = vi.fn()

const baseOptions: WorkflowToolHostOptions = {
  sessionId: null,
  context: {} as WorkflowToolContext,
}

function Harness({ options }: { options: WorkflowToolHostOptions }): null {
  const controller = useWorkflowToolHost(options)
  useEffect(() => {
    latest = controller
  }, [controller])
  return null
}

function controller(): WorkflowToolHostController {
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
      on: vi.fn((channel: string, listener: (event: WorkflowToolCallEvent) => void) => {
        if (channel === 'stream:workflow:tool-call') toolCallListener = listener
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

describe('useWorkflowToolHost', () => {
  it('awaits attach and deduplicates repeated ensureAttached calls', async () => {
    await act(async () => {
      await Promise.all([
        controller().ensureAttached('session-1'),
        controller().ensureAttached('session-1'),
      ])
    })

    expect(controller().status).toBe('attached')
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'workflow:host-attach'),
    ).toHaveLength(1)
  })

  it('sends tool schemas once at attach time', async () => {
    await act(async () => controller().ensureAttached('session-1'))
    expect(toolMocks.getWorkflowToolSchemas).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(
      'workflow:host-attach',
      expect.objectContaining({ sessionId: 'session-1', toolSchemas: [] }),
    )
  })

  it('can receive a first-turn tool call after manual attach while the prop is still null', async () => {
    await act(async () => controller().ensureAttached('session-first-turn'))
    expect(toolCallListener).not.toBeNull()

    await act(async () => {
      toolCallListener?.({
        requestId: 'request-1',
        sessionId: 'session-first-turn',
        toolName: 'workflow_get_graph',
        args: {},
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toolMocks.executeWorkflowTool).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('workflow:tool-ack', { requestId: 'request-1' })
    expect(invoke).toHaveBeenCalledWith(
      'workflow:tool-result',
      expect.objectContaining({ requestId: 'request-1', ok: true }),
    )
  })

  it('reports tool failures back as ok:false with the error message', async () => {
    toolMocks.executeWorkflowTool.mockRejectedValueOnce(new Error('工作流编辑器尚未就绪'))

    await act(async () => controller().ensureAttached('session-error'))
    await act(async () => {
      toolCallListener?.({
        requestId: 'error-request-1',
        sessionId: 'session-error',
        toolName: 'workflow_get_graph',
        args: {},
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith(
      'workflow:tool-result',
      expect.objectContaining({
        requestId: 'error-request-1',
        ok: false,
        error: '工作流编辑器尚未就绪',
      }),
    )
  })

  it('ignores tool calls for sessions other than the attached one', async () => {
    await act(async () => controller().ensureAttached('session-bound'))
    await act(async () => {
      toolCallListener?.({
        requestId: 'other-request-1',
        sessionId: 'session-other',
        toolName: 'workflow_get_graph',
        args: {},
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toolMocks.executeWorkflowTool).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith(
      'workflow:tool-result',
      expect.objectContaining({ requestId: 'other-request-1' }),
    )
  })

  it('forwards the latest tool context without reattaching', async () => {
    await act(async () => controller().ensureAttached('session-ctx'))
    const nextContext = { getEditorState: vi.fn(() => null) } as unknown as WorkflowToolContext
    act(() =>
      root?.render(<Harness options={{ sessionId: 'session-ctx', context: nextContext }} />),
    )

    await act(async () => {
      toolCallListener?.({
        requestId: 'ctx-request-1',
        sessionId: 'session-ctx',
        toolName: 'workflow_get_graph',
        args: {},
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toolMocks.executeWorkflowTool).toHaveBeenCalledTimes(1)
    expect(toolMocks.executeWorkflowTool.mock.calls.at(-1)?.[0]).toBe(nextContext)
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'workflow:host-attach'),
    ).toHaveLength(1)
  })
})
