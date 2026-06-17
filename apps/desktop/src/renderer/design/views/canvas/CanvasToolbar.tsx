import { Button, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'

export type CanvasTool = 'select' | 'pan' | 'text' | 'image'

/**
 * 顶部基础工具栏（文档 §7.5）。
 *
 * 已收缩为「项目级操作栏」：保存状态/导出。
 * 选择/平移工具切换、创作类动作已迁到底部悬浮栏（CanvasBottomDock）、
 * 左侧工作台和节点右键菜单。activeTool 保留在 props 以备将来，
 * 但工具切换按钮已不在顶部渲染。
 */
export function CanvasToolbar({
  saveState,
  onSave,
  onExport,
}: {
  activeTool?: CanvasTool
  onToolChange?: (tool: CanvasTool) => void
  onAddText?: () => void
  onUploadImage?: () => void
  onCreateGroup?: () => void
  onAddToGroup?: () => void
  onRemoveFromGroup?: () => void
  onDissolveGroup?: () => void
  onOpenAiComposer?: () => void
  onDeleteSelected?: () => void
  selectedCount?: number
  canCreateGroup?: boolean
  canAddToGroup?: boolean
  canRemoveFromGroup?: boolean
  canDissolveGroup?: boolean
  saveState: { dirty: boolean; saving: boolean }
  onSave: () => void
  onExport: () => void
}) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas toolbar">
      <div className="canvas-toolbar-group canvas-toolbar-save">
        <Tag color={saveState.dirty ? 'orange' : 'green'} className="canvas-toolbar-savetag">
          {saveState.dirty ? '未保存' : '已保存'}
        </Tag>
        <Button
          size="small"
          icon={<Icons.Check size={15} />}
          disabled={saveState.saving || !saveState.dirty}
          onClick={onSave}
        >
          保存
        </Button>
        <Button size="small" icon={<Icons.Download size={15} />} onClick={onExport}>
          导出
        </Button>
      </div>
    </div>
  )
}
