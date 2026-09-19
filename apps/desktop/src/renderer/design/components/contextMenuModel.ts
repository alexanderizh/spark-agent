/**
 * contextMenuModel — 通用右键菜单的数据模型与状态
 *
 * 与 CanvasContextMenu 的 canvasContextMenuModel.ts 同构：菜单条目定义、打开状态与
 * 「菜单是否打开」这类纯逻辑放在这里，ContextMenu.tsx 只负责渲染浮层，
 * 避免组件文件同时导出常量与 hooks（react-refresh 只允许导出组件）。
 */
import { useCallback, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

export type ContextMenuItem = {
  /** 判别字段：普通条目标为 item（可省略），分割线为 divider */
  type?: 'item' | undefined
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
}

export type ContextMenuDivider = { type: 'divider' }

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider

/** 分割线判定：判别字段在这里是可选的，用类型守卫收窄比内联判断更稳 */
export function isContextMenuDivider(entry: ContextMenuEntry): entry is ContextMenuDivider {
  return entry.type === 'divider'
}

/** 打开中的右键菜单标记类名：下层浮层据此让出 Esc 与方向键 */
export const CONTEXT_MENU_SELECTOR = '.context-action-menu'

/** 当前是否有右键菜单处于打开状态 */
export function isContextMenuOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(CONTEXT_MENU_SELECTOR) != null
}

export type ContextMenuState<T> = { x: number; y: number; target: T }

/**
 * 右键菜单状态：`open` 直接挂在元素的 onContextMenu 上（自动 preventDefault +
 * 阻止冒泡，避免嵌套元素重复开菜单），`close` 供菜单自身与上层调用。
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null)
  const open = useCallback((event: ReactMouseEvent, target: T) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return { menu, open, close }
}
