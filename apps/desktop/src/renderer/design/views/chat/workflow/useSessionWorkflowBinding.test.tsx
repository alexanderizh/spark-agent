// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionGetWorkflowBindingResponse } from '@spark/protocol'

const harness = vi.hoisted(() => ({
  getBinding: vi.fn(),
  setBinding: vi.fn(),
  listWorkflows: vi.fn(),
  abandonRun: vi.fn(),
}))

vi.mock('../../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke:
      channel === 'session:get-workflow-binding'
        ? harness.getBinding
        : channel === 'session:set-workflow-binding'
          ? harness.setBinding
          : channel === 'session:abandon-workflow-run'
            ? harness.abandonRun
            : harness.listWorkflows,
    loading: false,
    error: null,
  }),
  useIpcStream: vi.fn(),
}))

import { useSessionWorkflowBinding } from './useSessionWorkflowBinding'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let latestAbandon: (() => Promise<void>) | null = null

function Probe(props: { sessionId: string }): React.JSX.Element {
  const binding = useSessionWorkflowBinding(props.sessionId)
  latestAbandon = binding.abandonRun
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
    harness.abandonRun.mockReset()
    latestAbandon = null
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

  it('abandons the failed run with the observed generation and refreshes on conflict', async () => {
    const failedState: SessionGetWorkflowBindingResponse = {
      ...makeState('session-a'),
      binding: {
        sessionId: 'session-a',
        bindingInstanceId: 'binding-gen-1',
        mode: 'override',
        workflowId: 'workflow-a',
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      },
      resumableRun: {
        id: 'run-1',
        workflowId: 'workflow-a',
        status: 'failed',
        objective: '首次尝试',
        startedAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:01.000Z',
        endedAt: '2026-09-12T00:00:01.000Z',
      },
    }
    harness.getBinding.mockResolvedValue(failedState)
    const request = {
      sessionId: 'session-a',
      expectedBindingInstanceId: 'binding-gen-1',
      runId: 'run-1',
    }

    await act(async () => root.render(<Probe sessionId="session-a" />))

    // 冲突时重新读取主进程状态，而不是沿用本地旧视图。
    harness.abandonRun.mockResolvedValueOnce({
      binding: failedState.binding,
      effective: failedState.effective,
      resumableRun: failedState.resumableRun,
      abandonedRunId: null,
      changed: false,
      error: { code: 'binding_conflict' },
    })
    harness.getBinding.mockClear()
    await act(async () => latestAbandon?.())
    expect(harness.abandonRun).toHaveBeenCalledWith(request)
    expect(harness.getBinding).toHaveBeenCalledTimes(1)

    // 重读后仍是同一失败 Run，再次放弃成功，本地状态切到新代次。
    harness.abandonRun.mockResolvedValueOnce({
      binding: { ...failedState.binding!, bindingInstanceId: 'binding-gen-2' },
      effective: failedState.effective,
      resumableRun: null,
      abandonedRunId: 'run-1',
      changed: true,
      error: null,
    })
    await act(async () => latestAbandon?.())
    expect(harness.abandonRun).toHaveBeenCalledTimes(2)

    // 成功后没有可放弃的 Run，再调用是 no-op，不发起 IPC。
    harness.abandonRun.mockClear()
    await act(async () => latestAbandon?.())
    expect(harness.abandonRun).not.toHaveBeenCalled()
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
