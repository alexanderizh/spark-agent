/**
 * useArrowPaging — 左右方向键翻页（← / →）
 *
 * 用于「上一项 / 下一项」场景：图片查看台、任务详情弹层等。调用方只在需要接管时
 * 把 enabled 置为 true，避免监听常驻导致抢键。
 *
 * 不接管的情况见 arrowKeyGuards（组合键、输入框、方向键自身的弹层）。
 */
import { useEffect, useRef } from 'react'
import { shouldIgnoreArrowKey } from './arrowKeyGuards'

export function useArrowPaging(options: {
  /** 是否接管方向键；false 时完全不注册监听 */
  enabled: boolean
  onPrev: () => void
  onNext: () => void
}): void {
  const { enabled, onPrev, onNext } = options
  // 回调每次渲染都会变（调用方多为内联箭头函数），用 ref 保存最新值，监听只随 enabled 注册一次
  const handlersRef = useRef({ onPrev, onNext })
  useEffect(() => {
    handlersRef.current = { onPrev, onNext }
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const { key } = event
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
      if (shouldIgnoreArrowKey(event)) return
      event.preventDefault()
      if (key === 'ArrowLeft') handlersRef.current.onPrev()
      else handlersRef.current.onNext()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
