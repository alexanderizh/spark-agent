import { describe, expect, it } from 'vitest'
import type { ManagedTeam } from '@spark/protocol'
import {
  persistThenSyncTeamSelection,
  preserveExplicitEmptySessionTeamConfig,
  selectInitialTeam,
  shouldResetEmptySessionTeamTouched,
} from './emptySessionTeamMode'

const team = (id: string, hostAgentId: string, enabled = true): ManagedTeam =>
  ({ id, hostAgentId, enabled }) as ManagedTeam

describe('selectInitialTeam', () => {
  const validAgentIds = new Set(['host-a', 'host-b'])

  it('prefers the remembered valid team', () => {
    expect(
      selectInitialTeam(
        [team('team-a', 'host-a'), team('team-b', 'host-b')],
        'team-b',
        validAgentIds,
      )?.id,
    ).toBe('team-b')
  })

  it('falls back to the first enabled team with a valid host', () => {
    expect(
      selectInitialTeam(
        [team('disabled', 'host-a', false), team('broken', 'missing'), team('team-a', 'host-a')],
        'missing-team',
        validAgentIds,
      )?.id,
    ).toBe('team-a')
  })

  it('returns null when no usable team exists', () => {
    expect(selectInitialTeam([team('broken', 'missing')], undefined, validAgentIds)).toBeNull()
  })
})

describe('preserveExplicitEmptySessionTeamConfig', () => {
  it('保留用户已显式选择的空会话团队', () => {
    const current = {
      enabled: true,
      hostAgentId: 'host-a',
      memberAgentIds: ['member-a'],
      maxDepth: 1,
      allowNesting: false,
      maxDiscussionRounds: 6,
      enablePeerMessaging: false,
      teamId: 'team-a',
    }
    const fallback = { ...current, enabled: false, teamId: undefined }

    expect(preserveExplicitEmptySessionTeamConfig(current, fallback, true)).toBe(current)
  })

  it('保留用户在空会话显式选择的单 Agent 模式', () => {
    const current = {
      enabled: false,
      hostAgentId: 'selected-host',
      memberAgentIds: [],
      maxDepth: 1,
      allowNesting: false,
      maxDiscussionRounds: 6,
      enablePeerMessaging: false,
    }
    const fallback = { ...current, hostAgentId: 'valid-host' }

    expect(preserveExplicitEmptySessionTeamConfig(current, fallback, true)).toBe(current)
  })

  it('未显式选择时不继承刚离开的历史团队配置', () => {
    const current = {
      enabled: true,
      hostAgentId: 'historical-host',
      memberAgentIds: ['historical-member'],
      maxDepth: 1,
      allowNesting: false,
      maxDiscussionRounds: 6,
      enablePeerMessaging: false,
      teamId: 'historical-team',
    }
    const fallback = { ...current, enabled: false, teamId: undefined }

    expect(preserveExplicitEmptySessionTeamConfig(current, fallback, false)).toBe(fallback)
  })
})

describe('shouldResetEmptySessionTeamTouched', () => {
  it('离开历史会话进入空 composer 时清理临时选择', () => {
    expect(shouldResetEmptySessionTeamTouched('historical-session', null)).toBe(true)
  })

  it('空 composer 进入实际 session 时清理临时选择', () => {
    expect(shouldResetEmptySessionTeamTouched(null, 'created-session')).toBe(true)
  })

  it('active session 未变化时保留当前 touched 状态', () => {
    expect(shouldResetEmptySessionTeamTouched(null, null)).toBe(false)
  })
})

describe('persistThenSyncTeamSelection', () => {
  it('先持久化团队关联，再同步 Host 运行时', async () => {
    const calls: string[] = []

    await persistThenSyncTeamSelection(
      async () => {
        await Promise.resolve()
        calls.push('persist')
      },
      async () => {
        calls.push('runtime')
      },
    )

    expect(calls).toEqual(['persist', 'runtime'])
  })
})
