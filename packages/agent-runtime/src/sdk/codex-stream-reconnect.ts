import type { AgentEvent } from '@spark/protocol'

type EventBase = Pick<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'>
type StreamReconnectSignal = Extract<AgentEvent, { type: 'runtime_signal' }>

/**
 * Codex 流式断线重连提示的统一识别与降级。
 *
 * Codex 在流式连接中断后自带最多 5 次自动重连，期间会上报形如
 * `Reconnecting... 1/5 (stream disconnected before completion: ...)` 的错误事件。
 * 这类事件是「正在自恢复」的过程信号，不是整轮失败：按 agent_error 透传会把
 * 会话渲染成红色失败卡片并污染轮次终态。这里识别该模式并降级为
 * runtime_signal(stream_reconnect)，由前端渲染成轻量提示行。
 *
 * 真正的重试耗尽（如 `exceeded retry limit, last status: 429`）不带该前缀，
 * 仍按 agent_error 上报。
 */

const RECONNECT_PATTERN = /^reconnecting\.\.\. *(\d{1,3})\/(\d{1,3})(?: *\((.*)\))?$/i

export interface CodexStreamReconnectInfo {
  attempt: number
  maxAttempts: number
  /** 括号内的原始断线原因；无括号补充时为 null。可能包含嵌套括号。 */
  reason: string | null
}

export function matchCodexStreamReconnect(message: string): CodexStreamReconnectInfo | null {
  const match = RECONNECT_PATTERN.exec(message.trim())
  if (match == null) return null
  const attempt = Number.parseInt(match[1] ?? '', 10)
  const maxAttempts = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts)) return null
  if (attempt < 1 || maxAttempts < attempt) return null
  const reason = match[3]?.trim()
  return {
    attempt,
    maxAttempts,
    ...(reason != null && reason.length > 0 ? { reason } : { reason: null }),
  }
}

/** 命中重连模式时返回 runtime_signal 事件；否则返回 null，由调用方按原逻辑上报错误。 */
export function createStreamReconnectSignal(
  message: string,
  base: EventBase,
): StreamReconnectSignal | null {
  const info = matchCodexStreamReconnect(message)
  if (info == null) return null
  return {
    ...base,
    type: 'runtime_signal',
    signal: 'stream_reconnect',
    level: 'info',
    title: '网络连接中断，正在自动重连',
    message,
    code: 'CODEX_STREAM_RECONNECT',
    retryable: false,
    details: [{ label: '重试进度', value: `${info.attempt}/${info.maxAttempts}` }],
  }
}
