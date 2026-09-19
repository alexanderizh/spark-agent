/**
 * SidebarProjectFolderToggle — 项目/分组头文件夹开合图标。
 *
 * 折叠且组内存在运行中会话时，在图标右上角叠加 info 蓝脉冲角标（与会话行
 * `.session-badge-running` 同源的配色与节奏）；展开或无运行会话时退化为
 * 普通 FolderOpen / FolderClosed 图标。单个会话运行显示纯圆点，多个时
 * 徽标拉宽显示数量（`with-count`）。
 */
import { useMemo } from 'react'
import { Icons } from './Icons'
import type { SessionSummary } from './SessionSidebarContext'
import type { AgentStatusValue } from '@spark/protocol'

/** 与 SidebarSessionList.getSessionDisplayStatus 的 'running' 分支语义保持一致。 */
function isSessionRunning(status: string, agentStatus?: AgentStatusValue): boolean {
  if (agentStatus != null) return agentStatus === 'thinking' || agentStatus === 'calling_tool'
  return status === 'running'
}

export function ProjectFolderToggle({
  open,
  sessions,
  sessionAgentStatuses,
}: {
  open: boolean
  sessions: SessionSummary[]
  sessionAgentStatuses: Record<string, AgentStatusValue>
}) {
  const runningCount = useMemo(() => {
    let count = 0
    for (const s of sessions) {
      if (s.archivedAt != null) continue
      if (isSessionRunning(s.status, sessionAgentStatuses[s.id])) count += 1
    }
    return count
  }, [sessions, sessionAgentStatuses])

  const showBadge = !open && runningCount > 0
  return (
    <>
      {open ? (
        <Icons.FolderOpen className="chev" size={15} />
      ) : (
        <Icons.FolderClosed className="chev" size={15} />
      )}
      {showBadge && (
        <span
          className={`proj-running-badge${runningCount > 1 ? ' with-count' : ''}`}
          aria-hidden="true"
        >
          {runningCount > 1 ? runningCount : ''}
        </span>
      )}
    </>
  )
}
