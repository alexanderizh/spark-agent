// @vitest-environment jsdom

import React, { act } from 'react'
import type { SessionId } from '@spark/protocol'
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

import { EmptySessionTopbar } from './EmptySessionTopbar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('EmptySessionTopbar session schedules', () => {
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

  const renderTopbar = (
    overrides: Partial<React.ComponentProps<typeof EmptySessionTopbar>> = {},
  ) => {
    const createSession = vi.fn(async () => 'created-session' as SessionId)
    const openSessionSchedule = vi.fn()
    act(() => {
      root.render(
        <EmptySessionTopbar
          activeSessionId={null}
          activeWorkspaceId="workspace-1"
          activeWorkspace={null}
          showGitEnvPanel={false}
          showInspector={false}
          showConfigPanel={false}
          showUnifiedPanel={false}
          showSessionSchedule={false}
          sessionScheduleEnabledCount={0}
          onToggleGitEnvPanel={() => undefined}
          onToggleInspector={() => undefined}
          onToggleConfig={() => undefined}
          onToggleUnifiedPanel={() => undefined}
          onOpenInEditor={() => undefined}
          createSession={createSession}
          openSessionSchedule={openSessionSchedule}
          closeSessionSchedule={() => undefined}
          {...overrides}
        />,
      )
    })
    return { createSession, openSessionSchedule }
  }

  it('creates a real session and opens the schedule panel from an empty session', async () => {
    const { createSession, openSessionSchedule } = renderTopbar()

    const button = container.querySelector<HTMLButtonElement>('[aria-label="计划任务"]')
    expect(button).not.toBeNull()
    await act(async () => button?.click())

    expect(createSession).toHaveBeenCalledWith('workspace-1')
    expect(openSessionSchedule).toHaveBeenCalledWith('created-session')
  })

  it('toggles the existing schedule panel without creating another session', () => {
    const closeSessionSchedule = vi.fn()
    const { createSession } = renderTopbar({
      activeSessionId: 'active-session' as SessionId,
      showSessionSchedule: true,
      closeSessionSchedule,
    })

    const button = container.querySelector<HTMLButtonElement>('[aria-label="计划任务"]')
    act(() => button?.click())

    expect(createSession).not.toHaveBeenCalled()
    expect(closeSessionSchedule).toHaveBeenCalledOnce()
  })
})
