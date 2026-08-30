import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dropdown } from '@lobehub/ui'
import type { ManagedAgent, ManagedTeam, TeamModeConfig } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { selectInitialTeam } from './emptySessionTeamMode'
import './EmptySessionModeLauncher.less'

const RECENT_TEAM_KEY = 'spark-agent:recent-empty-session-team'

export function EmptySessionModeLauncher({
  agents,
  config,
  activeTeamName,
  onUseSolo,
  onUseEmptyTeamMode,
  onApplyTeam,
  onManageTeams,
}: {
  agents: ManagedAgent[]
  config: TeamModeConfig
  activeTeamName?: string | null
  onUseSolo: () => void
  onUseEmptyTeamMode: () => void
  onApplyTeam: (team: ManagedTeam) => void
  onManageTeams: () => void
}) {
  const { invoke: listTeamDefs } = useIpcInvoke('team:list-defs')
  const [teams, setTeams] = useState<ManagedTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const validAgentIds = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const usableTeams = useMemo(
    () => teams.filter((team) => team.enabled !== false && validAgentIds.has(team.hostAgentId)),
    [teams, validAgentIds],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTeamDefs({})
      setTeams(result?.teams ?? [])
    } finally {
      setLoading(false)
    }
  }, [listTeamDefs])

  useEffect(() => {
    void refresh().catch(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'team') void refresh().catch(() => setLoading(false))
      }) ?? (() => {})
    )
  }, [refresh])

  const enableTeamMode = () => {
    const preferred = config.teamId ?? window.localStorage.getItem(RECENT_TEAM_KEY) ?? undefined
    const team = selectInitialTeam(teams, preferred, validAgentIds)
    if (team != null) {
      window.localStorage.setItem(RECENT_TEAM_KEY, team.id)
      onApplyTeam(team)
    } else {
      onUseEmptyTeamMode()
    }
  }

  const selectedTeam = usableTeams.find((team) => team.id === config.teamId)
  const teamLabel = activeTeamName ?? selectedTeam?.name ?? '选择团队'

  return (
    <div className="empty-session-mode-launcher" aria-label="新会话运行模式">
      <div className="empty-session-mode-segmented" role="radiogroup" aria-label="运行模式">
        <button
          type="button"
          role="radio"
          aria-checked={!config.enabled}
          className={!config.enabled ? 'is-active' : ''}
          onClick={onUseSolo}
        >
          Agent
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={config.enabled}
          className={config.enabled ? 'is-active' : ''}
          disabled={loading}
          onClick={enableTeamMode}
        >
          团队
        </button>
      </div>

      {config.enabled &&
        (usableTeams.length > 0 ? (
          <Dropdown
            menu={{ items: [] }}
            open={open}
            trigger={['click']}
            placement="bottomLeft"
            autoAdjustOverflow
            onOpenChange={setOpen}
            overlayClassName="empty-session-team-dropdown"
            popupRender={() => (
              <div className="empty-session-team-menu">
                {usableTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    className={team.id === config.teamId ? 'is-active' : ''}
                    onClick={() => {
                      setOpen(false)
                      window.localStorage.setItem(RECENT_TEAM_KEY, team.id)
                      onApplyTeam(team)
                    }}
                  >
                    <span className="empty-session-team-menu-icon">
                      <Icons.Team size={13} />
                    </span>
                    <span>{team.name}</span>
                    {team.id === config.teamId && <Icons.Check size={13} />}
                  </button>
                ))}
                <div className="empty-session-team-menu-divider" />
                <button type="button" onClick={onManageTeams}>
                  <Icons.Settings size={13} />
                  <span>管理团队</span>
                </button>
              </div>
            )}
          >
            <button type="button" className="empty-session-team-trigger">
              <span className="empty-session-team-trigger-icon">
                <Icons.Team size={13} />
              </span>
              <span className="empty-session-team-trigger-label">{teamLabel}</span>
              <Icons.ChevronDown size={12} />
            </button>
          </Dropdown>
        ) : (
          <button type="button" className="empty-session-team-create" onClick={onManageTeams}>
            <Icons.Plus size={13} />
            创建第一个团队
          </button>
        ))}
    </div>
  )
}
