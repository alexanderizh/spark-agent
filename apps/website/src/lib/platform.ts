export type PlatformId = 'mac' | 'windows' | 'unknown'
export type CpuArch = 'arm64' | 'x64' | 'unknown'

export interface PlatformGuess {
  platform: PlatformId
  arch: CpuArch
  label: string
}

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string
    getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ architecture?: string; platform?: string }>
  }
}

export async function detectPlatform(): Promise<PlatformGuess> {
  const nav = navigator as NavigatorWithUAData
  const uaPlatform = nav.userAgentData?.platform ?? navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  let arch: CpuArch = /arm|aarch64/i.test(ua)
    ? 'arm64'
    : /x86_64|Win64|x64|amd64/i.test(ua)
      ? 'x64'
      : 'unknown'

  if (nav.userAgentData?.getHighEntropyValues) {
    try {
      const high = await nav.userAgentData.getHighEntropyValues(['architecture', 'platform'])
      if (/arm/i.test(high.architecture ?? '')) arch = 'arm64'
      if (/x86/i.test(high.architecture ?? '')) arch = 'x64'
      return toGuess(high.platform ?? uaPlatform, ua, arch)
    } catch {
      // Browser privacy settings may block high entropy hints; fallback below.
    }
  }

  return toGuess(uaPlatform, ua, arch)
}

function toGuess(platformText: string, ua: string, arch: CpuArch): PlatformGuess {
  const text = `${platformText} ${ua}`
  if (/mac|darwin/i.test(text))
    return { platform: 'mac', arch, label: arch === 'arm64' ? 'macOS Apple Silicon' : 'macOS' }
  if (/win/i.test(text))
    return { platform: 'windows', arch: arch === 'unknown' ? 'x64' : arch, label: 'Windows' }
  return { platform: 'unknown', arch: 'unknown', label: '选择你的平台' }
}
