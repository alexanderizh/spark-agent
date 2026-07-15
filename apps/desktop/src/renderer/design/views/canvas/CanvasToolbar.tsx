import { useState } from 'react'
import { Button, Segmented, Tag, Tooltip } from '@lobehub/ui'
import { Popover, Switch } from 'antd'
import { Icons } from '../../Icons'
import type { CanvasAutoLayoutMode, CanvasAutoLayoutSpacing } from './canvasAutoLayout'

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
  onAutoSaveChange,
  onExport,
  onUploadFiles,
  selectedCount = 0,
  arranging = false,
  onArrange,
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
  onUploadFiles?: () => void
  arranging?: boolean
  onArrange: (options: {
    mode: CanvasAutoLayoutMode
    spacing: CanvasAutoLayoutSpacing
  }) => Promise<void>
}) {
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [layoutMode, setLayoutMode] = useState<CanvasAutoLayoutMode>('grid')
  const [layoutSpacing, setLayoutSpacing] = useState<CanvasAutoLayoutSpacing>('medium')
  const partialLayout = selectedCount > 1
  const arrangeScopeLabel = partialLayout
    ? `仅整理所选 ${selectedCount} 个节点`
    : '整理全画布（单选仍按全画布处理）'

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
        <Tooltip title="从本地选择文件（图片 / 视频 / 音频 / 文本 / 代码 / CSV 等）导入画布，可多选">
          <Button
            size="middle"
            icon={<Icons.Upload size={15} />}
            disabled={!onUploadFiles}
            onClick={onUploadFiles}
          >
            上传文件
          </Button>
        </Tooltip>
        <Popover
          trigger="click"
          placement="bottomRight"
          open={arrangeOpen}
          onOpenChange={(open) => !arranging && setArrangeOpen(open)}
          content={
            <div className="canvas-auto-layout-popover">
              <div className="canvas-auto-layout-title">自动整理画布</div>
              <div className="canvas-auto-layout-scope">{arrangeScopeLabel}</div>
              <label>
                <span>排列方式</span>
                <Segmented
                  value={layoutMode}
                  onChange={(value) => setLayoutMode(value as CanvasAutoLayoutMode)}
                  options={[
                    { label: '横向', value: 'horizontal' },
                    { label: '纵向', value: 'vertical' },
                    { label: '宫格', value: 'grid' },
                  ]}
                />
              </label>
              <label>
                <span>节点间距</span>
                <Segmented
                  value={layoutSpacing}
                  onChange={(value) => setLayoutSpacing(value as CanvasAutoLayoutSpacing)}
                  options={[
                    { label: '小', value: 'small' },
                    { label: '中', value: 'medium' },
                    { label: '大', value: 'large' },
                    { label: '超大', value: 'extra-large' },
                  ]}
                />
              </label>
              <Button
                type="primary"
                block
                loading={arranging}
                icon={<Icons.Grid size={15} />}
                onClick={() =>
                  void onArrange({ mode: layoutMode, spacing: layoutSpacing }).then(() =>
                    setArrangeOpen(false),
                  )
                }
              >
                开始整理
              </Button>
            </div>
          }
        >
          <Button
            size="middle"
            loading={arranging}
            icon={<Icons.Grid size={15} />}
            aria-label="自动整理画布"
          >
            自动整理
          </Button>
        </Popover>
      </div>
    </div>
  )
}
