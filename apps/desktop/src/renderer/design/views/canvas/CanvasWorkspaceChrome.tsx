import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { CanvasToolbar } from './CanvasToolbar'
import type { CanvasAutoLayoutMode, CanvasAutoLayoutSpacing } from './canvasAutoLayout'

type CanvasWorkspaceChromeProps = {
  title: string
  nodeCount: number
  assetCount: number
  taskCount: number
  showSidebarExpandButton: boolean
  saveState: {
    dirty: boolean
    saving: boolean
    autoSaving: boolean
    autoSaveEnabled: boolean
  }
  selectedCount: number
  arranging: boolean
  refreshing: boolean
  onBack: () => void
  onArrange: (options: {
    mode: CanvasAutoLayoutMode
    spacing: CanvasAutoLayoutSpacing
  }) => Promise<void>
  onSave: () => void
  onRefresh: () => void
  onAutoSaveChange: (enabled: boolean) => void
  onExport: () => void
  onUploadFiles: () => void
  onOpenAgent: () => void
}

export function CanvasWorkspaceChrome({
  title,
  nodeCount,
  assetCount,
  taskCount,
  showSidebarExpandButton,
  saveState,
  selectedCount,
  arranging,
  refreshing,
  onBack,
  onArrange,
  onSave,
  onRefresh,
  onAutoSaveChange,
  onExport,
  onUploadFiles,
  onOpenAgent,
}: CanvasWorkspaceChromeProps) {
  return (
    <header
      className="canvas-workspace-header"
      onDoubleClick={() => {
        if (window.spark?.platform === 'darwin') {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }
      }}
    >
      <div className="canvas-workspace-header-row">
        <div className="canvas-workspace-title">
          {showSidebarExpandButton && (
            <span className="canvas-workspace-sidebar-expand">
              <SidebarExpandButton />
            </span>
          )}
          <Button size="middle" type="text" icon={<Icons.ArrowLeft size={15} />} onClick={onBack}>
            项目
          </Button>
          <div className="canvas-workspace-heading">
            <h2>{title}</h2>
            <span className="canvas-workspace-meta">
              {nodeCount} 节点 / {assetCount} 素材 / {taskCount} 任务
            </span>
          </div>
        </div>
      </div>
      <CanvasToolbar
        saveState={saveState}
        selectedCount={selectedCount}
        arranging={arranging}
        onArrange={onArrange}
        onSave={onSave}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onAutoSaveChange={onAutoSaveChange}
        onExport={onExport}
        onUploadFiles={onUploadFiles}
        onOpenAgent={onOpenAgent}
      />
    </header>
  )
}
