/**
 * useArrowZoom — 上下方向键缩放（↑ 放大 / ↓ 缩小）
 *
 * 与 useArrowPaging 同族：调用方只在需要接管时把 enabled 置为 true，
 * 并用同一套 arrowKeyGuards 放行组合键、输入框与方向键自身的弹层。
 */
import { useEffect, useRef, type RefObject } from 'react'
import { isCoveredByOtherDialog, shouldIgnoreArrowKey } from './arrowKeyGuards'

export function useArrowZoom(options: {
  /** 是否接管方向键；false 时完全不注册监听 */
  enabled: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  /** 查看器根元素；用于判断自己是否已被上层弹层盖住（盖住时不接管，避免在看不见的地方生效） */
  rootRef?: RefObject<HTMLElement | null> | undefined
}): void {
  const { enabled, onZoomIn, onZoomOut, rootRef } = options
  // 回调每次渲染都会变（调用方多为内联箭头函数），用 ref 保存最新值，监听只随 enabled 注册一次
  const handlersRef = useRef({ onZoomIn, onZoomOut })
  useEffect(() => {
    handlersRef.current = { onZoomIn, onZoomOut }
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const { key } = event
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return
      if (shouldIgnoreArrowKey(event)) return
      if (isCoveredByOtherDialog(rootRef?.current ?? null)) return
      event.preventDefault()
      if (key === 'ArrowUp') handlersRef.current.onZoomIn()
      else handlersRef.current.onZoomOut()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
