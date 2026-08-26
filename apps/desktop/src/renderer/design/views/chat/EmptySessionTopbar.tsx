import { useCallback } from 'react'
import type { SessionId, WorkspaceInfo } from '@spark/protocol'
import {
  Clock3,
  FolderOpen,
  MoreHorizontal,
  PanelRight,
  Server,
  SlidersHorizontal,
} from 'lucide-react'
import { ensureSessionScheduleSession } from './ChatViewUtils'
import { ChatTitlebarEnd, ChatTitlebarStart } from './ChatTitlebar'
import { ProjectOpenDropdown, TabbarIcon, TabbarTooltipButton } from './ChatToolbar'

type EmptySessionTopbarProps = {
  activeSessionId: SessionId | null
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceInfo | null
  showGitEnvPanel: boolean
  showInspector: boolean
  showConfigPanel: boolean
  showUnifiedPanel: boolean
  showSessionSchedule: boolean
  sessionScheduleEnabledCount: number
  onToggleGitEnvPanel: () => void
  onToggleInspector: () => void
  onToggleConfig: () => void
  onToggleUnifiedPanel: () => void
  onOpenInEditor: () => void
  /** 展开内置终端面板，供项目打开方式下拉新增「内置终端」选项 */
  onOpenInTerminal?: () => void
  onExpandSidebar?: () => void
  createSession: (workspaceId?: string | null) => Promise<SessionId | null>
  openSessionSchedule: (sessionId: SessionId) => void
  closeSessionSchedule: () => void
}

export function EmptySessionTopbar({
  activeSessionId,
  activeWorkspaceId,
  activeWorkspace,
  showGitEnvPanel,
  showInspector,
  showConfigPanel,
  showUnifiedPanel,
  showSessionSchedule,
  sessionScheduleEnabledCount,
  onToggleGitEnvPanel,
  onToggleInspector,
  onToggleConfig,
  onToggleUnifiedPanel,
  onOpenInEditor,
  onOpenInTerminal,
  onExpandSidebar,
  createSession,
  openSessionSchedule,
  closeSessionSchedule,
}: EmptySessionTopbarProps) {
  const toggleSessionSchedule = useCallback(() => {
    if (showSessionSchedule) {
      closeSessionSchedule()
      return
    }
    void ensureSessionScheduleSession({
      activeSessionId,
      activeWorkspaceId,
      createSession,
      openSessionSchedule,
    })
  }, [
    activeSessionId,
    activeWorkspaceId,
    closeSessionSchedule,
    createSession,
    openSessionSchedule,
    showSessionSchedule,
  ])

  return (
    <div
      className="chat-sidebar-topbar"
      onDoubleClick={() => {
        window.spark.invoke('window:maximize', {}).catch(() => {})
      }}
    >
      <ChatTitlebarStart {...(onExpandSidebar ? { onExpandSidebar } : {})} />
      <div className="chat-sidebar-topbar-actions">
        <TabbarTooltipButton
          title="环境信息"
          ariaLabel="环境信息"
          className={`icon-btn ${showGitEnvPanel ? 'active' : ''}`}
          onClick={onToggleGitEnvPanel}
        >
          <TabbarIcon icon={Server} />
        </TabbarTooltipButton>
        {activeWorkspace ? (
          <ProjectOpenDropdown
            rootPath={activeWorkspace.rootPath}
            onOpenInEditor={onOpenInEditor}
            {...(onOpenInTerminal ? { onOpenInTerminal } : {})}
          />
        ) : (
          <button
            className="icon-btn"
            title="请先选择项目文件夹"
            aria-label="请先选择项目文件夹"
            disabled
          >
            <TabbarIcon icon={FolderOpen} />
          </button>
        )}
        <TabbarTooltipButton
          title="计划任务"
          ariaLabel="计划任务"
          className={`icon-btn ${showSessionSchedule ? 'active' : ''}`}
          onClick={toggleSessionSchedule}
        >
          <span className="chat-session-schedule-icon">
            <TabbarIcon icon={Clock3} />
            {sessionScheduleEnabledCount > 0 && (
              <span className="chat-session-schedule-dot" aria-hidden="true" />
            )}
          </span>
        </TabbarTooltipButton>
        <button
          className={`icon-btn ${showInspector ? 'active' : ''}`}
          title="会话检查器"
          aria-label="会话检查器"
          onClick={onToggleInspector}
        >
          <TabbarIcon icon={PanelRight} />
        </button>
        <button
          className={`icon-btn ${showConfigPanel ? 'active' : ''}`}
          title={activeWorkspace ? '配置面板' : '请先选择项目文件夹'}
          aria-label="配置面板"
          disabled={!activeWorkspace}
          onClick={onToggleConfig}
        >
          <TabbarIcon icon={SlidersHorizontal} />
        </button>
        <button
          className={`icon-btn ${showUnifiedPanel ? 'active' : ''}`}
          title={activeWorkspace ? '统一侧边面板（终端/侧聊/审查/计划）' : '请先选择项目文件夹'}
          aria-label="统一侧边面板"
          disabled={!activeWorkspace}
          onClick={onToggleUnifiedPanel}
        >
          <TabbarIcon icon={MoreHorizontal} />
        </button>
      </div>
      <ChatTitlebarEnd />
    </div>
  )
}
