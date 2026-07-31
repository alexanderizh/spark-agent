import type { ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'

export function providerFilesApiKindForProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): Extract<ProviderFilesApiKind, 'bailian' | 'volcengine-ark' | 'minimax-hailuo'> | null {
  if (profile.mediaProvider === 'volcengine-ark') return 'volcengine-ark'
  if (profile.mediaProvider === 'bailian') return 'bailian'
  if (profile.mediaProvider === 'minimax-hailuo') return 'minimax-hailuo'
  if (!profile.apiEndpoint?.trim()) return null
  try {
    const hostname = new URL(profile.apiEndpoint).hostname.toLowerCase()
    if (hostname === 'ark.cn-beijing.volces.com') return 'volcengine-ark'
    if (hostname === 'dashscope.aliyuncs.com') return 'bailian'
    if (hostname === 'api.minimaxi.com') return 'minimax-hailuo'
    return null
  } catch {
    return null
  }
}

export function isVolcengineArkFilesProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): boolean {
  return providerFilesApiKindForProfile(profile) === 'volcengine-ark'
}
