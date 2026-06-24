import { useState } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { CanvasAddNodeMenu, useAddNodeMenuItems, type AddNodeMenuItem } from './CanvasAddNodeMenu'
import type { CanvasTool } from './CanvasToolbar'

/**
 * 底部悬浮工具栏（文档 §7.5）。
 *
 * 把高频创作动作从顶部按钮条迁到底部悬浮区，按组组织：
 *   - 工具：选择 / 平移
 *   - 添加：文本 / 图片 / 组 + 节点工厂（更多类型）
 *   - AI：快速发起常用 AI 操作
 *   - 编辑：删除选中节点
 *   - 视图：适配屏幕 / 回到中心 / 网格开关
 *
 * 底部工具栏保持常驻，关键工作台以最大化浮层承载，避免用户误收起后找不到入口。
 */
export function CanvasBottomDock({
  activeTool,
  onToolChange,
  onAddNodeItem,
  onOpenAddMenu,
  onOpenAiComposer,
  onOpenFilmCenter,
  onOpenShotDirector,
  onOpenAgent,
  onDeleteSelected,
  onUndo,
  onRedo,
  onFitView,
  onCenterSelected,
  onToggleGrid,
  gridVisible,
  selectedCount,
  canUndo,
  canRedo,
}: {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  onAddNodeItem: (item: AddNodeMenuItem) => void
  onOpenAddMenu: () => void
  onOpenAiComposer: () => void
  onOpenFilmCenter: () => void
  onOpenShotDirector: () => void
  onOpenAgent: () => void
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
  onFitView: () => void
  onCenterSelected: () => void
  onToggleGrid: () => void
  gridVisible: boolean
  selectedCount: number
  canUndo: boolean
  canRedo: boolean
}) {
  const items = useAddNodeMenuItems()
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const contentItems = items.filter((item) => item.category === 'content')
  const deleteTooltip = selectedCount > 0 ? `删除选中节点（${selectedCount}）` : '选择节点后可删除'
  const openAddMenu = () => {
    onOpenAddMenu()
    setAddMenuOpen(true)
  }
  const closeAddMenuAndRun = (action: () => void) => {
    setAddMenuOpen(false)
    action()
  }

  return (
    <>
      {addMenuOpen && (
        <CanvasAddNodeMenu
          items={items}
          onSelect={onAddNodeItem}
          onClose={() => setAddMenuOpen(false)}
        />
      )}
      <div className="canvas-bottom-dock">
        <div className="canvas-bottom-dock-group">
          <Tooltip title="选择 · Tab 切换" placement="top">
            <Button
              size="small"
              type="text"
              className={activeTool === 'select' ? 'canvas-dock-tool-active' : ''}
              icon={<Icons.MousePointer size={15} />}
              aria-label="选择"
              onClick={() => onToolChange('select')}
            />
          </Tooltip>
          <Tooltip title="平移 · Tab 切换" placement="top">
            <Button
              size="small"
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
          {contentItems
            .filter(
              (item) =>
                item.id === 'content:text' ||
                item.id === 'content:image' ||
                item.id === 'content:group',
            )
            .map((item) => (
              <Tooltip key={item.id} title={item.label} placement="top">
                <Button
                  size="small"
                  type="text"
                  icon={item.icon}
                  aria-label={item.label}
                  onClick={() => closeAddMenuAndRun(() => onAddNodeItem(item))}
                />
              </Tooltip>
            ))}
          <Tooltip title="更多节点类型" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus size={15} />}
              aria-label="节点工厂"
              onClick={openAddMenu}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title="AI 操作" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Sparkles size={15} />}
              aria-label="AI 操作"
              onClick={() => closeAddMenuAndRun(onOpenAiComposer)}
            />
          </Tooltip>
          <Tooltip title="项目资产中心（剧本/角色/场景/道具/分镜/提示词库）" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Box size={15} />}
              aria-label="项目资产中心"
              onClick={() => closeAddMenuAndRun(onOpenFilmCenter)}
            />
          </Tooltip>
          <Tooltip title="分镜导演台（站位 / 镜头 / 运镜提示词）" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Film size={15} />}
              aria-label="分镜导演台"
              onClick={() => closeAddMenuAndRun(onOpenShotDirector)}
            />
          </Tooltip>
          <Tooltip title="画布 Agent 助手（对话操作画布）" placement="top">
            <Button
              size="small"
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
              size="small"
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
              size="small"
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
              size="small"
              type="text"
              icon={<Icons.MousePointer size={15} />}
              aria-label="回到选中节点中心"
              disabled={selectedCount === 0}
              onClick={() => closeAddMenuAndRun(onCenterSelected)}
            />
          </Tooltip>
          <Tooltip title={gridVisible ? '隐藏网格' : '显示网格'} placement="top">
            <Button
              size="small"
              type={gridVisible ? 'primary' : 'text'}
              icon={<Icons.Grid size={15} />}
              onClick={onToggleGrid}
            />
          </Tooltip>
          <Tooltip title={canUndo ? '撤销上一步画布操作' : '暂无可撤销操作'} placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.RotateCcw size={15} />}
              aria-label="撤销"
              disabled={!canUndo}
              onClick={() => closeAddMenuAndRun(onUndo)}
            />
          </Tooltip>
          <Tooltip title={canRedo ? '重做上一步画布操作' : '暂无可重做操作'} placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.RotateCw size={15} />}
              aria-label="重做"
              disabled={!canRedo}
              onClick={() => closeAddMenuAndRun(onRedo)}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-spacer" />
      </div>
    </>
  )
}
