export type ProviderApiKind = 'chat' | 'responses' | 'embedding'

export function resolveProviderProtocolEndpoint(
  apiEndpoint: string,
  apiKind: ProviderApiKind,
): string | null {
  const value = apiEndpoint.trim().replace(/\/+$/, '')
  if (!value) return null
  try {
    const url = new URL(value)
    const suffix =
      apiKind === 'responses'
        ? '/responses'
        : apiKind === 'embedding'
          ? '/embeddings'
          : '/chat/completions'
    const knownSuffixes = ['/chat/completions', '/responses', '/embeddings']
    const matchedSuffix = knownSuffixes.find((candidate) => url.pathname.endsWith(candidate))
    if (matchedSuffix) {
      url.pathname = `${url.pathname.slice(0, -matchedSuffix.length)}${suffix}`
    } else {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}${suffix}`
    }
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function isVolcengineArkConversationEndpoint(apiEndpoint: string): boolean {
  try {
    return new URL(apiEndpoint).hostname.toLowerCase() === 'ark.cn-beijing.volces.com'
  } catch {
    return false
  }
}
