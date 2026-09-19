/**
 * @module anthropic-auth
 *
 * Anthropic 兼容渠道的凭据投放规则（单一事实来源）。
 *
 * 背景：Claude Code / Claude Agent SDK 支持两种凭据投放方式，对应两个不同的 HTTP 头：
 *   - `ANTHROPIC_API_KEY`    → `x-api-key: <key>`
 *   - `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer <key>`
 * 第三方 Anthropic 兼容渠道（阶跃星辰 `step_plan`、GLM、Kimi、MiniMax 等国产端点官方
 * 文档多写 `ANTHROPIC_AUTH_TOKEN`；多数中转站只认 `ANTHROPIC_API_KEY`）通常只接受其中
 * 一种，只投放单头会出现「key 正确但 401」。
 *
 * 投放规则：
 *   - 官方 Anthropic 端点（`api.anthropic.com` 等 `*.anthropic.com`，或不填端点走默认）：
 *     保持单头，按 key 前缀归类 —— `sk-ant-oat*` 是 OAuth token 走 Bearer，其余走 x-api-key。
 *     这与 claude CLI 自身的归类一致，避免给官方端点发送它不认的 Bearer。
 *   - 其它（第三方 / 自建端点）：同时投放两种凭据。claude CLI 在同时设置这两个环境变量时
 *     本身也是同时发送 `x-api-key` 与 `Authorization: Bearer`，渠道按自己支持的那个取用。
 */

/** 凭据投放方式：单 API Key、单 OAuth 风格 Bearer token、或两者同时投放。 */
export type AnthropicAuthMode = 'api-key' | 'auth-token' | 'dual'

/** 环境变量名（claude CLI / Claude Agent SDK 读取的键名）。 */
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY'
export const ANTHROPIC_AUTH_TOKEN_ENV = 'ANTHROPIC_AUTH_TOKEN'

/** 认证相关环境变量名列表；注入前需要清掉上游残留的同名键。 */
export const ANTHROPIC_AUTH_ENV_KEYS = [ANTHROPIC_API_KEY_ENV, ANTHROPIC_AUTH_TOKEN_ENV] as const

const OFFICIAL_ANTHROPIC_HOST = 'anthropic.com'

/** OAuth 风格凭据前缀：claude CLI 对 `sk-ant-oat*` 固定走 `Authorization: Bearer`。 */
const ANTHROPIC_OAUTH_TOKEN_PATTERN = /^sk-ant-oat/i

/** 解析端点主机名；无 scheme 时按 https 兜底；无法解析返回 null。 */
function resolveEndpointHost(endpoint: string): string | null {
  const trimmed = endpoint.trim()
  if (trimmed.length === 0) return null
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const host = new URL(candidate).hostname.toLowerCase()
      if (host.length > 0) return host
    } catch {
      // try next candidate
    }
  }
  return null
}

/**
 * 是否为 Anthropic 官方端点。端点为空视为官方（SDK 默认打到 api.anthropic.com）；
 * 无法解析的自定义端点视为第三方。
 */
export function isOfficialAnthropicEndpoint(endpoint?: string | null): boolean {
  const trimmed = endpoint?.trim()
  if (trimmed == null || trimmed.length === 0) return true
  const host = resolveEndpointHost(trimmed)
  if (host == null) return false
  return host === OFFICIAL_ANTHROPIC_HOST || host.endsWith(`.${OFFICIAL_ANTHROPIC_HOST}`)
}

/** 按端点与 key 形态决定凭据投放方式。 */
export function resolveAnthropicAuthMode(
  endpoint: string | undefined,
  apiKey: string | undefined,
): AnthropicAuthMode {
  const key = apiKey?.trim() ?? ''
  if (isOfficialAnthropicEndpoint(endpoint)) {
    return key.length > 0 && ANTHROPIC_OAUTH_TOKEN_PATTERN.test(key) ? 'auth-token' : 'api-key'
  }
  return key.length > 0 ? 'dual' : 'api-key'
}

/**
 * 直连 HTTP 调用（fetch）使用的认证头。第三方端点同时带上两种凭据，
 * 官方端点只带一种，避免官方端点上出现它不认的 Bearer。
 */
export function buildAnthropicAuthHeaders(
  endpoint: string | undefined,
  apiKey: string,
): Record<string, string> {
  const mode = resolveAnthropicAuthMode(endpoint, apiKey)
  if (mode === 'auth-token') return { authorization: `Bearer ${apiKey}` }
  if (mode === 'dual') return { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}` }
  return { 'x-api-key': apiKey }
}

/**
 * 注入 claude CLI / Claude Agent SDK 子进程环境所用的认证键。
 * 空 key 时只写 API_KEY 槽位，不制造空的 Bearer 凭据。
 */
export function buildAnthropicAuthEnv(
  endpoint: string | undefined,
  apiKey: string,
): Record<string, string> {
  const mode = resolveAnthropicAuthMode(endpoint, apiKey)
  if (mode === 'auth-token') return { [ANTHROPIC_AUTH_TOKEN_ENV]: apiKey }
  if (mode === 'dual') {
    return {
      [ANTHROPIC_API_KEY_ENV]: apiKey,
      [ANTHROPIC_AUTH_TOKEN_ENV]: apiKey,
    }
  }
  return { [ANTHROPIC_API_KEY_ENV]: apiKey }
}
