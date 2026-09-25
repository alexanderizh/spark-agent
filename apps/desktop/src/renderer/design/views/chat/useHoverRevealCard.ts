import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 模型选择器悬浮卡片的开合状态机（原「智能路由」行悬浮卡专用，现由
 * 智能路由配置卡与渠道限额用量卡共用，key 即目标行的标识）。
 *
 * 延迟打开（指针扫过列表时不闪卡）、立即关闭、菜单关闭即清空；卡片显示期间
 * 菜单滚动或窗口尺寸变化时直接关闭（不做跟随重排，避免残留错位）。
 * 卡片本身 `pointer-events: none`，指针进不去，因此不需要"悬停接力"逻辑。
 */

/** 悬浮打开延迟：指针扫过列表时不闪卡；键盘聚焦走立即打开。 */
export const HOVER_REVEAL_OPEN_DELAY_MS = 200

export interface HoverRevealTarget {
  /** 目标行标识（智能路由 id / 渠道 id 等），用于避免同目标重复开合。 */
  key: string
  anchorEl: HTMLElement
}

export interface HoverRevealCardController {
  target: HoverRevealTarget | null
  /** 指针进入行（延迟打开）/ 键盘聚焦行（immediate 立即打开）。 */
  hover: (key: string, anchorEl: HTMLElement | null, options?: { immediate?: boolean }) => void
  /** 指针或焦点离开行：立即关闭。 */
  leave: () => void
  /** 强制关闭（菜单关闭、菜单内容变化时调用）。 */
  dismiss: () => void
}

export function useHoverRevealCard(enabled: boolean): HoverRevealCardController {
  const [target, setTarget] = useState<HoverRevealTarget | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setTarget(null)
  }, [clearTimer])

  const hover = useCallback(
    (key: string, anchorEl: HTMLElement | null, options?: { immediate?: boolean }) => {
      if (!enabled || anchorEl == null) return
      clearTimer()
      const open = () =>
        setTarget((prev) =>
          prev != null && prev.key === key && prev.anchorEl === anchorEl ? prev : { key, anchorEl },
        )
      if (options?.immediate === true) {
        open()
        return
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        open()
      }, HOVER_REVEAL_OPEN_DELAY_MS)
    },
    [enabled, clearTimer],
  )

  // 卸载时清掉未到期的延迟计时器（菜单关闭的清理由调用方的 dismiss 负责）
  useEffect(() => dismiss, [dismiss])

  useEffect(() => {
    if (target == null) return
    const handle = () => dismiss()
    // 捕获阶段监听：菜单列表自身滚动（不冒泡）同样要关掉卡片
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [target, dismiss])

  return { target, hover, leave: dismiss, dismiss }
}
