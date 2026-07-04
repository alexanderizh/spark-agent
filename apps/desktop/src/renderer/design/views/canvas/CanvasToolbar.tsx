import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Switch } from 'antd'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'

export type CanvasTool = 'select' | 'pan' | 'text' | 'image'

/**
 * 顶部基础工具栏（文档 §7.5）。
 *
 * 已收缩为「项目级操作栏」：保存状态/导出/主题切换。
 * 选择/平移工具切换、创作类动作已迁到底部悬浮栏（CanvasBottomDock）、
 * 左侧工作台和节点右键菜单。activeTool 保留在 props 以备将来，
 * 但工具切换按钮已不在顶部渲染。
 */
export function CanvasToolbar({
  saveState,
  onSave,
  onAutoSaveChange,
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
  saveState: {
    dirty: boolean
    saving: boolean
    autoSaving: boolean
    autoSaveEnabled: boolean
  }
  onSave: () => void
  onAutoSaveChange: (enabled: boolean) => void
  onExport: () => void
}) {
  const { setTweak } = useApp()
  const resolvedTheme = useResolvedTheme()
  const isDark = resolvedTheme === 'dark'
  const toggleTheme = () => {
    setTweak('theme', isDark ? 'light' : 'dark')
  }

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas toolbar">
      <div className="canvas-toolbar-group canvas-toolbar-save">
        <Tag
          color={saveState.saving ? 'blue' : saveState.dirty ? 'orange' : 'green'}
          className="canvas-toolbar-savetag"
        >
          {saveState.autoSaving
            ? '自动保存中'
            : saveState.saving
              ? '保存中'
              : saveState.dirty
                ? '未保存'
                : '已保存'}
        </Tag>
        <div className="canvas-toolbar-autosave">
          <span className="canvas-toolbar-autosave-label">自动保存</span>
          <Tooltip title="开启后，画布变更会在用户停手后自动落库，并限制为最多每 30 秒一次。">
            <Switch
              size="middle"
              checked={saveState.autoSaveEnabled}
              onChange={onAutoSaveChange}
            />
          </Tooltip>
        </div>
        <Button
          size="middle"
          icon={<Icons.Check size={15} />}
          disabled={saveState.saving || !saveState.dirty}
          onClick={onSave}
        >
          保存
        </Button>
        <Button size="middle" icon={<Icons.Download size={15} />} onClick={onExport}>
          导出
        </Button>
        <Tooltip title={isDark ? '切换到浅色模式' : '切换到深色模式'}>
          <Button
            size="middle"
            aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
            icon={isDark ? <Icons.Sun size={15} /> : <Icons.Moon size={15} />}
            onClick={toggleTheme}
          />
        </Tooltip>
      </div>
    </div>
  )
}
