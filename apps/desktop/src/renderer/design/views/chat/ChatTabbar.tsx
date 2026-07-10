import { useState } from 'react'
import type {
  ManagedAgent,
  TeamModeConfig,
  WorkspaceGitStatusResponse,
  WorkspaceInfo,
} from '@spark/protocol'
import { Copy, History, MoreHorizontal, PanelRight, Server, Trash } from 'lucide-react'
import { Icons } from '../../Icons'
import {
  NO_PROJECT_WORKSPACE_NAME,
  type SessionSummary,
} from '../../SessionSidebarContext'
import type { OrchestrationSnapshot } from '../../services/event-mapper'
import { countExistingMembers } from '../../teamMembership'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import { GitSessionTrigger } from './ChatGitEnv'
import { resolveAgentDisplay } from './ChatHero'
import { ChatTitlebarEnd, ChatTitlebarStart } from './ChatTitlebar'
import {
  ProjectOpenDropdown,
  TabbarIcon,
  TabbarTooltipButton,
} from './ChatToolbar'

export function ChatTabbar({
  session,
  workspace,
  agentStatus,
  branchState,
  gitStatus,
  isGitRepo,
  taskCount,
  taskCompletedCount,
  hasGoal,
  showGitEnvPanel,
  onToggleGitEnvPanel,
  showInspector,
  setShowInspector,
  showConfigPanel,
  setShowConfigPanel,
  showTerminalPanel,
  setShowTerminalPanel,
  showSideChatPanel,
  onToggleSideChat,
  showCheckpointTimeline,
  setShowCheckpointTimeline,
  checkpointEnabled,
  checkpointAvailable,
  teamConfig,
  orchestration,
  effectiveHostAgentId,
  agents,
  onClearMessages,
  onCopyAllMessages,
  onExpandSidebar,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  branchState: BranchState
  gitStatus: WorkspaceGitStatusResponse | null
  isGitRepo: boolean
  taskCount: number
  taskCompletedCount: number
  hasGoal: boolean
  showGitEnvPanel: boolean
  onToggleGitEnvPanel: () => void
  showInspector: boolean
  setShowInspector: (v: boolean) => void
  showConfigPanel: boolean
  setShowConfigPanel: (v: boolean) => void
  showTerminalPanel: boolean
  setShowTerminalPanel: (v: boolean) => void
  showSideChatPanel: boolean
  onToggleSideChat: () => void
  showCheckpointTimeline: boolean
  setShowCheckpointTimeline: (v: boolean) => void
  checkpointEnabled: boolean
  checkpointAvailable: boolean
  teamConfig: TeamModeConfig
  orchestration: OrchestrationSnapshot | null
  effectiveHostAgentId: string | null
  agents: ManagedAgent[]
  onClearMessages?: () => void
  onCopyAllMessages?: () => void
  onExpandSidebar?: () => void
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearClick = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirm = () => {
    setShowClearConfirm(false)
    onClearMessages?.()
  }
  const hostAgent = resolveAgentDisplay(agents, effectiveHostAgentId ?? teamConfig.hostAgentId)
  const memberCount = countExistingMembers(teamConfig.memberAgentIds, agents)

  return (
    <div
      className="chat-tabbar"
      onDoubleClick={() => {
        window.spark.invoke('window:maximize', {}).catch(() => {})
      }}
    >
      <ChatTitlebarStart {...(onExpandSidebar ? { onExpandSidebar } : {})} />
      <div className="chat-title-block">
        {session ? (
          <>
            <span className="chat-title truncate">{session.title || '新会话'}</span>
            <span className="chat-project-label truncate" title={workspace?.rootPath ?? '临时会话'}>
              <Icons.Folder size={10} />
              {workspace?.name === NO_PROJECT_WORKSPACE_NAME
                ? '临时会话'
                : (workspace?.name ?? '未归属项目')}
            </span>
            {agentStatus && (
              <span className="msg-running">
                <Icons.Spinner size={11} /> {agentStatus}
              </span>
            )}
            {teamConfig.enabled && (
              <button
                type="button"
                className="chat-team-status-chip"
                onClick={() => setShowInspector(true)}
                title="打开团队成员面板"
              >
                <Icons.Team size={12} />
                <span>团队模式</span>
                <span className="chat-team-status-divider" />
                <span>Host：{hostAgent?.name ?? '平台管理'}</span>
                <span>成员 {memberCount}</span>
              </button>
            )}
            {!teamConfig.enabled && orchestration != null && (
              <span
                className="chat-team-status-chip is-orchestration"
                title={`${orchestration.hostAgentName} 当前挂了可派发的工作流，本轮以委派为主（保留全部工具，提示词引导优先派发给 ${orchestration.memberCount} 个成员执行）。`}
              >
                <Icons.Workflow size={12} />
                <span>Workflow</span>
              </span>
            )}
          </>
        ) : (
          <span className="chat-title truncate muted">未选择会话</span>
        )}
      </div>
      <div className="row tabbar-actions">
        {isGitRepo || taskCount > 0 || taskCompletedCount > 0 || hasGoal ? (
          <GitSessionTrigger
            open={showGitEnvPanel}
            isGitRepo={isGitRepo}
            currentBranch={resolveDisplayedGitBranch({
              branchStateCurrentBranch: branchState.currentBranch,
              statusCurrentBranch: gitStatus?.currentBranch,
            })}
            additions={gitStatus?.additions ?? 0}
            deletions={gitStatus?.deletions ?? 0}
            taskCount={taskCount}
            taskCompletedCount={taskCompletedCount}
            hasGoal={hasGoal}
            onToggle={onToggleGitEnvPanel}
          />
        ) : (
          <TabbarTooltipButton
            title="环境信息"
            ariaLabel="环境信息"
            className="icon-btn"
            onClick={onToggleGitEnvPanel}
          >
            <TabbarIcon icon={Server} />
          </TabbarTooltipButton>
        )}
        {workspace && (
          <>
            <ProjectOpenDropdown rootPath={workspace.rootPath} />
          </>
        )}
        {showClearConfirm && onClearMessages && (
          <div className="clear-confirm-bar">
            <span className="clear-confirm-text">确认清空？</span>
            <button
              className="btn ghost sm clear-confirm-cancel"
              onClick={() => setShowClearConfirm(false)}
            >
              取消
            </button>
            <button className="btn sm danger-btn" onClick={handleClearConfirm}>
              清空
            </button>
          </div>
        )}
        {onCopyAllMessages && (
          <TabbarTooltipButton
            title="复制全部聊天记录"
            className="icon-btn"
            onClick={onCopyAllMessages}
          >
            <TabbarIcon icon={Copy} />
          </TabbarTooltipButton>
        )}
        {!showClearConfirm && onClearMessages && (
          <TabbarTooltipButton title="清空会话消息" className="icon-btn" onClick={handleClearClick}>
            <TabbarIcon icon={Trash} />
          </TabbarTooltipButton>
        )}
        {checkpointAvailable && (
          <TabbarTooltipButton
            title={
              checkpointEnabled
                ? '代码还原点（已开启：按轮记录已跟踪文件状态）'
                : '代码还原点（未开启）'
            }
            ariaLabel="代码还原点"
            className={`icon-btn checkpoint-entry ${showCheckpointTimeline ? 'active' : ''} ${checkpointEnabled ? 'checkpoint-on' : ''}`}
            onClick={() => setShowCheckpointTimeline(!showCheckpointTimeline)}
          >
            <TabbarIcon icon={History} />
          </TabbarTooltipButton>
        )}
        <TabbarTooltipButton
          title="会话检查器"
          ariaLabel="会话检查器"
          className={`icon-btn ${showInspector ? 'active' : ''}`}
          onClick={() => setShowInspector(!showInspector)}
        >
          <TabbarIcon icon={PanelRight} />
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="配置面板"
          ariaLabel="配置面板"
          className={`icon-btn ${showConfigPanel ? 'active' : ''}`}
          onClick={() => setShowConfigPanel(!showConfigPanel)}
        >
          <TabbarIcon icon={MoreHorizontal} />
        </TabbarTooltipButton>
      </div>
      <ChatTitlebarEnd />
    </div>
  )
}


