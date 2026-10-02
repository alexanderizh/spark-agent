/**
 * 远程出站投递的重试与错误描述工具。
 *
 * 远程渠道（Telegram/QQ/飞书/微信）的出站请求走主进程 Node fetch，
 * 网络瞬断（代理切换、链路重置、DNS 抖动）会以 `TypeError: fetch failed`
 * 的形式抛出，且 undici 把真实原因放在 `error.cause` 上，仅打印 message
 * 会丢失诊断信息。这类瞬态错误重试大概率可恢复；而 4xx 属于请求本身的
 * 问题，重试无意义。这里集中做错误分类与重试节拍，避免各渠道各自为政。
 */

/** 瞬态失败的重试间隔：1s / 4s / 12s，总窗口约 17s，覆盖常见代理切换抖动。 */
export const REMOTE_DELIVERY_RETRY_DELAYS_MS = [1_000, 4_000, 12_000] as const

// Node/undici 连接层错误码：重试有恢复概率。
const TRANSIENT_ERROR_CODE_RE =
  /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_ABORTED)$/i

// 错误消息特征：网络瞬断、超时、服务端过载（postJson 抛出的 "… failed: 500 …"）。
const TRANSIENT_MESSAGE_RE =
  /(?:fetch failed|socket hang up|network|timeout|timed out|aborted|connection reset|connection refused|connection closed|other side closed|failed: 5\d\d|failed: 429)/i

/**
 * 判断远程出站错误是否值得重试：只对网络瞬断与服务端过载重试，
 * 4xx（token 无效、消息格式错误等）立即失败，避免无意义等待。
 */
export function isTransientDeliveryError(error: unknown): boolean {
  if (typeof error === 'string') return TRANSIENT_MESSAGE_RE.test(error)
  if (!(error instanceof Error)) return false
  if (
    TRANSIENT_ERROR_CODE_RE.test(error.message) ||
    TRANSIENT_MESSAGE_RE.test(error.message) ||
    TRANSIENT_MESSAGE_RE.test(error.name)
  ) {
    return true
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause != null) return isTransientDeliveryError(cause)
  return false
}

/** 把 error.cause 链展开成一段可读文本，让 fetch failed 背后的真实错误码可见。 */
export function describeDeliveryError(error: unknown): string {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  const causeText = cause != null ? ` (cause: ${describeDeliveryError(cause)})` : ''
  if (error instanceof Error) return `${error.message}${causeText}`
  return String(error) + causeText
}

/** 按重试计划执行一次投递；仅瞬态错误重试，非瞬态错误原样抛出。 */
export async function deliverWithRetry(
  send: () => Promise<void>,
  options: {
    delaysMs?: readonly number[]
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  } = {},
): Promise<void> {
  const delays = options.delaysMs ?? REMOTE_DELIVERY_RETRY_DELAYS_MS
  let attempt = 0
  for (;;) {
    try {
      await send()
      return
    } catch (error) {
      attempt += 1
      const delay = delays[attempt - 1]
      if (delay == null || !isTransientDeliveryError(error)) throw error
      options.onRetry?.(attempt, delay, error)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
