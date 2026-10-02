/**
 * @module ComputerKillSwitchNoticeHost
 * 电脑操作急停反馈（P1）：监听 stream:computer-use:kill-switch-triggered，
 * 右上角 toast 告知用户 ⌘⇧Esc 已生效、停了几个会话、是否有失败。
 * 复刻 PressureNoticeHost 的 host 组件模式（无 UI、只发全局通知）。
 */
import { useEffect } from 'react'

import { useToast } from '../components/Toast'

interface KillSwitchTriggeredPayload {
  stoppedCount: number
  failureCount: number
  triggeredAt: string
}

export function ComputerKillSwitchNoticeHost(): null {
  const { toast } = useToast()

  useEffect(() => {
    const off = window.spark.on(
      'stream:computer-use:kill-switch-triggered',
      (payload: KillSwitchTriggeredPayload) => {
        if (payload?.failureCount > 0) {
          toast.warning(
            `已紧急停止 ${payload.stoppedCount} 个电脑操作会话，${payload.failureCount} 个停止失败，请到会话中确认状态`,
          )
          return
        }
        if (payload?.stoppedCount > 0) {
          toast.success(`已紧急停止 ${payload.stoppedCount} 个电脑操作会话`)
          return
        }
        // 没有活跃会话也反馈一次，确认快捷键本身生效。
        toast.info('急停已触发：当前没有进行中的电脑操作会话')
      },
    )
    return off
  }, [toast])

  return null
}
