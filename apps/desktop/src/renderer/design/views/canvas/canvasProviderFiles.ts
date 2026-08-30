import type { ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'

export function providerFilesApiKindForProfile(
  profile: Partial<
    Pick<
      ProviderProfile,
      'apiEndpoint' | 'mediaProvider' | 'provider' | 'modelType' | 'defaultModel'
    >
  >,
): Extract<ProviderFilesApiKind, 'xai' | 'bailian' | 'volcengine-ark' | 'minimax-hailuo'> | null {
  if (profile.mediaProvider === 'xai') return 'xai'
  if (profile.mediaProvider === 'volcengine-ark') return 'volcengine-ark'
  if (profile.mediaProvider === 'bailian') return 'bailian'
  if (profile.mediaProvider === 'minimax-hailuo') return 'minimax-hailuo'
  if (
    (profile.provider === 'volcengine' ||
      profile.apiEndpoint?.toLowerCase().includes('ark.cn-beijing.volces.com') === true) &&
    typeof profile.defaultModel === 'string' &&
    ((profile.modelType === 'video' && /^doubao-seedance-/i.test(profile.defaultModel)) ||
      (profile.modelType === 'image' && /^doubao-seedream-/i.test(profile.defaultModel)))
  ) {
    return 'volcengine-ark'
  }
  // 不再凭 apiEndpoint 域名推断渠道：火山方舟等域名聊天与多媒体共用端点，
  // 仅凭 hostname 会把纯聊天渠道（如「火山 claude」）误判为多媒体渠道混入 Files 下拉。
  return null
}

export function isVolcengineArkFilesProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): boolean {
  return providerFilesApiKindForProfile(profile) === 'volcengine-ark'
}
