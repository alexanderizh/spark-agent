// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionGetWorkflowBindingResponse } from '@spark/protocol'

const harness = vi.hoisted(() => ({
  getBinding: vi.fn(),
  setBinding: vi.fn(),
  listWorkflows: vi.fn(),
}))

vi.mock('../../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke:
      channel === 'session:get-workflow-binding'
        ? harness.getBinding
        : channel === 'session:set-workflow-binding'
          ? harness.setBinding
          : harness.listWorkflows,
    loading: false,
    error: null,
  }),
  useIpcStream: vi.fn(),
}))

import { useSessionWorkflowBinding } from './useSessionWorkflowBinding'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe(props: { sessionId: string }): React.JSX.Element {
  const binding = useSessionWorkflowBinding(props.sessionId)
  return <div>{binding.state?.binding?.sessionId ?? 'empty'}</div>
}

describe('useSessionWorkflowBinding', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    harness.getBinding.mockReset()
    harness.setBinding.mockReset()
    harness.listWorkflows.mockReset().mockResolvedValue({ workflows: [] })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('ignores a stale binding response after switching sessions', async () => {
    const sessionA = deferred<SessionGetWorkflowBindingResponse>()
    const sessionB = deferred<SessionGetWorkflowBindingResponse>()
    harness.getBinding.mockImplementation(({ sessionId }: { sessionId: string }) =>
      sessionId === 'session-a' ? sessionA.promise : sessionB.promise,
    )

    await act(async () => root.render(<Probe sessionId="session-a" />))
    await act(async () => root.render(<Probe sessionId="session-b" />))
    await act(async () => sessionB.resolve(makeState('session-b')))
    expect(container.textContent).toBe('session-b')

    await act(async () => sessionA.resolve(makeState('session-a')))
    expect(container.textContent).toBe('session-b')
  })
})

function makeState(sessionId: string): SessionGetWorkflowBindingResponse {
  return {
    binding: {
      sessionId,
      bindingInstanceId: `binding-${sessionId}`,
      mode: 'inherit',
      workflowId: null,
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    },
    effective: {
      source: 'session-inherit',
      bindingInstanceId: `binding-${sessionId}`,
      hostAgentId: 'agent-a',
      workflowId: null,
      workflowName: null,
      workflowVersion: null,
      workflowStatus: null,
      workflowEnabled: null,
      executionMode: 'none',
    },
    resumableRun: null,
    canChange: true,
    changeBlockers: [],
    features: { writeEnabled: true, runtimeRequested: false, runtimeEnabled: false },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
