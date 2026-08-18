/**
 * 整轮耗时展示：整秒粒度（轮次耗时小数无意义），<1s 记为 1s 避免「耗时 0s」噪音；
 * ≥1m 显示「1m 12s」，≥1h 显示「1h 2m」。工具级耗时仍用 ChatView 内的 formatDuration（毫秒级）。
 *
 * 同时服务于两处展示，口径必须一致：
 * - 运行中：TurnElapsedTicker 每秒实时计算 now − 轮次起始 timestamp
 * - 已结束：折叠条「耗时 Xs」，取终态冻结的 UIMessage.durationMs
 */
export function formatTurnDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (ms < 3_600_000) {
    const min = Math.floor(ms / 60_000)
    const sec = Math.round((ms % 60_000) / 1000)
    return sec >= 60 ? `${min + 1}m` : sec > 0 ? `${min}m ${sec}s` : `${min}m`
  }
  const hour = Math.floor(ms / 3_600_000)
  const min = Math.round((ms % 3_600_000) / 60_000)
  return min >= 60 ? `${hour + 1}h` : min > 0 ? `${hour}h ${min}m` : `${hour}h`
}
