import { useState } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  CanvasAddNodeMenu,
  CanvasDockAddDropdown,
  groupAddNodeItems,
  useAddNodeMenuItems,
  type AddNodeMenuItem,
} from './CanvasAddNodeMenu'
import type { CanvasTool } from './CanvasToolbar'

/**
 * 底部悬浮工具栏（文档 §7.5）。
 *
 * 节点创建约定：资源内容节点 / 任务节点 两类，悬停展开全部子类型。
 * 选择/平移、编辑、视图控制与其余工作台入口保持分组排列。
 */
export function CanvasBottomDock({
  activeTool,
  onToolChange,
  onAddNodeItem,
  onOpenAddMenu,
  onOpenFilmCenter,
  onOpenCharacterLibrary,
  onAddDirectorStage3D,
  onAddVideoWorkbench,
  onOpenAgent,
  onDeleteSelected,
  onUndo,
  onRedo,
  onFitView,
  onCenterSelected,
  onToggleGrid,
  onOpenShortcutHelp,
  gridVisible,
  selectedCount,
  canUndo,
  canRedo,
}: {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  onAddNodeItem: (item: AddNodeMenuItem) => void
  onOpenAddMenu: () => void
  onOpenFilmCenter: () => void
  onOpenCharacterLibrary: () => void
  /** 分镜导演台面板入口（保留 API 以兼容其他调用方；底部工具栏已改为 3D 导演台入口） */
  onOpenShotDirector?: () => void
  /** 底部工具栏「3D 导演台」入口：新建 3D 导演台节点并打开（2D 版走空白右键菜单） */
  onAddDirectorStage3D: () => void
  /** 底部工具栏「视频工作台」入口：新建视频工作台节点并打开 */
  onAddVideoWorkbench: () => void
  onOpenAgent: () => void
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
  onFitView: () => void
  onCenterSelected: () => void
  onToggleGrid: () => void
  onOpenShortcutHelp: () => void
  gridVisible: boolean
  selectedCount: number
  canUndo: boolean
  canRedo: boolean
}) {
  const items = useAddNodeMenuItems()
  const grouped = groupAddNodeItems(items)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const deleteTooltip = selectedCount > 0 ? `删除选中节点（${selectedCount}）` : '选择节点后可删除'
  const openAddMenu = () => {
    onOpenAddMenu()
    setAddMenuOpen(true)
  }
  const closeAddMenuAndRun = (action: () => void) => {
    setAddMenuOpen(false)
    action()
  }
  const handleAddNodeItem = (item: AddNodeMenuItem) => {
    setAddMenuOpen(false)
    onAddNodeItem(item)
  }

  return (
    <>
      {addMenuOpen && (
        <CanvasAddNodeMenu
          items={items}
          onSelect={handleAddNodeItem}
          onClose={() => setAddMenuOpen(false)}
        />
      )}
      <div className="canvas-bottom-dock">
        <div className="canvas-bottom-dock-group">
          <Tooltip title="选择 · Tab 切换" placement="top">
            <Button
              size="middle"
              type="text"
              className={activeTool === 'select' ? 'canvas-dock-tool-active' : ''}
              icon={<Icons.MousePointer size={15} />}
              aria-label="选择"
              onClick={() => onToolChange('select')}
            />
          </Tooltip>
          <Tooltip title="平移 · Tab 切换" placement="top">
            <Button
              size="middle"
              type="text"
              className={activeTool === 'pan' ? 'canvas-dock-tool-active' : ''}
              icon={<Icons.Hand size={15} />}
              aria-label="平移"
              onClick={() => onToolChange('pan')}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <CanvasDockAddDropdown
            label="添加资源内容节点"
            shortLabel="资源"
            icon={<Icons.FileText size={15} />}
            items={grouped.resource}
            onSelect={(item) => closeAddMenuAndRun(() => handleAddNodeItem(item))}
          />
          <CanvasDockAddDropdown
            label="添加任务节点"
            shortLabel="任务"
            icon={<Icons.Sparkles size={15} />}
            items={grouped.task}
            onSelect={(item) => closeAddMenuAndRun(() => handleAddNodeItem(item))}
          />
          <Tooltip title="全部节点类型" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Plus size={15} />}
              aria-label="全部节点类型"
              onClick={openAddMenu}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title="项目资产中心（剧本/角色/场景/道具/分镜/提示词库）" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Box size={15} />}
              aria-label="项目资产中心"
              onClick={() => closeAddMenuAndRun(onOpenFilmCenter)}
            />
          </Tooltip>
          <Tooltip title="角色库（角色卡 / 子视图 / 快速应用到画布）" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Users size={15} />}
              aria-label="角色库"
              onClick={() => closeAddMenuAndRun(onOpenCharacterLibrary)}
            />
          </Tooltip>
          <Tooltip title="3D 导演台（人偶 / 道具 / 取景相机 / 提示词）" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Film size={15} />}
              aria-label="3D 导演台"
              onClick={() => closeAddMenuAndRun(onAddDirectorStage3D)}
            />
          </Tooltip>
          <Tooltip title="视频工作台（关键帧提取 / 剪辑 / 转码）" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Video size={15} />}
              aria-label="视频工作台"
              onClick={() => closeAddMenuAndRun(onAddVideoWorkbench)}
            />
          </Tooltip>
          <Tooltip title="画布 Agent 助手（对话操作画布）" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Bot size={15} />}
              aria-label="画布 Agent 助手"
              onClick={() => closeAddMenuAndRun(onOpenAgent)}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title={deleteTooltip} placement="top">
            <Button
              size="middle"
              type="text"
              danger
              icon={<Icons.Trash size={15} />}
              aria-label="删除选中节点"
              disabled={selectedCount === 0}
              onClick={() => closeAddMenuAndRun(onDeleteSelected)}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title="适配全部节点" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Maximize size={15} />}
              aria-label="适配全部节点"
              onClick={() => closeAddMenuAndRun(onFitView)}
            />
          </Tooltip>
          <Tooltip
            title={selectedCount > 0 ? '回到选中节点中心' : '选择节点后回到中心'}
            placement="top"
          >
            <Button
              size="middle"
              type="text"
              icon={<Icons.Crosshair size={15} />}
              aria-label="回到选中节点中心"
              disabled={selectedCount === 0}
              onClick={() => closeAddMenuAndRun(onCenterSelected)}
            />
          </Tooltip>
          <Tooltip title={gridVisible ? '隐藏网格' : '显示网格'} placement="top">
            <Button
              size="middle"
              type={gridVisible ? 'primary' : 'text'}
              icon={<Icons.Grid size={15} />}
              onClick={onToggleGrid}
            />
          </Tooltip>
          <Tooltip title={canUndo ? '撤销上一步画布操作' : '暂无可撤销操作'} placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.RotateCcw size={15} />}
              aria-label="撤销"
              disabled={!canUndo}
              onClick={() => closeAddMenuAndRun(onUndo)}
            />
          </Tooltip>
          <Tooltip title={canRedo ? '重做上一步画布操作' : '暂无可重做操作'} placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.RotateCw size={15} />}
              aria-label="重做"
              disabled={!canRedo}
              onClick={() => closeAddMenuAndRun(onRedo)}
            />
          </Tooltip>
          <Tooltip title="画布帮助 / 快捷键" placement="top">
            <Button
              size="middle"
              type="text"
              icon={<Icons.HelpCircle size={15} />}
              aria-label="画布帮助 / 快捷键"
              onClick={() => closeAddMenuAndRun(onOpenShortcutHelp)}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-spacer" />
      </div>
    </>
  )
}
