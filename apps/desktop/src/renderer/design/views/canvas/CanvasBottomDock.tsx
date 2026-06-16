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
 *   - 视图：适配屏幕 / 回到中心 / 网格开关
 *
 * 必须可折叠（文档 §7.5 注意点），避免遮挡内容。
 */
export function CanvasBottomDock({
  activeTool,
  onToolChange,
  onAddNodeItem,
  onOpenAiComposer,
  onOpenFilmCenter,
  onFitView,
  onResetZoom,
  onToggleGrid,
  gridVisible,
  collapsed,
  onToggleCollapsed,
}: {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  onAddNodeItem: (item: AddNodeMenuItem) => void
  onOpenAiComposer: () => void
  onOpenFilmCenter: () => void
  onFitView: () => void
  onResetZoom: () => void
  onToggleGrid: () => void
  gridVisible: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const items = useAddNodeMenuItems()
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const contentItems = items.filter((item) => item.category === 'content')

  if (collapsed) {
    return (
      <div className="canvas-bottom-dock canvas-bottom-dock-collapsed">
        <Tooltip title="展开工具栏">
          <Button
            size="small"
            type="text"
            icon={<Icons.ChevronDown size={15} />}
            onClick={onToggleCollapsed}
          />
        </Tooltip>
      </div>
    )
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
            .filter((item) => item.id === 'content:text' || item.id === 'content:image' || item.id === 'content:group')
            .map((item) => (
              <Tooltip key={item.id} title={item.label} placement="top">
                <Button
                  size="small"
                  type="text"
                  icon={item.icon}
                  aria-label={item.label}
                  onClick={() => onAddNodeItem(item)}
                />
              </Tooltip>
            ))}
          <Tooltip title="更多节点类型" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus size={15} />}
              aria-label="节点工厂"
              onClick={() => setAddMenuOpen(true)}
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
              onClick={onOpenAiComposer}
            />
          </Tooltip>
          <Tooltip title="项目资产中心（剧本/角色/场景/道具/分镜/提示词库）" placement="top">
            <Button
              size="small"
              type="text"
              icon={<Icons.Layers size={15} />}
              aria-label="项目资产中心"
              onClick={onOpenFilmCenter}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title="适配屏幕" placement="top">
            <Button size="small" type="text" icon={<Icons.Maximize size={15} />} onClick={onFitView} />
          </Tooltip>
          <Tooltip title="复原缩放" placement="top">
            <Button size="small" type="text" icon={<Icons.RotateCcw size={15} />} onClick={onResetZoom} />
          </Tooltip>
          <Tooltip title={gridVisible ? '隐藏网格' : '显示网格'} placement="top">
            <Button
              size="small"
              type={gridVisible ? 'primary' : 'text'}
              icon={<Icons.Layers size={15} />}
              onClick={onToggleGrid}
            />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-divider" />

        <div className="canvas-bottom-dock-group">
          <Tooltip title="撤销" placement="top">
            <Button size="small" type="text" icon={<Icons.RotateCcw size={15} />} disabled />
          </Tooltip>
        </div>

        <div className="canvas-bottom-dock-spacer" />
        <Tooltip title="收起工具栏" placement="top">
          <Button
            size="small"
            type="text"
            icon={<Icons.ChevronDown size={15} />}
            onClick={onToggleCollapsed}
          />
        </Tooltip>
      </div>
    </>
  )
}
