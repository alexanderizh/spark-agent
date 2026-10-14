/**
 * Eval-runner configuration. Endpoint normalization mirrors the engine:
 * - spark-engine/src/llm/openai/responses.ts `responsesEndpoint` (fullUrl is never
 *   set from config.toml)
 * - spark-engine/src/llm/anthropic/messages.ts `messagesEndpoint`
 * Keep these copies in sync if those functions change.
 */

const PROTOCOLS = ['openai-responses', 'anthropic-messages']
const EFFORTS = ['off', 'low', 'medium', 'high', 'max']
const SECRET_QUERY = new Set(['key', 'api_key', 'apikey', 'token', 'access_token', 'api-key'])

export function resolveEndpoint(baseUrl, protocol) {
  const normalized = String(baseUrl).replace(/\/+$/u, '')
  if (protocol === 'anthropic-messages') {
    if (normalized.endsWith('/v1/messages')) return normalized
    if (normalized.endsWith('/messages')) return normalized.replace(/\/messages$/u, '/v1/messages')
    return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`
  }
  if (protocol !== 'openai-responses') {
    throw new Error(`Unsupported SPARK_EVAL_PROTOCOL: ${protocol}`)
  }
  const withV1 = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
  return `${withV1}/responses`
}

export function endpointWarnings(baseUrl, protocol) {
  if (protocol !== 'openai-responses') return []
  if (/\/chat\/completions\b/u.test(baseUrl) || /\/api\/v3\b/u.test(baseUrl)) {
    return [
      'spark-engine speaks the OpenAI Responses API (POST …/responses), not Chat Completions. Volcengine Ark and many "OpenAI-compatible" gateways only expose /chat/completions; the URL above will not hit that route. Point ARK_BASE_URL at a Responses-capable root, or set SPARK_EVAL_PROTOCOL=anthropic-messages for an Anthropic-compatible gateway.',
    ]
  }
  return []
}

export function assertPublicBaseUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('ARK_BASE_URL must be an absolute http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ARK_BASE_URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('ARK_BASE_URL must not embed credentials')
  }
  for (const name of url.searchParams.keys()) {
    if (SECRET_QUERY.has(name.toLowerCase())) {
      throw new Error('ARK_BASE_URL must not carry credential query parameters')
    }
  }
  return url.toString().replace(/\/$/u, '')
}

export function tomlBasicString(value) {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`
}

function positiveInt(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function buildProjectConfig(options) {
  if (!PROTOCOLS.includes(options.protocol)) {
    throw new Error(`Unsupported SPARK_EVAL_PROTOCOL: ${options.protocol}`)
  }
  const baseUrl = assertPublicBaseUrl(options.baseUrl)
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(options.apiKeyEnv)) {
    throw new Error('API key environment name is invalid')
  }
  const model = options.model.trim()
  if (!model) throw new Error('ARK_MODEL is empty')
  const contextWindow = positiveInt(options.contextWindow, 'SPARK_EVAL_CONTEXT_WINDOW')
  const maxTokens = positiveInt(options.maxTokens, 'SPARK_EVAL_MAX_TOKENS')
  return [
    '[agent]',
    'model = "ark"',
    '',
    '[providers.ark]',
    `protocol = ${tomlBasicString(options.protocol)}`,
    `base_url = ${tomlBasicString(baseUrl)}`,
    `api_key_env = ${tomlBasicString(options.apiKeyEnv)}`,
    '',
    '[models.ark]',
    'provider = "ark"',
    `model = ${tomlBasicString(model)}`,
    `context_window = ${contextWindow}`,
    `max_tokens = ${maxTokens}`,
    '',
    '[permissions]',
    'mode = "bypass"',
    '',
    '[tools]',
    'disabled = ["web_search", "web_fetch", "task"]',
    '',
    '[memory]',
    'enabled = false',
    '',
  ].join('\n')
}

export function redactSecrets(text, secrets) {
  let out = String(text)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      out = out.split(secret).join('[REDACTED]')
    }
  }
  return out
}

export function preview(value, limit = 240) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

export function loadEvalSettings(env) {
  const missing = ['ARK_BASE_URL', 'ARK_API_KEY', 'ARK_MODEL'].filter((name) => !env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'The runner reads them from the environment and never writes the key into git or the report.',
    )
  }
  const protocol = env.SPARK_EVAL_PROTOCOL?.trim() || 'openai-responses'
  const effort = env.SPARK_EVAL_EFFORT?.trim() || 'off'
  if (!PROTOCOLS.includes(protocol)) {
    throw new Error(`Unsupported SPARK_EVAL_PROTOCOL: ${protocol}`)
  }
  if (!EFFORTS.includes(effort)) throw new Error(`Unsupported SPARK_EVAL_EFFORT: ${effort}`)
  const contextWindow = env.SPARK_EVAL_CONTEXT_WINDOW
    ? Number(env.SPARK_EVAL_CONTEXT_WINDOW)
    : 128_000
  const maxTokens = env.SPARK_EVAL_MAX_TOKENS ? Number(env.SPARK_EVAL_MAX_TOKENS) : 16_000
  const baseUrl = assertPublicBaseUrl(env.ARK_BASE_URL.trim())
  const toml = buildProjectConfig({
    baseUrl,
    apiKeyEnv: 'ARK_API_KEY',
    model: env.ARK_MODEL.trim(),
    protocol,
    contextWindow,
    maxTokens,
  })
  if (toml.includes(env.ARK_API_KEY.trim())) {
    throw new Error('Refusing to write project config because it would contain ARK_API_KEY')
  }
  return {
    baseUrl,
    apiKey: env.ARK_API_KEY,
    model: env.ARK_MODEL.trim(),
    protocol,
    effort,
    contextWindow,
    maxTokens,
    endpoint: resolveEndpoint(baseUrl, protocol),
    warnings: endpointWarnings(baseUrl, protocol),
    toml,
  }
}
