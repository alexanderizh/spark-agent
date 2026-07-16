import type { ProviderProfile } from '@spark/protocol'

export function isVolcengineArkFilesProfile(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): boolean {
  if (profile.mediaProvider === 'volcengine-ark') return true
  if (!profile.apiEndpoint?.trim()) return false
  try {
    return new URL(profile.apiEndpoint).hostname.toLowerCase() === 'ark.cn-beijing.volces.com'
  } catch {
    return false
  }
}
