import { useEffect, useState } from 'react'
import { formatTurnDuration } from '../utils/turn-duration'

/**
 * 运行中轮次的实时耗时指示：挂在气泡底部「执行任务中」标签里，
 * 从轮次起始 timestamp（ISO）起算、每秒自刷新，格式与结束后折叠条的
 * 「耗时 Xs」同源（formatTurnDuration）。isStreaming 翻 false 时父层卸载
 * 运行标签，耗时即切换为终态冻结值（UIMessage.durationMs），两者不会重叠。
 *
 * 计时完全由组件内部 state 驱动，父层（memo 的 AgentMsg）无需为此重渲染；
 * 时间戳无法解析时渲染 null，避免出现「NaNs」。
 */
export function TurnElapsedTicker({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return null
  return (
    <span className="agent-task-running-elapsed">
      · {formatTurnDuration(Math.max(0, now - startMs))}
    </span>
  )
}
