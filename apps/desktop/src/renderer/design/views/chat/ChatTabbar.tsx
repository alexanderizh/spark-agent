import { useEffect, useRef, useState } from 'react'
import type {
  ManagedAgent,
  SessionRuntimeWorktree,
  TeamModeConfig,
  WorkspaceGitStatusResponse,
  WorkspaceInfo,
} from '@spark/protocol'
import {
  Clock3,
  Copy,
  MoreHorizontal,
  PanelRight,
  Server,
  SlidersHorizontal,
  Trash,
} from 'lucide-react'
import { Icons } from '../../Icons'
import { NO_PROJECT_WORKSPACE_NAME, type SessionSummary } from '../../SessionSidebarContext'
import type { OrchestrationSnapshot } from '../../services/event-mapper'
import { countExistingMembers } from '../../teamMembership'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import { GitSessionTrigger } from './ChatGitEnv'
import { resolveAgentDisplay } from './ChatHero'
import { ChatTitlebarEnd, ChatTitlebarStart } from './ChatTitlebar'
import { ProjectOpenDropdown, TabbarIcon, TabbarTooltipButton } from './ChatToolbar'

/**
 * 顶栏运行态 spinner 的隐藏延迟。
 * codex CLI 多 turn 会话里，每个 turn 结束都会发 agent_status(completed) 把 agentStatus
 * 清空成 ''，下个 turn 的 thinking 紧接着又填回。这个 turn 间隙会让 spinner 瞬时消失再
 * 重现，长会话累积后即“loading tag 没正常显示”。grace 在 agentStatus 变空时延迟隐藏、
 * 期间保留上一文案；turn 间隙通常远小于此值可无缝衔接，单 turn 真正结束时 spinner 会
 * 多亮一小段，属可接受折中。
 */
const AGENT_STATUS_GRACE_MS = 1500

