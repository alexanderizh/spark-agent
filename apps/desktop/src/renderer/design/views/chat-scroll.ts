export const SCROLL_TO_BOTTOM_VISIBILITY_THRESHOLD = 50

/**
 * 用户上滚后，需滚回「接近真底部」（distanceFromBottom <= 此值）才恢复流式跟随。
 * 与 VISIBILITY_THRESHOLD 形成 8~50px 的滞后区间：在该区间内 userScrolledRef 保持原状，
 * 避免小幅 wheel / 程序 pin 派生的 scroll 事件在 0~50px 区间反复翻转状态（流式反弹根因之一）。
 */
export const SCROLL_TO_BOTTOM_LOCK_THRESHOLD = 8

/**
 * 程序性贴底（pinToBottom）后，handleScroll 在该时间窗口内忽略「程序写 scrollTop 派生的 scroll 事件」，
 * 不按 distance 重算 userScrolledRef——否则会与 wheel/touchstart 源事件捕获的「用户已上滚」状态
 * 互相覆盖。80ms 覆盖数帧的异步 scroll 派发延迟。
 */
export const PROGRAMMATIC_SCROLL_GUARD_MS = 80

export function shouldShowScrollToBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom > SCROLL_TO_BOTTOM_VISIBILITY_THRESHOLD
}
