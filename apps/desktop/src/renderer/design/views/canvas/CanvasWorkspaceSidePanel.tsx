import { Segmented } from '@lobehub/ui'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icons } from '../../Icons'
import { downloadCanvasResource } from './CanvasAssetsPanel'
import { CanvasAssetManagerPanel } from './CanvasAssetManagerPanel'
import { CanvasInspector } from './CanvasInspector'
import { CanvasProjectInfoPanel } from './CanvasProjectInfoPanel'
import { CanvasTaskQueue, type CanvasTaskRetryRuntimeSource } from './CanvasTaskQueue'
import type {
  CanvasNode,
  CanvasNodeData,
  CanvasProjectSettings,
  CanvasSnapshot,
} from './canvas.types'

export type CanvasSidePanelTab = 'details' | 'tasks' | 'assets' | 'project'

type CanvasWorkspaceSidePanelProps = {
  snapshot: CanvasSnapshot
  selectedNodes: CanvasNode[]
  sidePanelCollapsed: boolean
  sidePanelWidth: number
  limits: {
    minWidth: number
    maxWidth: number
  }
  sidePanelTab: CanvasSidePanelTab
  assetDetailResetKey: number
  configuredPresetCount: number
  canCreateGroup: boolean
  canAddToGroup: boolean
  canRemoveFromGroup: boolean
  canDissolveGroup: boolean
  onResizeDefault: () => void
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onTabChange: (tab: CanvasSidePanelTab) => void
  onOpenHistory: () => void
  onOpenProjectFolder: () => Promise<void>
  onOpenTemplate: () => void
  onDuplicateSelected: () => void
  onToggleLock: () => void
  onBringToFront: () => void
  onCreateGroup: () => void
  onAddToGroup: () => void
  onRemoveFromGroup: () => void
  onDissolveGroup: () => void
  onPatchNode: (node: CanvasNode, patch: Partial<CanvasNode>) => void
  onPatchNodeData: (node: CanvasNode, data: Partial<CanvasNodeData>) => void
  onCancelTask: (taskId: string) => void
  onClearTasks: (scope: any) => void
  onDeleteTasks: (taskIds: string[]) => void
  onRetryTask: (task: any, runtimeSource: CanvasTaskRetryRuntimeSource) => void
  onRepollTask?: ((taskId: string) => void | Promise<void>) | undefined
  onSelectNode: (nodeId: string) => void
  onInsertAsset: (assetId: string) => void
  onInsertSubview: (ownerAsset: any, sourceImageAsset: any, subview: any) => void
  onOpenAssetDetail: () => void
  onRemoveAssetReferences: (assetIds: string[]) => Promise<void>
  onOpenPresetCenter: () => void
  onSaveProjectSettings: (settings: CanvasProjectSettings) => Promise<void>
  onSaveStyleBible: (styleBible: string) => Promise<void>
}

