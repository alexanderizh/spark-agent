/**
 * 常驻提示（sticky）可见性策略。
 *
 * 背景：底座（@base-ui/react Toast）在存活条数超过可见上限时，会把「最旧」的
 * 一条标记为 limited——渲染上是 `opacity: 0` + `inert`，既不可见也不可交互，
 * 要等条数回落才自愈。常驻提示恰恰是最早入队的那条，拥堵时反而第一个被隐藏，
 * 而它承载的往往是最不能漏掉的状态（例如「电脑资源压力高、已暂停新任务派发」）。
 *
 * 所以策略是：队列已满且最旧的正是常驻条时，把常驻条重建置顶，让可自愈的临时
 * 提示去承担 limited——不提前关闭任何其他提示，也不改变别的提示寿命。
 *
 * 独立成模块：判定逻辑是纯函数，便于聚焦测试（Toast.sticky.test.ts），
 * 也避免测试为了一个判定把整个 Toast 组件与底座依赖拉进来。
 */

/** Toast 可见上限（与 ToastContainer 的 limit 保持一致）。 */
export const MAX_TOASTS = 5

/**
 * 是否需要把常驻提示重建置顶。
 *
 * @param live  存活提示登记，顺序为入队顺序（索引 0 最旧，与底座命中 limited 的顺序一致）
 * @param limit 可见上限
 */
export function shouldRepinStickyToast(
  live: readonly { sticky: boolean }[],
  limit: number,
): boolean {
  return live.length >= limit && live[0]?.sticky === true
}
