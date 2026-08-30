// @vitest-environment jsdom

import React, { act } from 'react'
import type { SessionId } from '@spark/protocol'
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

describe('GitEnvPanel session collaboration', () => {
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

  it('reveals session collaboration details separately from the Git branch', () => {
    const props: React.ComponentProps<typeof GitEnvPanel> = {
      status: null,
      branchState: { currentBranch: 'master', branches: [] },
      onClose: vi.fn(),
      onOpenCreateBranch: vi.fn(),
      onOpenCommit: vi.fn(),
      onOpenBranches: vi.fn(),
      onOpenReview: vi.fn(),
      onOpenTerminal: vi.fn(),
      tasks: [],
      goal: null,
      onGoalControl: vi.fn(),
      collaboration: {
        lineage: {
          childSessionId: 'child-session' as SessionId,
          parentSessionId: 'parent-session' as SessionId,
          forkAnchorTurnId: null,
          forkCutoffSeq: 3,
          sourceTitleSnapshot: '主会话',
          childTitle: '协作会话',
          createdAt: '2026-08-16T00:00:00.000Z',
        },
        sourceAvailable: true,
        childLineages: [],
        onOpenSource: vi.fn(),
        onOpenChild: vi.fn(),
      },
    }

    act(() => {
      root.render(<GitEnvPanel {...props} />)
    })

    const collaborationButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('会话协作'),
    )
    expect(collaborationButton).not.toBeUndefined()

    act(() => collaborationButton?.click())

    expect(container.querySelector('.git-collaboration-dialog')).toBeNull()
    expect(document.body.querySelector('.git-collaboration-dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('独立会话')
    expect(document.body.textContent).toContain('Git 分支')
    expect(document.body.textContent).toContain('master')
    expect(document.body.textContent).toContain('主会话')

    act(() => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="关闭会话协作"]')?.click()
    })

    expect(document.body.querySelector('.git-collaboration-dialog')).toBeNull()
  })
})

describe('GitEnvPanel open-terminal running indicator', () => {
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

  function baseProps(): React.ComponentProps<typeof GitEnvPanel> {
    return {
      status: null,
      branchState: { currentBranch: 'master', branches: [] },
      onClose: vi.fn(),
      onOpenCreateBranch: vi.fn(),
      onOpenCommit: vi.fn(),
      onOpenBranches: vi.fn(),
      onOpenReview: vi.fn(),
      onOpenTerminal: vi.fn(),
      tasks: [],
      goal: null,
      onGoalControl: vi.fn(),
    }
  }

  it('hides the running dot when no terminal is active', () => {
    act(() => {
      root.render(<GitEnvPanel {...baseProps()} />)
    })

    expect(container.querySelector('.git-env-terminal-running-dot')).toBeNull()
    const terminalRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('打开终端'),
    )
    expect(terminalRow?.getAttribute('title')).toBeNull()
  })

  it('shows the theme-colored dot and hint title when terminals are running', () => {
    act(() => {
      root.render(<GitEnvPanel {...baseProps()} terminalRunningCount={2} />)
    })

    const dot = container.querySelector('.git-env-terminal-running-dot')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('aria-label')).toBe('终端运行中')
    const terminalRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('打开终端'),
    )
    expect(terminalRow?.getAttribute('title')).toContain('终端运行中 (2)')
  })
})
