/**
 * 排队发送提示。
 *
 * 背景：会话已有正在执行的 turn（或处于 goal 自驱 / 待答题闸门等占位场景）时，
 * `session:submit-turn` 会「接受但排队」——返回 `started: false`。此时按既有设计，
 * 乐观用户气泡会从对话流移除（`commitOptimisticUserMessage(started=false)`），
 * 消息只出现在输入框上方的队列面板里；用户视线在对话区，容易误判成「发送失败」
 * 或「没反应」。这里统一补一条右上角消息弹窗，明确「已加入队列、会自动发送」。
 *
 * 触发只认「运行时明确回报的入队信号」，不做时序推测：durable 提交通路会先入队、
 * 再 `setTimeout(0)` 起跑，队列快照中短暂出现自己的 turnId 属正常起跑窗口，
 * 若据此推断排队会把正常发送误报成排队。
 */
import type { ToastFn } from '../../components/Toast'

export const QUEUED_SEND_TOAST_MESSAGE =
  '消息已加入队列，将在当前任务完成后自动发送（输入框上方可查看队列）'

/** 发送结果里与排队相关的字段：submit-turn 的 started、command:execute 的 queued。 */
export interface QueuedSendSignal {
  started?: boolean
  queued?: boolean
}

/** 是否属于「运行时明确回报的入队」。 */
export function isQueuedSend(signal: QueuedSendSignal): boolean {
  return signal.started === false || signal.queued === true
}

/**
 * 入队时弹一条 info 消息弹窗；未入队返回 false（不打扰）。
 * 用 info 而非 warning/error：排队是正常的资源编排，不是失败。
 */
export function notifyQueuedSend(toast: Pick<ToastFn, 'info'>, signal: QueuedSendSignal): boolean {
  if (!isQueuedSend(signal)) return false
  toast.info(QUEUED_SEND_TOAST_MESSAGE)
  return true
}
