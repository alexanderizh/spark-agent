/** 小程序端统一实时日志入口；日志参数必须避开消息正文、凭据和用户标识。 */

export function logMobileError(scope: string, stage: string, error: unknown): void {
  try {
    const manager = wx.getRealtimeLogManager()
    const errorType = error instanceof Error ? error.name : typeof error
    manager.error(`[${scope}] ${stage}`, errorType)
  } catch {
    // 日志服务不可用时不影响页面的错误提示与恢复操作。
  }
}
