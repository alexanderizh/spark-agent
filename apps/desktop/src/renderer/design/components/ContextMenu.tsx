/**
 * ContextMenu — 通用右键菜单浮层
 *
 * 条目定义、打开状态与「菜单是否打开」的判定见 contextMenuModel.ts。
 *
 * 外观与交互沿用项目既有右键菜单：容器复用 views.css 的
 * `.action-menu` / `.context-action-menu` / `.action-menu-item`，条目支持图标、
 * 危险色、禁用态与分割线（`.action-menu-divider`）。
 *
 * 交互约定：
 *   - 外部 mousedown / Esc / 窗口缩放、滚动、失焦都关闭（菜单按 client 坐标固定
 *     定位，视口变化后原坐标不再可信）
 *   - 渲染在 body portal 中：详情弹层、全屏灯箱这类带 transform / 高 z-index 的
 *     容器不会截断或错位菜单
 *   - 渲染后按实际尺寸贴边收敛，长菜单不会溢出窗口右下角
 *   - 键盘：↑/↓ 移动高亮、Enter 执行、Esc 只关菜单。菜单根节点带
 *     `.context-action-menu` 标记，下层的查看器据此让出方向键（见 arrowKeyGuards），
 *     捕获阶段吞掉 Esc 也保证不会顺手关掉下层弹层
 *   - 不抢焦点：菜单自己维护高亮项，避免进入 antd Modal 的焦点锁定区域后
 *     又被强行拉回弹层内部
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isContextMenuDivider, type ContextMenuEntry } from './contextMenuModel'
import './ContextMenu.less'

/** 菜单与视口边缘的安全间距 */
const VIEWPORT_INSET = 8

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel = '操作菜单',
}: {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
  ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [activeIndex, setActiveIndex] = useState(-1)

  // 可执行项下标（跳过分割线与禁用项），键盘导航只在其中移动
  const actionableIndexes = useMemo(
    () =>
      items.reduce<number[]>((list, item, index) => {
        if (!isContextMenuDivider(item) && !item.disabled) list.push(index)
        return list
      }, []),
    [items],
  )

  const runItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || isContextMenuDivider(item) || item.disabled) return
      onClose()
      item.onClick?.()
    },
    [items, onClose],
  )

  const moveActive = useCallback(
    (delta: number) => {
      if (actionableIndexes.length === 0) return
      setActiveIndex((current) => {
        const at = actionableIndexes.indexOf(current)
        const next =
          at < 0
            ? delta > 0
              ? 0
              : actionableIndexes.length - 1
            : (at + delta + actionableIndexes.length) % actionableIndexes.length
        return actionableIndexes[next] ?? -1
      })
    },
    [actionableIndexes],
  )

  // 高度依赖条目数量与文字换行，只有渲染后才能量到；量到之前先用原始坐标，避免闪一下
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    const maxLeft = Math.max(window.innerWidth - width - VIEWPORT_INSET, VIEWPORT_INSET)
    const maxTop = Math.max(window.innerHeight - height - VIEWPORT_INSET, VIEWPORT_INSET)
    setPosition({
      left: Math.min(Math.max(x, VIEWPORT_INSET), maxLeft),
      top: Math.min(Math.max(y, VIEWPORT_INSET), maxTop),
    })
  }, [x, y, items])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleViewportChange = () => onClose()
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('blur', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('blur', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [onClose])

  // 键盘在捕获阶段处理并吞掉事件：Esc 只关菜单，不会顺带关掉下层弹层或灯箱
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        moveActive(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        event.stopPropagation()
        const first = actionableIndexes[0]
        const last = actionableIndexes[actionableIndexes.length - 1]
        setActiveIndex(event.key === 'Home' ? (first ?? -1) : (last ?? -1))
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (activeIndex < 0) return
        event.preventDefault()
        event.stopPropagation()
        runItem(activeIndex)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [actionableIndexes, activeIndex, moveActive, onClose, runItem])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={ref}
      className="action-menu context-action-menu"
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 10001 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        isContextMenuDivider(item) ? (
          <div key={`divider-${index}`} className="action-menu-divider" role="separator" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`action-menu-item${item.danger ? ' danger' : ''}${
              activeIndex === index ? ' is-active' : ''
            }`}
            disabled={item.disabled}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => runItem(index)}
          >
            {item.icon ?? <span className="action-menu-item-spacer" />}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
