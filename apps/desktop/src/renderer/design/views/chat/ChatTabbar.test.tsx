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

describe('ChatTabbar agentStatus grace', () => {
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
    vi.useRealTimers()
  })

  const baseProps = (agentStatus: string) => ({
    session: { id: 'session-1', title: 'Session', modelId: null } as never,
    workspace: null,
    agentStatus,
    branchState: {} as never,
    gitStatus: null,
    isGitRepo: false,
    taskCount: 0,
    taskCompletedCount: 0,
    hasGoal: false,
    showGitEnvPanel: false,
    onToggleGitEnvPanel: () => undefined,
    showInspector: false,
    setShowInspector: () => undefined,
    showConfigPanel: false,
    onToggleConfig: () => undefined,
    showTerminalPanel: false,
    setShowTerminalPanel: () => undefined,
    showSideChatPanel: false,
    onToggleSideChat: () => undefined,
    showUnifiedPanel: false,
    onToggleUnifiedPanel: () => undefined,
    teamConfig: { enabled: false, hostAgentId: '', memberAgentIds: [] } as never,
    orchestration: null,
    effectiveHostAgentId: null,
    agents: [],
    showSessionSchedule: false,
    sessionScheduleEnabledCount: 0,
    onToggleSessionSchedule: () => undefined,
  })

  const spinner = () => container.querySelector('.msg-running')

  it('agentStatus 变空时 spinner 在 grace 期内保留上一文案，超时后才隐藏', () => {
    vi.useFakeTimers()
    act(() => {
      root.render(<ChatTabbar {...baseProps('思考中')} />)
    })
    expect(spinner()?.textContent).toContain('思考中')

    // codex CLI turn 结束：agentStatus 被清空，但 grace 期内 spinner 不应立即消失
    act(() => {
      root.render(<ChatTabbar {...baseProps('')} />)
    })
    expect(spinner()).not.toBeNull()
    expect(spinner()?.textContent).toContain('思考中')

    // 超过 grace 才真正隐藏
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(spinner()).toBeNull()
  })

  it('grace 期内下个 turn 的 agentStatus 重新变非空，spinner 不中断地切换文案', () => {
    vi.useFakeTimers()
    act(() => {
      root.render(<ChatTabbar {...baseProps('思考中')} />)
    })
    act(() => {
      root.render(<ChatTabbar {...baseProps('')} />)
    })
    // 下个 turn 的 thinking 紧接着到达，grace 被取消
    act(() => {
      root.render(<ChatTabbar {...baseProps('调用工具')} />)
    })
    expect(spinner()?.textContent).toContain('调用工具')
    // 推进到原 grace 超时点之后，已取消的定时器不应再触发隐藏
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(spinner()?.textContent).toContain('调用工具')
  })

  it('切换会话立即清空运行态，不残留上个会话的 spinner', () => {
    vi.useFakeTimers()
    act(() => {
      root.render(<ChatTabbar {...baseProps('思考中')} />)
    })
    expect(spinner()).not.toBeNull()
    act(() => {
      root.render(
        <ChatTabbar
          {...baseProps('思考中')}
          session={{ id: 'session-2', title: 'Other', modelId: null } as never}
        />,
      )
    })
    expect(spinner()).toBeNull()
  })
})
