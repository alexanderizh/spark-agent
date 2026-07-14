export type ProviderCardKind = 'router' | 'cli' | 'image' | 'video' | 'voice' | 'text'

/** 图片、视频卡片的健康检查仍走文本模型测试链路，因此不提供测试入口。 */
export function canHealthCheckProviderCardKind(cardKind: ProviderCardKind): boolean {
  return cardKind !== 'router' && cardKind !== 'image' && cardKind !== 'video'
}
