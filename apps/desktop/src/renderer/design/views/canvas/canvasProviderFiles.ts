import type { ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'

export function providerFilesApiKindForProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): Extract<ProviderFilesApiKind, 'xai' | 'bailian' | 'volcengine-ark' | 'minimax-hailuo'> | null {
  if (profile.mediaProvider === 'xai') return 'xai'
  if (profile.mediaProvider === 'volcengine-ark') return 'volcengine-ark'
  if (profile.mediaProvider === 'bailian') return 'bailian'
  if (profile.mediaProvider === 'minimax-hailuo') return 'minimax-hailuo'
  // 不再凭 apiEndpoint 域名推断渠道：火山方舟等域名聊天与多媒体共用端点，
  // 仅凭 hostname 会把纯聊天渠道（如「火山 claude」）误判为多媒体渠道混入 Files 下拉。
  return null
}

export function isVolcengineArkFilesProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): boolean {
  return providerFilesApiKindForProfile(profile) === 'volcengine-ark'
}
