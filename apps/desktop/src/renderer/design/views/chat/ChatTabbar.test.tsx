// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ChatTitlebar', () => ({
  ChatTitlebarStart: () => <div />,
  ChatTitlebarEnd: () => <div />,
}))
vi.mock('./ChatToolbar', () => ({
  ProjectOpenDropdown: () => null,
  TabbarIcon: ({ icon: Icon }: { icon: React.ComponentType<{ size?: number }> }) => (
    <Icon size={14} />
  ),
  TabbarTooltipButton: ({
    children,
    ariaLabel,
    onClick,
    className,
  }: {
    children: React.ReactNode
    ariaLabel?: string
    onClick?: () => void
    className?: string
  }) => (
    <button aria-label={ariaLabel} className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock('./ChatGitEnv', () => ({ GitSessionTrigger: () => null }))
vi.mock('./ChatHero', () => ({ resolveAgentDisplay: () => null }))
vi.mock('../../teamMembership', () => ({ countExistingMembers: () => 0 }))
vi.mock('../chat-session-routing', () => ({ resolveDisplayedGitBranch: () => null }))

import { ChatTabbar } from './ChatTabbar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ChatTabbar session schedules', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: vi.fn(async () => ({})) },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the current session schedule panel from the clock button', () => {
    const onToggleSessionSchedule = vi.fn()
    act(() => {
      root.render(
        <ChatTabbar
          session={{ id: 'session-1', title: 'Session', modelId: null } as never}
          workspace={null}
          agentStatus=""
          branchState={{} as never}
          gitStatus={null}
          isGitRepo={false}
          taskCount={0}
          taskCompletedCount={0}
          hasGoal={false}
          showGitEnvPanel={false}
          onToggleGitEnvPanel={() => undefined}
          showInspector={false}
          setShowInspector={() => undefined}
          showConfigPanel={false}
          onToggleConfig={() => undefined}
          showTerminalPanel={false}
          setShowTerminalPanel={() => undefined}
          showSideChatPanel={false}
          onToggleSideChat={() => undefined}
          showUnifiedPanel={false}
          onToggleUnifiedPanel={() => undefined}
          teamConfig={{ enabled: false, hostAgentId: '', memberAgentIds: [] } as never}
          orchestration={null}
          effectiveHostAgentId={null}
          agents={[]}
          showSessionSchedule={false}
          sessionScheduleEnabledCount={2}
          onToggleSessionSchedule={onToggleSessionSchedule}
        />,
      )
    })

    const button = container.querySelector<HTMLButtonElement>('[aria-label="计划任务"]')
    expect(button).not.toBeNull()
    expect(button?.querySelector('.chat-session-schedule-dot')).not.toBeNull()
    act(() => button?.click())
    expect(onToggleSessionSchedule).toHaveBeenCalledOnce()
  })
})
