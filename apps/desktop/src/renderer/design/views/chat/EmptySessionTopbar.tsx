import { useCallback } from 'react'
import type { SessionId, WorkspaceInfo } from '@spark/protocol'
import {
  Clock3,
  FolderOpen,
  PanelRight,
  PanelsTopLeft,
  Server,
  SlidersHorizontal,
} from 'lucide-react'
import { ensureSessionScheduleSession } from './ChatViewUtils'
import { ChatTitlebarEnd, ChatTitlebarStart } from './ChatTitlebar'
import { ProjectOpenDropdown, TabbarIcon, TabbarTooltipButton } from './ChatToolbar'
import { ChatHeaderOverflowMenu } from './ChatHeaderOverflowMenu'

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

  const overflowItems = [
    {
      id: 'schedule',
      label: '计划任务',
      icon: Clock3,
      onSelect: toggleSessionSchedule,
      active: showSessionSchedule,
      indicator: sessionScheduleEnabledCount > 0,
    },
    {
      id: 'inspector',
      label: '会话检查器',
      icon: PanelRight,
      onSelect: onToggleInspector,
      active: showInspector,
    },
    {
      id: 'config',
      label: '配置面板',
      icon: SlidersHorizontal,
      onSelect: onToggleConfig,
      active: showConfigPanel,
      disabled: !activeWorkspace,
    },
    {
      id: 'unified-panel',
      label: '统一侧边面板',
      icon: PanelsTopLeft,
      onSelect: onToggleUnifiedPanel,
      active: showUnifiedPanel,
      disabled: !activeWorkspace,
    },
  ]

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
          <TabbarTooltipButton
            title="请先选择项目文件夹"
            ariaLabel="请先选择项目文件夹"
            className="icon-btn"
            disabled
          >
            <TabbarIcon icon={FolderOpen} />
          </TabbarTooltipButton>
        )}
        {/* 空会话顶栏按钮岛更窄：溢出菜单出现时（540px 档）清单内按钮整体并入菜单 */}
        <TabbarTooltipButton
          title="计划任务"
          ariaLabel="计划任务"
          className={`icon-btn chat-header-collapsible ${showSessionSchedule ? 'active' : ''}`}
          onClick={toggleSessionSchedule}
        >
          <span className="chat-session-schedule-icon">
            <TabbarIcon icon={Clock3} />
            {sessionScheduleEnabledCount > 0 && (
              <span className="chat-session-schedule-dot" aria-hidden="true" />
            )}
          </span>
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="会话检查器"
          ariaLabel="会话检查器"
          className={`icon-btn chat-header-collapsible ${showInspector ? 'active' : ''}`}
          onClick={onToggleInspector}
        >
          <TabbarIcon icon={PanelRight} />
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title={activeWorkspace ? '配置面板' : '请先选择项目文件夹'}
          ariaLabel="配置面板"
          className={`icon-btn chat-header-collapsible ${showConfigPanel ? 'active' : ''}`}
          disabled={!activeWorkspace}
          onClick={onToggleConfig}
        >
          <TabbarIcon icon={SlidersHorizontal} />
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title={
            activeWorkspace ? '统一侧边面板（终端/侧聊/审查/计划）' : '请先选择项目文件夹'
          }
          ariaLabel="统一侧边面板"
          className={`icon-btn chat-header-collapsible ${showUnifiedPanel ? 'active' : ''}`}
          disabled={!activeWorkspace}
          onClick={onToggleUnifiedPanel}
        >
          <TabbarIcon icon={PanelsTopLeft} />
        </TabbarTooltipButton>
        <ChatHeaderOverflowMenu items={overflowItems} />
      </div>
      <ChatTitlebarEnd />
    </div>
  )
}
