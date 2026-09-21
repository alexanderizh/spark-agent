export type ProviderCardKind = 'cli' | 'image' | 'video' | 'voice' | 'text' | 'auto-router'

/** 图片、视频卡片的健康检查仍走文本模型测试链路，因此不提供测试入口。 */
export function canHealthCheckProviderCardKind(cardKind: ProviderCardKind): boolean {
  if (cardKind === 'image' || cardKind === 'video') return false
  // 自动路由没有可直接探测的 HTTP 端点，连通性由弹窗内「测试分流器」负责。
  if (cardKind === 'auto-router') return false
  return true
}
