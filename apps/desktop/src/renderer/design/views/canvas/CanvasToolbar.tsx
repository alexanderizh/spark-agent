import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'

export type CanvasTool = 'select' | 'pan' | 'text' | 'prompt' | 'image'

export function CanvasToolbar({
  activeTool,
  onToolChange,
  onAddText,
  onAddPrompt,
  onUploadImage,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onDissolveGroup,
  onOpenAiComposer,
  onDeleteSelected,
  selectedCount,
  canCreateGroup,
  canAddToGroup,
  canRemoveFromGroup,
  canDissolveGroup,
}: {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  onAddText: () => void
  onAddPrompt: () => void
  onUploadImage: () => void
  onCreateGroup: () => void
  onAddToGroup: () => void
  onRemoveFromGroup: () => void
  onDissolveGroup: () => void
  onOpenAiComposer: () => void
  onDeleteSelected: () => void
  selectedCount: number
  canCreateGroup: boolean
  canAddToGroup: boolean
  canRemoveFromGroup: boolean
  canDissolveGroup: boolean
}) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas toolbar">
      <Tooltip title="选择" placement="bottom">
        <Button
          size="small"
          type={activeTool === 'select' ? 'primary' : 'default'}
          icon={<Icons.MousePointer size={15} />}
          aria-label="选择"
          onClick={() => onToolChange('select')}
        />
      </Tooltip>
      <Tooltip title="平移" placement="bottom">
        <Button
          size="small"
          type={activeTool === 'pan' ? 'primary' : 'default'}
          icon={<Icons.Hand size={15} />}
          aria-label="平移"
          onClick={() => onToolChange('pan')}
        />
      </Tooltip>
      <Button size="small" icon={<Icons.File size={15} />} onClick={onAddText}>
        文本
      </Button>
      <Button size="small" icon={<Icons.Sparkles size={15} />} onClick={onAddPrompt}>
        Prompt
      </Button>
      <Button size="small" icon={<Icons.Image size={15} />} onClick={onUploadImage}>
        图片
      </Button>
      <Button
        size="small"
        icon={<Icons.Layers size={15} />}
        disabled={!canCreateGroup && !canAddToGroup}
        onClick={canAddToGroup ? onAddToGroup : onCreateGroup}
      >
        {canAddToGroup ? '加入组' : '创建组'}
      </Button>
      <Button
        size="small"
        icon={<Icons.ArrowUp size={15} />}
        disabled={!canRemoveFromGroup}
        onClick={onRemoveFromGroup}
      >
        移出组
      </Button>
      <Button
        size="small"
        icon={<Icons.FolderOpen size={15} />}
        disabled={!canDissolveGroup}
        onClick={onDissolveGroup}
      >
        解散组
      </Button>
      <Button
        size="small"
        type="primary"
        icon={<Icons.Sparkles size={15} />}
        onClick={onOpenAiComposer}
      >
        AI 操作
      </Button>
      <Button
        size="small"
        danger
        type="default"
        disabled={selectedCount === 0}
        icon={<Icons.Trash size={15} />}
        onClick={onDeleteSelected}
      >
        删除
      </Button>
    </div>
  )
}
