import { describe, expect, it } from 'vitest'
import type { ManagedTeam } from '@spark/protocol'
import {
  persistThenSyncTeamSelection,
  preserveExplicitEmptySessionTeamConfig,
  selectInitialTeam,
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

    expect(preserveExplicitEmptySessionTeamConfig(current, fallback)).toBe(current)
  })

  it('未开启团队时仍允许刷新默认 Agent 配置', () => {
    const current = {
      enabled: false,
      hostAgentId: 'stale-host',
      memberAgentIds: [],
      maxDepth: 1,
      allowNesting: false,
      maxDiscussionRounds: 6,
      enablePeerMessaging: false,
    }
    const fallback = { ...current, hostAgentId: 'valid-host' }

    expect(preserveExplicitEmptySessionTeamConfig(current, fallback)).toBe(fallback)
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
