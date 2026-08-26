import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { WindowControls } from '../../components/WindowControls'
import { CanvasToolbar } from './CanvasToolbar'
import type { CanvasAutoLayoutMode, CanvasAutoLayoutSpacing } from './canvasAutoLayout'
import type { CanvasWindowTheme } from './canvas-window-theme'

type CanvasWorkspaceChromeProps = {
  title: string
  nodeCount: number
  assetCount: number
  taskCount: number
  showSidebarExpandButton: boolean
  showWindowControls?: boolean
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
    columns?: number
  }) => Promise<void>
  onSave: () => void
  onRefresh: () => void
  onAutoSaveChange: (enabled: boolean) => void
  onExport: () => void
  onUploadFiles: () => void
  onOpenAgent: () => void
  windowTheme?: CanvasWindowTheme
  onWindowThemeChange?: (theme: CanvasWindowTheme) => void
}

export function CanvasWorkspaceChrome({
  title,
  nodeCount,
  assetCount,
  taskCount,
  showSidebarExpandButton,
  showWindowControls = false,
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
  windowTheme,
  onWindowThemeChange,
}: CanvasWorkspaceChromeProps) {
  return (
    <header
      className="canvas-workspace-header"
      onDoubleClick={() => {
        // 与主窗口各标题栏一致：双击拖拽区在最大化 / 还原间切换。
        window.spark?.invoke('window:maximize', {}).catch(() => {})
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
        nodeCount={nodeCount}
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
      {windowTheme != null && onWindowThemeChange != null ? (
        <div className="canvas-window-theme-switcher" role="group" aria-label="画布窗口主题">
          <button
            type="button"
            className={`canvas-window-theme-option${windowTheme === 'light' ? ' is-active' : ''}`}
            aria-label="浅色模式"
            aria-pressed={windowTheme === 'light'}
            title="浅色模式"
            onClick={() => onWindowThemeChange('light')}
          >
            <Icons.Sun size={14} />
          </button>
          <button
            type="button"
            className={`canvas-window-theme-option${windowTheme === 'dark' ? ' is-active' : ''}`}
            aria-label="暗色模式"
            aria-pressed={windowTheme === 'dark'}
            title="暗色模式"
            onClick={() => onWindowThemeChange('dark')}
          >
            <Icons.Moon size={14} />
          </button>
        </div>
      ) : null}
      {showWindowControls ? (
        <span className="canvas-workspace-window-controls">
          <WindowControls />
        </span>
      ) : null}
    </header>
  )
}
