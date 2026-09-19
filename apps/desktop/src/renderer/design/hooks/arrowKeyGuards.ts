/**
 * arrowKeyGuards — 方向键接管的共享判定
 *
 * 图片查看台这类「用方向键操作」的组件（←/→ 翻页、↑/↓ 缩放）都要避免抢走本来属于别的控件的方向键：
 *   - 组合键（⌘/Ctrl/Alt/Shift + 方向键）留给全局快捷键与编辑器
 *   - 输入框 / textarea / select / contenteditable 内由光标自己消费方向键
 *   - listbox / menu / slider 这类自身就用方向键导航的弹层（如 antd 下拉）
 *   - 打开中的右键菜单（.context-action-menu）：菜单自己用方向键导航，查看器让出按键
 */
import { isContextMenuOpen } from '../components/contextMenuModel'
import { isEditableTarget } from './useKeyboard'

/** 自身以方向键导航的弹层容器：事件落在其中时不接管 */
const ARROW_KEY_OWNER_SELECTOR = '[role="listbox"], [role="menu"], [role="slider"]'

/** 该按键事件是否应放行给其它控件（true = 不接管、不 preventDefault） */
export function shouldIgnoreArrowKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true
  if (isEditableTarget(event.target)) return true
  if (event.target instanceof Element && event.target.closest(ARROW_KEY_OWNER_SELECTOR) != null) {
    return true
  }
  // 右键菜单（顶层浮层）打开时方向键归菜单：菜单不一定持有焦点，只按 target 判断会漏，
  // 会让下层查看器在菜单挡住画面的情况下继续翻页 / 缩放
  return isContextMenuOpen()
}

/**
 * 目标是否被别的弹层盖住：焦点落在某个 [role="dialog"] 内、而目标元素不在该弹层里，
 * 说明此刻键盘属于上层那个弹层，目标不应在看不见的地方静默响应按键。
 */
export function isCoveredByOtherDialog(root: Element | null): boolean {
  if (!root) return false
  const active = document.activeElement
  if (!(active instanceof Element)) return false
  const dialog = active.closest('[role="dialog"]')
  return dialog !== null && !dialog.contains(root)
}
