import type { ProviderMediaDefaults } from '@spark/protocol'

// Provider schema 对新配置要求至少 1 秒；运行时仍接受历史数据和毫秒级测试值。
const MIN_MEDIA_TIMEOUT_MS = 1
const MAX_MEDIA_TIMEOUT_MS = 172_800_000

/** 读取用户配置的统一接口超时，并兼容旧版 polling.timeoutMs。 */
export function configuredMediaInterfaceTimeoutMs(
  defaults: ProviderMediaDefaults | undefined,
): number | undefined {
  return (
    validMediaTimeoutMs(defaults?.timeoutMs) ?? validMediaTimeoutMs(defaults?.polling?.timeoutMs)
  )
}

/** 优先使用 Provider 配置；未配置时保留调用方原有默认值。 */
export function resolveMediaInterfaceTimeoutMs(
  defaults: ProviderMediaDefaults | undefined,
  fallbackMs: number,
): number {
  return configuredMediaInterfaceTimeoutMs(defaults) ?? fallbackMs
}

/** 轮询总时限始终有默认值；只有用户配置时才覆盖单次 HTTP 请求时限。 */
export function mediaPollTimeoutOptions(
  defaults: ProviderMediaDefaults | undefined,
  fallbackMs: number,
): { timeoutMs: number; requestTimeoutMs?: number } {
  const configuredTimeoutMs = configuredMediaInterfaceTimeoutMs(defaults)
  return {
    timeoutMs: configuredTimeoutMs ?? fallbackMs,
    ...(configuredTimeoutMs != null ? { requestTimeoutMs: configuredTimeoutMs } : {}),
  }
}

function validMediaTimeoutMs(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MEDIA_TIMEOUT_MS &&
    value <= MAX_MEDIA_TIMEOUT_MS
    ? value
    : undefined
}
