import { Button, Tooltip } from '@arco-design/web-react'
import { Icons } from '../../Icons'

export type CanvasTool = 'select' | 'pan' | 'text' | 'prompt' | 'image'

const tools: Array<{ id: CanvasTool; title: string; icon: React.ReactNode }> = [
  { id: 'select', title: '选择', icon: <Icons.Command size={15} /> },
  { id: 'pan', title: '平移', icon: <Icons.Compass size={15} /> },
  { id: 'text', title: '文本', icon: <Icons.File size={15} /> },
  { id: 'prompt', title: 'Prompt', icon: <Icons.Sparkles size={15} /> },
  { id: 'image', title: '上传图片', icon: <Icons.Image size={15} /> },
]

export function CanvasToolbar({
  activeTool,
  onToolChange,
  onAddText,
  onAddPrompt,
  onUploadImage,
  onDeleteSelected,
  selectedCount,
}: {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  onAddText: () => void
  onAddPrompt: () => void
  onUploadImage: () => void
  onDeleteSelected: () => void
  selectedCount: number
}) {
  const handleTool = (tool: CanvasTool) => {
    onToolChange(tool)
    if (tool === 'text') onAddText()
    if (tool === 'prompt') onAddPrompt()
    if (tool === 'image') onUploadImage()
  }

  return (
    <div className="canvas-toolbar">
      {tools.map((tool) => (
        <Tooltip key={tool.id} content={tool.title} position="right">
          <Button
            size="small"
            shape="circle"
            type={activeTool === tool.id ? 'primary' : 'text'}
            icon={tool.icon}
            onClick={() => handleTool(tool.id)}
          />
        </Tooltip>
      ))}
      <div className="canvas-toolbar-separator" />
      <Tooltip content={selectedCount > 0 ? '删除选中节点' : '先选择节点'} position="right">
        <Button
          size="small"
          shape="circle"
          status="danger"
          type="text"
          disabled={selectedCount === 0}
          icon={<Icons.Trash size={15} />}
          onClick={onDeleteSelected}
        />
      </Tooltip>
    </div>
  )
}
