/**
 * 桥接错误类型。
 *
 * 单独成文件的原因：`bridge.ts`（门面）与 `relay.ts`（云端中继传输）都要抛同一类错误，
 * 互相 import 会形成循环依赖，所以把错误与提示文案抽到最底层。
 *
 * 云端中继是唯一传输（局域网直连已移除），错误原因只保留中继语义；
 * 只抛一句「连接失败」没有任何排查价值，所以把失败原因分类并带上可执行的提示。
 */

export type BridgeErrorReason =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTH'
  | 'DISABLED'
  | 'DESKTOP_OFFLINE'
  | 'SERVER'
  | 'UNKNOWN'

export class BridgeError extends Error {
  readonly reason: BridgeErrorReason
  /** 给用户的下一步建议 */
  readonly hint: string

  constructor(reason: BridgeErrorReason, message: string, hint: string) {
    super(message)
    this.name = 'BridgeError'
    this.reason = reason
    this.hint = hint
  }
}

export const BRIDGE_HINTS: Record<BridgeErrorReason, string> = {
  NETWORK: '请检查手机网络后重试；小程序经 Spark 平台服务中转，正常网络均可访问',
  TIMEOUT: '电脑端响应超时，请稍后重试',
  AUTH: '两端必须登录同一个 Spark 平台账号，请在本机重新登录后再试',
  DISABLED: '请到桌面端「设置 → 生态 → 移动端桥接」打开云端中继开关',
  DESKTOP_OFFLINE:
    '电脑端没连上云端中继：请在桌面端「设置 → 生态 → 移动端桥接」确认「云端中继」已开启，且电脑处于联网状态',
  SERVER: '电脑端返回了错误，可在桌面端日志中查看原因',
  UNKNOWN: '可重试一次，仍失败请查看桌面端日志',
}

export function normalizeBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new BridgeError('UNKNOWN', message, BRIDGE_HINTS.UNKNOWN)
}

/** 把任意错误转成一段可直接展示给用户的文案 */
export function describeBridgeError(error: unknown): { message: string; hint: string } {
  const e = normalizeBridgeError(error)
  return { message: e.message, hint: e.hint }
}
