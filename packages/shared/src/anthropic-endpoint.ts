/**
 * @module anthropic-endpoint
 *
 * Anthropic 兼容端点的归一化规则（单一事实来源）。
 *
 * 背景：渠道配置里的 `apiEndpoint` 允许三种写法，历史上各处调用点各写一套判断，
 * 导致同类端点在不同功能里表现不一致：
 *   - 根地址：`https://api.stepfun.com/step_plan`（推荐，claude CLI 文档写法）
 *   - 版本地址：`https://openrouter.ai/api/v1`
 *   - 完整 messages 地址：`https://api.stepfun.com/step_plan/v1/messages`
 *
 * - 直连 HTTP 调用（自建 fetch）需要「恰好一个 `/v1/messages` 后缀」 → `resolveAnthropicMessagesUrl`
 * - `ANTHROPIC_BASE_URL`（claude CLI / Claude Agent SDK）需要**裸根地址**，因为 SDK 会
 *   自行追加 `/v1/messages`。把完整 messages 地址原样塞进去会拼成
 *   `…/v1/messages/v1/messages` → 404（实测 stepfun 返回 404 空体）。→ `resolveAnthropicBaseUrl`
 */

/** 未配置端点时的官方默认根地址。 */
export const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com'

const MESSAGES_SUFFIX = '/v1/messages'
const BARE_MESSAGES_SUFFIX = '/messages'

/** 去掉首尾空白与尾部斜杠；空值回落官方默认端点。 */
export function normalizeAnthropicEndpoint(endpoint?: string | null): string {
  const trimmed = endpoint?.trim()
  return (trimmed != null && trimmed.length > 0 ? trimmed : DEFAULT_ANTHROPIC_ENDPOINT).replace(
    /\/+$/u,
    '',
  )
}

/**
 * 归一化为 `ANTHROPIC_BASE_URL` 可用的根地址：依次摘掉 `/v1/messages`、`/messages`、
 * 末尾版本段（`/v1`、`/v2` …），保证 SDK 追加一次 `/v1/messages` 后路径不重复。
 */
export function resolveAnthropicBaseUrl(endpoint?: string | null): string {
  let base = normalizeAnthropicEndpoint(endpoint)
  if (base.endsWith(MESSAGES_SUFFIX)) base = base.slice(0, -MESSAGES_SUFFIX.length)
  else if (base.endsWith(BARE_MESSAGES_SUFFIX)) base = base.slice(0, -BARE_MESSAGES_SUFFIX.length)
  else if (/\/v\d+$/u.test(base)) base = base.replace(/\/v\d+$/u, '')
  return base.replace(/\/+$/u, '')
}

/** 归一化为恰好一个 `/v1/messages` 后缀的完整 messages 地址（直连 HTTP 调用用）。 */
export function resolveAnthropicMessagesUrl(endpoint?: string | null): string {
  return `${resolveAnthropicBaseUrl(endpoint)}${MESSAGES_SUFFIX}`
}
