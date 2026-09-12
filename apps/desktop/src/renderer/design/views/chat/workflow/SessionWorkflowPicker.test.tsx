// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionGetWorkflowBindingResponse, WorkflowItem } from '@spark/protocol'

const harness = vi.hoisted(() => ({
  state: null as SessionGetWorkflowBindingResponse | null,
  workflows: [] as WorkflowItem[],
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
  update: vi.fn(),
  abandonRun: vi.fn(),
}))

vi.mock('./useSessionWorkflowBinding', () => ({
  useSessionWorkflowBinding: () => ({
    state: harness.state,
    workflows: harness.workflows,
    loading: harness.loading,
    saving: false,
    abandoning: false,
    error: harness.error,
    reload: harness.reload,
    update: harness.update,
    abandonRun: harness.abandonRun,
  }),
}))

import { SessionWorkflowPicker } from './SessionWorkflowPicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SessionWorkflowPicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    harness.update.mockReset()
    harness.reload.mockReset()
    harness.abandonRun.mockReset()
    harness.workflows = []
    harness.loading = false
    harness.error = null
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps an existing binding visible but read-only when writes are disabled', async () => {
    harness.state = makeState({
      writeEnabled: false,
      runtimeRequested: false,
      runtimeEnabled: false,
    })
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))

    const chip = container.querySelector<HTMLButtonElement>('.session-workflow-chip')
    expect(chip?.textContent).toContain('会话 · Workflow A')
    await act(async () => chip?.click())

    expect(container.textContent).toContain('当前挂载为只读，暂时不能修改。')
    expect(container.textContent).toContain('当前消息仍按 Agent 默认配置执行。')
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].every(
        (button) => button.disabled,
      ),
    ).toBe(true)
  })

  it('explains that a mention turn uses the member workflow', async () => {
    harness.state = makeState({
      writeEnabled: true,
      runtimeRequested: false,
      runtimeEnabled: false,
    })
    await act(async () =>
      root.render(<SessionWorkflowPicker sessionId="session-a" mentionActive />),
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-chip')?.click(),
    )

    expect(container.textContent).toContain('本条 @成员消息不应用会话工作流')
  })

  it('stays hidden for untouched sessions while the write feature is disabled', async () => {
    harness.state = {
      ...makeState({ writeEnabled: false, runtimeRequested: false, runtimeEnabled: false }),
      binding: null,
    }
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))

    expect(container.innerHTML).toBe('')
  })

  it('updates an enabled override and disables every option while the session is busy', async () => {
    harness.state = {
      ...makeState({ writeEnabled: true, runtimeRequested: false, runtimeEnabled: false }),
      canChange: false,
      changeBlockers: [{ code: 'turn_queue_not_empty' }],
    }
    harness.workflows = [
      {
        id: 'workflow-b',
        name: 'Workflow B',
        description: '',
        scope: 'global',
        tags: [],
        status: 'active',
        enabled: true,
        version: '2.0.0',
        graph: { nodes: [], edges: [] },
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      },
    ]
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-chip')?.click(),
    )

    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    expect(options).toHaveLength(3)
    expect(options.every((button) => button.disabled)).toBe(true)
    expect(container.textContent).toContain('仍有消息等待处理')

    harness.state = makeState({
      writeEnabled: true,
      runtimeRequested: false,
      runtimeEnabled: false,
    })
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))
    const workflowB = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes('Workflow B'))
    await act(async () => workflowB?.click())
    expect(harness.update).toHaveBeenCalledWith({
      mode: 'override',
      workflowId: 'workflow-b',
    })
  })

  it('does not show a rollback warning while the requested runtime is active', async () => {
    harness.state = makeState({
      writeEnabled: true,
      runtimeRequested: true,
      runtimeEnabled: true,
    })
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-chip')?.click(),
    )

    expect(container.textContent).not.toContain('当前消息仍按 Agent 默认配置执行')
  })

  it('shows a retry affordance when initial binding loading fails', async () => {
    harness.state = null
    harness.error = '读取失败'
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))

    const retry = container.querySelector<HTMLButtonElement>('.session-workflow-chip')
    expect(retry?.textContent).toContain('工作流状态加载失败，重试')
    await act(async () => retry?.click())
    expect(harness.reload).toHaveBeenCalledTimes(1)
  })

  it('requires a separate confirmation before abandoning a failed run', async () => {
    harness.state = {
      ...makeState({ writeEnabled: true, runtimeRequested: false, runtimeEnabled: false }),
      resumableRun: {
        id: 'run-1',
        workflowId: 'workflow-a',
        status: 'failed',
        objective: '首次尝试',
        startedAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:01.000Z',
        endedAt: '2026-09-12T00:00:01.000Z',
        graphDigest: 'digest',
      },
    }
    await act(async () => root.render(<SessionWorkflowPicker sessionId="session-a" />))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-chip')?.click(),
    )

    expect(container.textContent).toContain('上次运行失败，下一条 Host 消息将继续此运行')
    const abandon = container.querySelector<HTMLButtonElement>('.session-workflow-abandon')
    expect(abandon).not.toBeNull()
    // 单独确认：第一次点击只展开确认，不触发放弃。
    await act(async () => abandon?.click())
    expect(harness.abandonRun).not.toHaveBeenCalled()
    expect(container.textContent).toContain('确认放弃此运行？')

    const cancel = container.querySelector<HTMLButtonElement>('.session-workflow-abandon-cancel')
    await act(async () => cancel?.click())
    expect(container.textContent).not.toContain('确认放弃此运行？')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-abandon')?.click(),
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.session-workflow-abandon-accept')?.click(),
    )
    expect(harness.abandonRun).toHaveBeenCalledTimes(1)
  })
})

function makeState(
  features: SessionGetWorkflowBindingResponse['features'],
): SessionGetWorkflowBindingResponse {
  return {
    binding: {
      sessionId: 'session-a',
      bindingInstanceId: 'binding-a',
      mode: 'override',
      workflowId: 'workflow-a',
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    },
    effective: {
      source: 'session-override',
      bindingInstanceId: 'binding-a',
      hostAgentId: 'agent-a',
      workflowId: 'workflow-a',
      workflowName: 'Workflow A',
      workflowVersion: '1.0.0',
      workflowStatus: 'active',
      workflowEnabled: true,
      executionMode: 'workflow_run',
    },
    resumableRun: null,
    canChange: true,
    changeBlockers: [],
    features,
  }
}
