import { Icons } from '../../Icons'

function formatWakeTime(timestamp?: string): string | null {
  if (timestamp == null) return null
  const ts = Date.parse(timestamp)
  if (Number.isNaN(ts)) return null
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * 定时任务唤醒轮分割线：唤醒轮的 user 消息上方渲染「定时任务唤醒 · HH:mm」，
 * 让无人值守时段由会话定时任务插入的轮次在时间线上一眼可辨。
 * 样式复用 goal-iteration-divider 的中性态（styles/views.css）。
 */
export function ScheduledWakeDivider({ timestamp }: { timestamp?: string | undefined }) {
  const time = formatWakeTime(timestamp)
  return (
    <div
      className="goal-iteration-divider scheduled-wake-divider"
      role="separator"
      aria-label={time != null ? `定时任务唤醒 ${time}` : '定时任务唤醒'}
    >
      <div className="goal-iteration-divider-row">
        <span className="goal-iteration-divider-line" />
        <span className="goal-iteration-divider-label">
          <Icons.Clock size={12} className="scheduled-wake-divider-clock" />
          <span>定时任务唤醒</span>
          {time != null ? <span className="scheduled-wake-divider-time">{time}</span> : null}
        </span>
        <span className="goal-iteration-divider-line" />
      </div>
    </div>
  )
}
