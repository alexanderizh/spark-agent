import type { ReactNode } from 'react'
import { Icons } from '../../Icons'

/**
 * 模型选择器的单行：模型名 + 选中态 + 置顶按钮。
 *
 * 置顶按钮必须是 `.composer-menu-item` 的**兄弟节点**而不是子节点 ——
 * `.composer-menu-item` 本身是 <button>，嵌套 <button> 既是非法 HTML，
 * 点击也会冒泡触发模型选中。
 */
export function ModelPickerMenuItem({
  label,
  active,
  pinned,
  leading,
  onSelect,
  onTogglePin,
}: {
  label: string
  active: boolean
  pinned: boolean
  leading?: ReactNode
  onSelect: () => void
  onTogglePin: () => void
}) {
  return (
    <div className={`composer-model-item${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className={`composer-menu-item ${active ? 'active' : ''}`}
        onClick={onSelect}
      >
        {leading != null && <span className="composer-menu-item-leading-icon">{leading}</span>}
        <span className="composer-model-item-label">{label}</span>
        {active && <Icons.Check size={14} />}
      </button>
      <button
        type="button"
        className={`composer-model-pin${pinned ? ' is-pinned' : ''}`}
        title={pinned ? '取消置顶' : '置顶'}
        aria-label={pinned ? `取消置顶 ${label}` : `置顶 ${label}`}
        aria-pressed={pinned}
        // 只切换置顶：既不选中模型，也不关闭弹窗（可以连续置顶多个）。
        // mousedown 的 preventDefault 阻止默认行为（输入框失焦/文本选中），
        // stopPropagation 防止事件穿过行容器；click 的 stopPropagation 防止
        // 冒泡到 AntD Dropdown 的点击外部关闭逻辑 —— 两个阶段缺一不可。
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onTogglePin()
        }}
      >
        {pinned ? <Icons.PinFill size={12} /> : <Icons.Pin size={12} />}
      </button>
    </div>
  )
}
