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

/**
 * 「回到底部」按钮 smooth 贴底动画期间，handleScroll 跳过 userScrolledRef 重算的兜底窗口。
 * smooth 滚动持续数百毫秒并持续派生 scroll 事件，若按 distance 重算，动画中途 distance>阈值
 * 会把刚清零的跟随状态误翻成「已上滚」，贴底完成后流式跟随停摆；动画被用户滚动中断时
 * 不会派发「到达底部」事件，靠该窗口超时恢复常规重算。
 */
export const SMOOTH_SCROLL_TO_BOTTOM_GUARD_MS = 1200

export function shouldShowScrollToBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom > SCROLL_TO_BOTTOM_VISIBILITY_THRESHOLD
}

/** 会自行消费方向键的输入类元素选择器（contenteditable 由 isContentEditable 属性另行判断）。 */
const EDITABLE_KEYBOARD_TARGET_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/**
 * 键盘上滚意图（ArrowUp / PageUp / Home）是否作用于给定滚动容器：
 * 目标需为 body/documentElement（无特定焦点，按键默认作用于页面）或容器内元素，
 * 且不是会自行消费方向键的输入类元素（输入框内移动光标不构成滚动意图）。
 * 键盘滚动不派发 wheel/touchstart，需要单独的源事件闸门打破「滚不上去被弹回」竞速。
 */
export function isKeyboardScrollIntentForContainer(
  key: string,
  target: EventTarget | null,
  container: HTMLElement | null,
): boolean {
  if (key !== 'ArrowUp' && key !== 'PageUp' && key !== 'Home') return false
  if (!(target instanceof HTMLElement) || !container) return false
  if (target.isContentEditable || target.matches(EDITABLE_KEYBOARD_TARGET_SELECTOR)) return false
  return (
    target === document.body ||
    target === document.documentElement ||
    container.contains(target)
  )
}
