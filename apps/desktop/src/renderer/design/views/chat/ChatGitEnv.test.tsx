// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitEnvPanel } from './ChatGitEnv'

vi.mock('@lobehub/ui', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('GitEnvPanel task progress', () => {
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

  it('renders ended incomplete tasks without a running spinner state', () => {
    act(() => {
      root.render(
        <GitEnvPanel
          status={null}
          branchState={{ currentBranch: null, branches: [] }}
          onClose={vi.fn()}
          onOpenCreateBranch={vi.fn()}
          onOpenCommit={vi.fn()}
          onOpenBranches={vi.fn()}
          onOpenReview={vi.fn()}
          onOpenTerminal={vi.fn()}
          tasks={[
            {
              id: '1',
              subject: '已完成步骤',
              status: 'completed',
              createdAt: 0,
            },
            {
              id: '2',
              subject: '未完成步骤',
              status: 'interrupted',
              createdAt: 1,
            },
          ]}
          goal={null}
          onGoalControl={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('已结束 · 1/2')
    expect(container.querySelector('.git-task-progress-item.running')).toBeNull()
    expect(container.querySelectorAll('.git-task-progress-item.pending')).toHaveLength(1)
  })
})