export function ChatTabbar({
  session,
  workspace,
  agentStatus,
  stopTrigger,
  branchState,
  gitStatus,
  runtimeWorktree = null,
  isGitRepo,
  taskCount,
  taskCompletedCount,
  hasGoal,
  showGitEnvPanel,
  onToggleGitEnvPanel,
  showInspector,
  setShowInspector,
  showConfigPanel,
  onToggleConfig,
  showTerminalPanel,
  setShowTerminalPanel,
  showSideChatPanel,
  onToggleSideChat,
  showUnifiedPanel,
  onToggleUnifiedPanel,
  showSessionSchedule,
  sessionScheduleEnabledCount,
  onToggleSessionSchedule,
  teamConfig,
  orchestration,
  effectiveHostAgentId,
  agents,
  onClearMessages,
  clearWillStopRun = false,
  onCopyAllMessages,
  onExpandSidebar,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  /** 用户显式停止后绕过 spinner grace，立即清掉旧 turn 的展示状态。 */
  stopTrigger?: number
  branchState: BranchState
  gitStatus: WorkspaceGitStatusResponse | null
  /** 引擎级 worktree 状态（agent 上报）：分支以其为准并点亮 worktree 图标 */
  runtimeWorktree?: SessionRuntimeWorktree | null
  isGitRepo: boolean
  taskCount: number
  taskCompletedCount: number
  hasGoal: boolean
  showGitEnvPanel: boolean
  onToggleGitEnvPanel: () => void
  showInspector: boolean
  setShowInspector: (v: boolean) => void
  showConfigPanel: boolean
  onToggleConfig: () => void
  showTerminalPanel: boolean
  setShowTerminalPanel: (v: boolean) => void
  showSideChatPanel: boolean
  onToggleSideChat: () => void
  showUnifiedPanel: boolean
  onToggleUnifiedPanel: () => void
  showSessionSchedule: boolean
  sessionScheduleEnabledCount: number
  onToggleSessionSchedule: () => void
  teamConfig: TeamModeConfig
  orchestration: OrchestrationSnapshot | null
  effectiveHostAgentId: string | null
  agents: ManagedAgent[]
  onClearMessages?: () => void
  /** 会话正在运行：清空会强制终止执行器，确认条需要给出更重的提示 */
  clearWillStopRun?: boolean
  onCopyAllMessages?: () => void
  onExpandSidebar?: () => void
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // 顶栏 spinner grace：agentStatus 变空时延迟 AGENT_STATUS_GRACE_MS 再隐藏，
  // 期间保留上一文案，消除 codex CLI turn 边界的 spinner 闪烁。
  const [displayStatus, setDisplayStatus] = useState(agentStatus)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousStopTriggerRef = useRef(stopTrigger ?? 0)

  useEffect(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (agentStatus) {
      setDisplayStatus(agentStatus)
      return
    }
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setDisplayStatus('')
    }, AGENT_STATUS_GRACE_MS)
    return () => {
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [agentStatus])

  useEffect(() => {
    const previous = previousStopTriggerRef.current
    previousStopTriggerRef.current = stopTrigger ?? 0
    if ((stopTrigger ?? 0) === previous) return
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setDisplayStatus('')
  }, [stopTrigger])

  // 切换会话：立即清空，不带走上个会话的运行态
  const sessionId = session?.id
  const prevSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      setDisplayStatus('')
    }
  }, [sessionId])

  const handleClearClick = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirm = () => {
    setShowClearConfirm(false)
    onClearMessages?.()
  }
  const hostAgent = resolveAgentDisplay(agents, effectiveHostAgentId ?? teamConfig.hostAgentId)
  const memberCount = countExistingMembers(teamConfig.memberAgentIds, agents)
  const hostConfiguredModel = hostAgent?.modelId?.trim() || ''
  const inheritedSessionModel = session?.modelId?.trim() || ''
  const hostModel = hostConfiguredModel || inheritedSessionModel || '会话默认'
  const hostModelSource = hostConfiguredModel ? 'Agent 配置' : '沿用会话'
  const hostAdapter =
    hostAgent?.agentAdapter === 'codex'
      ? 'Codex'
      : hostAgent?.agentAdapter === 'claude'
        ? 'Claude CLI'
        : 'Claude SDK'

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
            {displayStatus && (
              <span className="msg-running">
                <Icons.Spinner size={11} /> {displayStatus}
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
                <span>Host：{hostAgent?.name ?? 'Spark助手'}</span>
              </button>
            )}
            {!teamConfig.enabled && orchestration != null && (
              <span
                className="chat-team-status-chip is-orchestration"
                title={`${orchestration.hostAgentName} 当前挂了可派发的工作流，本轮以委派为主（保留全部工具，提示词引导优先派发给 ${orchestration.memberCount} 个成员执行）。`}
              >
                <Icons.Workflow size={12} />
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
              runtimeWorktreeBranch: runtimeWorktree?.branch ?? null,
            })}
            worktreeHint={
              runtimeWorktree != null
                ? `运行在隔离 worktree${runtimeWorktree.branch ? ` · ${runtimeWorktree.branch}` : ''}`
                : null
            }
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
            {/* 运行中清空会强制终止执行器，确认条必须把这个后果说出来 */}
            <span className={`clear-confirm-text${clearWillStopRun ? ' danger' : ''}`}>
              {clearWillStopRun ? '正在运行，清空将终止任务？' : '确认清空？'}
            </span>
            <button
              className="btn ghost sm clear-confirm-cancel"
              style={{ background: 'none' }}
              onClick={() => setShowClearConfirm(false)}
            >
              取消
            </button>
            <button
              style={{ background: 'none', border: 0 }}
              className="btn sm danger-btn"
              onClick={handleClearConfirm}
            >
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
        <TabbarTooltipButton
          title="计划任务"
          ariaLabel="计划任务"
          className={`icon-btn ${showSessionSchedule ? 'active' : ''}`}
          onClick={onToggleSessionSchedule}
        >
          <span className="chat-session-schedule-icon">
            <TabbarIcon icon={Clock3} />
            {sessionScheduleEnabledCount > 0 && (
              <span className="chat-session-schedule-dot" aria-hidden="true" />
            )}
          </span>
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="配置面板（环境变量 / 提示词 / Skills / 工具）"
          ariaLabel="配置面板"
          className={`icon-btn ${showConfigPanel ? 'active' : ''}`}
          onClick={onToggleConfig}
        >
          <TabbarIcon icon={SlidersHorizontal} />
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="会话检查器"
          ariaLabel="会话检查器"
          className={`icon-btn ${showInspector ? 'active' : ''}`}
          onClick={() => setShowInspector(!showInspector)}
        >
          <TabbarIcon icon={PanelRight} />
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="统一侧边面板（终端 / 侧聊 / 审查 / 计划）"
          ariaLabel="统一侧边面板"
          className={`icon-btn ${showUnifiedPanel ? 'active' : ''}`}
          onClick={onToggleUnifiedPanel}
        >
          <TabbarIcon icon={MoreHorizontal} />
        </TabbarTooltipButton>
      </div>
      <ChatTitlebarEnd />
    </div>
  )
}
