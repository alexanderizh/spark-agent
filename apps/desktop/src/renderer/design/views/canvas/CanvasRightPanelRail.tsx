import { Icons } from '../../Icons'

type CanvasRightPanelRailProps = {
  agentOpen: boolean
  workspacePanelOpen: boolean
  onToggleAgent: () => void
  onToggleWorkspacePanel: () => void
}

type PanelSwitchProps = {
  accent: 'agent' | 'workspace'
  accessibleName: string
  open: boolean
  onClick: () => void
  shortcut?: string
}

function PanelSwitch({ accent, accessibleName, open, onClick, shortcut }: PanelSwitchProps) {
  const action = open ? '收起' : '展开'
  const Icon = accent === 'agent' ? Icons.Agent : Icons.PanelRight

  return (
    <button
      type="button"
      className={`canvas-right-panel-switch is-${accent}${open ? ' is-open' : ''}`}
      onClick={onClick}
      aria-label={`${action}${accessibleName}`}
      aria-pressed={open}
      aria-keyshortcuts={shortcut}
      title={`${action}${accessibleName}`}
    >
      <span aria-hidden="true">
        <Icon size={16} />
      </span>
    </button>
  )
}

export function CanvasRightPanelRail({
  agentOpen,
  workspacePanelOpen,
  onToggleAgent,
  onToggleWorkspacePanel,
}: CanvasRightPanelRailProps) {
  return (
    <div className="canvas-right-panel-rail" role="toolbar" aria-label="右侧面板控制">
      <PanelSwitch
        accent="agent"
        accessibleName="画布助手"
        open={agentOpen}
        onClick={onToggleAgent}
      />
      <PanelSwitch
        accent="workspace"
        accessibleName="工作面板"
        open={workspacePanelOpen}
        onClick={onToggleWorkspacePanel}
        shortcut="Meta+Backslash Control+Backslash"
      />
    </div>
  )
}
