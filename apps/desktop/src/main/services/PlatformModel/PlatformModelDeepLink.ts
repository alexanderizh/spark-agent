const REDEEM_PROTOCOL = 'spark-agent:'
const MAX_REDEEM_CODE_LENGTH = 256

export function parsePlatformModelRedeemDeepLink(value: string): string | null {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    return null
  }
  if (target.protocol !== REDEEM_PROTOCOL || target.hostname !== 'redeem') return null
  const code = target.searchParams.get('code')?.trim() ?? ''
  if (!code || code.length > MAX_REDEEM_CODE_LENGTH || /[\s\p{Cc}]/u.test(code)) return null
  return code
}

export function findPlatformModelRedeemCode(values: readonly string[]): string | null {
  for (const value of values) {
    const code = parsePlatformModelRedeemDeepLink(value)
    if (code) return code
  }
  return null
}
