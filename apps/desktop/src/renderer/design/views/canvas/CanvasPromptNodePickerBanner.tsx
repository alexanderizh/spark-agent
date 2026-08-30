import { Icons } from '../../Icons'
import './CanvasPromptNodePickerBanner.less'

export function CanvasPromptNodePickerBanner({
  visible,
  onCancel,
}: {
  visible: boolean
  onCancel(): void
}) {
  if (!visible) return null
  return (
    <div className="canvas-prompt-node-picker-banner" role="status" aria-live="polite">
      <Icons.MousePointer size={16} />
      <span>
        <strong>从画布选择引用节点</strong>
        <small>单击节点插入 Tag，按 Esc 取消</small>
      </span>
      <button type="button" onClick={onCancel}>
        取消
      </button>
    </div>
  )
}
