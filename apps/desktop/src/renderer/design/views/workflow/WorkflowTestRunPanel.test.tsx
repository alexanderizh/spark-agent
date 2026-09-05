// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowTestRunPanel } from './WorkflowTestRunPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ipcMocks = vi.hoisted(() => ({
  startTestRun: vi.fn(),
  listRuns: vi.fn(),
  getRunDetail: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke:
      channel === 'workflow:test-run'
        ? ipcMocks.startTestRun
        : channel === 'workflow:runs'
          ? ipcMocks.listRuns
          : ipcMocks.getRunDetail,
  }),
}))

describe('WorkflowTestRunPanel', () => {
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
    vi.clearAllMocks()
  })

  it('shows the actionable workflow validation message returned by the test-run IPC', async () => {
    ipcMocks.startTestRun.mockRejectedValue(
      new Error(
        '工作流条件引用无效（主图的连线 route-full 引用了未声明的状态键「route_mode」）。请检查上游节点的 outputKey。',
      ),
    )

    await act(async () => {
      root.render(
        <WorkflowTestRunPanel
          workflowId="workflow-1"
          workflowDescription=""
          onClose={vi.fn()}
          onOpenSession={vi.fn()}
        />,
      )
    })

    await act(async () => {
      const startButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('开始试跑') === true,
      )
      startButton?.click()
    })

    expect(ipcMocks.startTestRun).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
    expect(container.querySelector('.wf-test-run-error')?.textContent).toContain('route_mode')
    expect(container.querySelector('.wf-test-run-error')?.textContent).toContain('outputKey')
    expect(container.textContent).not.toContain('操作未完成')
  })

  it('shows a concurrent-run CONFLICT message returned by the test-run IPC', async () => {
    const conflict = new Error(
      '已有运行中的工作流「发布流程」，请打开现有会话或等待它结束后再试。',
    ) as Error & { code: string }
    conflict.name = 'SparkIpcError:CONFLICT'
    conflict.code = 'CONFLICT'
    ipcMocks.startTestRun.mockRejectedValue(conflict)

    await act(async () => {
      root.render(
        <WorkflowTestRunPanel
          workflowId="workflow-1"
          workflowDescription=""
          onClose={vi.fn()}
          onOpenSession={vi.fn()}
        />,
      )
    })

    await act(async () => {
      const startButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('开始试跑') === true,
      )
      startButton?.click()
    })

    expect(container.querySelector('.wf-test-run-error')?.textContent).toContain(
      '已有运行中的工作流',
    )
  })
})