export function CanvasWorkspaceSidePanel({
  snapshot,
  selectedNodes,
  sidePanelCollapsed,
  sidePanelWidth,
  limits,
  sidePanelTab,
  assetDetailResetKey,
  configuredPresetCount,
  canCreateGroup,
  canAddToGroup,
  canRemoveFromGroup,
  canDissolveGroup,
  onResizeDefault,
  onResizeKeyDown,
  onResizePointerDown,
  onTabChange,
  onOpenHistory,
  onOpenProjectFolder,
  onOpenTemplate,
  onDuplicateSelected,
  onToggleLock,
  onBringToFront,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onDissolveGroup,
  onPatchNode,
  onPatchNodeData,
  onCancelTask,
  onClearTasks,
  onDeleteTasks,
  onRetryTask,
  onRepollTask,
  onSelectNode,
  onInsertAsset,
  onInsertSubview,
  onOpenAssetDetail,
  onRemoveAssetReferences,
  onOpenPresetCenter,
  onSaveProjectSettings,
  onSaveStyleBible,
}: CanvasWorkspaceSidePanelProps) {
  return (
    <>
      {!sidePanelCollapsed && (
        <aside className="canvas-side-panel" style={{ width: sidePanelWidth }}>
          <div
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={limits.maxWidth}
            aria-valuemin={limits.minWidth}
            aria-valuenow={sidePanelWidth}
            className="canvas-side-panel-resize-handle"
            onDoubleClick={onResizeDefault}
            onKeyDown={onResizeKeyDown}
            onPointerDown={onResizePointerDown}
            role="separator"
            tabIndex={0}
            title="拖拽调整面板宽度"
          />
          <div className="canvas-side-tabs">
            <Segmented
              value={sidePanelTab}
              onChange={(value) => onTabChange(value as CanvasSidePanelTab)}
              options={[
                { label: '属性', value: 'details' },
                { label: '任务', value: 'tasks' },
                { label: '资产', value: 'assets' },
                { label: '项目信息', value: 'project' },
              ]}
            />
          </div>
          <div className="canvas-side-panel-footer">
            <button type="button" className="canvas-side-utility-btn" onClick={onOpenHistory}>
              <Icons.Clock size={16} />
              <span>历史</span>
            </button>
            <button
              type="button"
              className="canvas-side-utility-btn"
              onClick={() => void onOpenProjectFolder()}
            >
              <Icons.Folder size={16} />
              <span>目录</span>
            </button>
            <button type="button" className="canvas-side-utility-btn" onClick={onOpenTemplate}>
              <Icons.Layers size={16} />
              <span>模板</span>
            </button>
          </div>
          {sidePanelTab === 'details' && (
            <div className="canvas-side-panel-content">
              <CanvasInspector
                selectedNodes={selectedNodes}
                nodes={snapshot.nodes}
                edges={snapshot.edges}
                assets={snapshot.assets}
                tasks={snapshot.tasks}
                onDuplicate={onDuplicateSelected}
                onToggleLock={onToggleLock}
                onBringToFront={onBringToFront}
                onCreateGroup={onCreateGroup}
                onAddToGroup={onAddToGroup}
                onRemoveFromGroup={onRemoveFromGroup}
                onDissolveGroup={onDissolveGroup}
                canCreateGroup={canCreateGroup}
                canAddToGroup={canAddToGroup}
                canRemoveFromGroup={canRemoveFromGroup}
                canDissolveGroup={canDissolveGroup}
                onPatchNode={onPatchNode}
                onPatchNodeData={onPatchNodeData}
              />
            </div>
          )}
          {sidePanelTab === 'tasks' && (
            <div className="canvas-side-panel-content">
              <CanvasTaskQueue
                boardId={snapshot.board.id}
                tasks={snapshot.tasks}
                nodes={snapshot.nodes}
                assets={snapshot.assets}
                onCancelTask={onCancelTask}
                onClearTasks={onClearTasks}
                onDeleteTasks={onDeleteTasks}
                onRetryTask={onRetryTask}
                onRepollTask={onRepollTask}
                onSelectNode={onSelectNode}
              />
            </div>
          )}
          {sidePanelTab === 'assets' && (
            <div className="canvas-side-panel-content">
              <CanvasAssetManagerPanel
                assets={snapshot.assets}
                nodes={snapshot.nodes}
                tasks={snapshot.tasks}
                onInsertAssets={(assetIds) => {
                  for (const assetId of assetIds) onInsertAsset(assetId)
                }}
                onInsertOne={onInsertAsset}
                onInsertSubview={onInsertSubview}
                onDownloadOne={(resource) => downloadCanvasResource(resource)}
                detailResetKey={assetDetailResetKey}
                onOpenDetail={onOpenAssetDetail}
                onRemoveReferences={onRemoveAssetReferences}
              />
            </div>
          )}
          {sidePanelTab === 'project' && (
            <div className="canvas-side-panel-content">
              <CanvasProjectInfoPanel
                key={`${snapshot.project.id}:${snapshot.project.updatedAt}:project-info`}
                project={snapshot.project}
                configuredPresetCount={configuredPresetCount}
                onOpenProjectFolder={onOpenProjectFolder}
                onOpenPresetCenter={onOpenPresetCenter}
                onSave={onSaveProjectSettings}
                onSaveStyleBible={(styleBible) => onSaveStyleBible(styleBible)}
              />
            </div>
          )}
        </aside>
      )}
    </>
  )
}
