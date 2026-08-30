// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgent, TeamModeConfig } from '@spark/protocol'
import { EmptySessionModeLauncher } from './EmptySessionModeLauncher'

const listTeamDefs = vi.fn(async () => ({ teams: [] }))

vi.mock('@lobehub/ui', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => <span /> }),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: listTeamDefs }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const agent = { id: 'host-a', name: 'Host A' } as ManagedAgent
const baseConfig: TeamModeConfig = {
  enabled: false,
  hostAgentId: agent.id,
  memberAgentIds: [],
  maxDepth: 1,
  allowNesting: false,
}

describe('EmptySessionModeLauncher', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    listTeamDefs.mockResolvedValue({ teams: [] })
    ;(window as unknown as { spark?: unknown }).spark = undefined
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the solo mode without a team selector by default', async () => {
    await act(async () => {
      root.render(
        <EmptySessionModeLauncher
          agents={[agent]}
          config={baseConfig}
          onUseSolo={() => {}}
          onUseEmptyTeamMode={() => {}}
          onApplyTeam={() => {}}
          onManageTeams={() => {}}
        />,
      )
    })

    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      'Agent',
    )
    expect(container.querySelector('.empty-session-team-trigger')).toBeNull()
  })

  it('shows the create-team action when team mode has no usable teams', async () => {
    await act(async () => {
      root.render(
        <EmptySessionModeLauncher
          agents={[agent]}
          config={{ ...baseConfig, enabled: true }}
          onUseSolo={() => {}}
          onUseEmptyTeamMode={() => {}}
          onApplyTeam={() => {}}
          onManageTeams={() => {}}
        />,
      )
    })

    expect(container.textContent).toContain('创建第一个团队')
    expect(container.querySelector('.empty-session-team-trigger')).toBeNull()
  })

  it('enters the explicit empty-team state instead of fabricating a team', async () => {
    const onUseEmptyTeamMode = vi.fn()
    await act(async () => {
      root.render(
        <EmptySessionModeLauncher
          agents={[agent]}
          config={baseConfig}
          onUseSolo={() => {}}
          onUseEmptyTeamMode={onUseEmptyTeamMode}
          onApplyTeam={() => {}}
          onManageTeams={() => {}}
        />,
      )
    })

    const teamButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ).find((button) => button.textContent === '团队')
    act(() => teamButton?.click())

    expect(onUseEmptyTeamMode).toHaveBeenCalledOnce()
  })
})
