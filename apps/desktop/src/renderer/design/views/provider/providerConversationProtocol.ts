export type ProviderApiKind = 'chat' | 'responses' | 'embedding'

export function isVolcengineArkConversationEndpoint(apiEndpoint: string): boolean {
  try {
    return new URL(apiEndpoint).hostname.toLowerCase() === 'ark.cn-beijing.volces.com'
  } catch {
    return false
  }
}
