/**
 * 桥接错误类型。
 *
 * 单独成文件的原因：`bridge.ts`（直连传输）与 `relay.ts`（云端中继传输）都要抛同一类错误，
 * 互相 import 会形成循环依赖，所以把错误与提示文案抽到最底层。
 *
 * 只抛一句「配对失败」没有任何排查价值，所以把失败原因分类并带上可执行的提示。
 */

export type BridgeErrorReason =
  | 'NO_URL'
  | 'NETWORK'
  | 'DOMAIN'
  | 'DISABLED'
  | 'EXPIRED'
  | 'AUTH'
  | 'OFFLINE'
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
  NO_URL: '先在下方填写桌面端地址，或点「扫码」扫设置页的二维码',
  NETWORK: '确认手机与电脑在同一 Wi-Fi、桌面端「移动端桥接」已开启、端口未被防火墙拦截',
  DOMAIN:
    '开发期请在开发者工具「详情 → 本地设置」勾选「不校验合法域名」；正式版需在 mp 后台配置 request 合法域名',
  DISABLED: '请到桌面端「设置 → 生态 → 移动端桥接」打开开关',
  EXPIRED: '设备令牌已失效，请重新配对',
  AUTH: '两端必须登录同一个 edu-server 账号，请检查后重新配对',
  OFFLINE:
    '电脑端没连上云端中继：请在桌面端「设置 → 生态 → 移动端桥接」确认「云端中继」已开启，且电脑处于联网状态',
  SERVER: '桌面端返回了错误，可在桌面端日志中查看原因',
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
