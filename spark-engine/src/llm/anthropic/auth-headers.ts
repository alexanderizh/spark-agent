/**
 * Anthropic 兼容端点的认证头投放规则。
 *
 * 与桌面端 `@spark/shared/anthropic-auth` 保持同一套规则（该包独立发布，无法直接
 * 复用 workspace 依赖，因此在此保留等价实现）：
 *   - 官方 `*.anthropic.com`（含未配置 baseUrl 的默认端点）：单头。`sk-ant-oat*`
 *     这类 OAuth token 走 Bearer，其余走 `x-api-key`。
 *   - 第三方 Anthropic 兼容端点（阶跃 / GLM / Kimi / 中转站等）：两种凭据同时投放，
 *     因为不同渠道只认其中一种，单投会出现「key 正确但 401」。
 */

const OFFICIAL_ANTHROPIC_HOST = 'anthropic.com'
const OAUTH_TOKEN_PATTERN = /^sk-ant-oat/i

function isOfficialAnthropicEndpoint(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim()
  if (trimmed == null || trimmed.length === 0) return true
  let host: string | null = null
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const parsed = new URL(candidate).hostname.toLowerCase()
      if (parsed.length > 0) {
        host = parsed
        break
      }
    } catch {
      // try next candidate
    }
  }
  if (host == null) return false
  return host === OFFICIAL_ANTHROPIC_HOST || host.endsWith(`.${OFFICIAL_ANTHROPIC_HOST}`)
}

/** 返回该端点应携带的认证头。 */
export function anthropicAuthHeaders(
  baseUrl: string | undefined,
  apiKey: string,
): Record<string, string> {
  if (isOfficialAnthropicEndpoint(baseUrl)) {
    return apiKey.trim().length > 0 && OAUTH_TOKEN_PATTERN.test(apiKey.trim())
      ? { authorization: `Bearer ${apiKey}` }
      : { 'x-api-key': apiKey }
  }
  if (apiKey.trim().length === 0) return { 'x-api-key': apiKey }
  return { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}` }
}
