/**
 * 设置导航宽度分隔条：拖拽调整，双击复位，方向键微调。
 *
 * 拖拽实现与 FilePreviewPanel / CodeViewerPanel 的分隔条一致：pointerdown 时把
 * pointermove / pointerup 挂到 window，并在 body 上加 `settings-nav-resizing`
 * 统一接管光标与文本选中，松手时全部摘除。
 *
 * 宽度只在指针移动时写入 store，布局靠 CSS 变量生效，因此这里只订阅宽度用于
 * aria-valuenow —— 重渲染被限制在这个 1px 节点内，不会带着整个设置页重渲染。
 */

import { useCallback } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

import {
  getSettingsNavWidth,
  SETTINGS_NAV_KEYBOARD_STEP,
  SETTINGS_NAV_WIDTH_BOUNDS,
  SETTINGS_NAV_WIDTH_DEFAULT,
  setSettingsNavWidth,
  useSettingsNavWidth,
} from './settingsNavWidth'

export function SettingsNavResizer() {
  const width = useSettingsNavWidth()

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = getSettingsNavWidth()
    const body = document.body
    body.classList.add('settings-nav-resizing')

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      // 导航在左侧，指针右移即变宽
      setSettingsNavWidth(startWidth + (moveEvent.clientX - startX))
    }

    const handlePointerUp = () => {
      body.classList.remove('settings-nav-resizing')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SETTINGS_NAV_KEYBOARD_STEP * 2 : SETTINGS_NAV_KEYBOARD_STEP
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setSettingsNavWidth(getSettingsNavWidth() + step)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setSettingsNavWidth(getSettingsNavWidth() - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSettingsNavWidth(SETTINGS_NAV_WIDTH_BOUNDS.min)
    } else if (event.key === 'End') {
      event.preventDefault()
      setSettingsNavWidth(SETTINGS_NAV_WIDTH_BOUNDS.max)
    }
  }, [])

  return (
    <div
      aria-label="调整设置导航宽度"
      aria-orientation="vertical"
      aria-valuemax={SETTINGS_NAV_WIDTH_BOUNDS.max}
      aria-valuemin={SETTINGS_NAV_WIDTH_BOUNDS.min}
      aria-valuenow={width}
      className="settings-nav-resizer"
      onDoubleClick={() => setSettingsNavWidth(SETTINGS_NAV_WIDTH_DEFAULT)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={0}
      title="拖拽调整宽度，双击恢复默认"
    />
  )
}
