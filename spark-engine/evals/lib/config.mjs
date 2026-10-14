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

const ARK_CODING_ANTHROPIC = 'https://ark.cn-beijing.volces.com/api/coding'
const ARK_CODING_OPENAI = 'https://ark.cn-beijing.volces.com/api/coding/v3'

/**
 * Fail closed before a live or dry run when the base URL is an Ark-style coding
 * or Chat Completions root that spark-engine would mis-address.
 *
 * In-repo evidence (do not invent a third protocol here):
 * - packages/protocol/src/provider-presets.ts `volcengine-ark-anthropic` uses
 *   exactly `https://ark.cn-beijing.volces.com/api/coding` with provider anthropic.
 * - The same file's `volcengine-ark-openai` uses `…/api/coding/v3` with
 *   codexApiKind `responses`. The desktop client posts `{base}/responses` when
 *   the path already ends in `vN`, or `{base}/chat/completions` for chat.
 *   spark-engine's CLI joiner always inserts `/v1` (`responsesEndpoint`), so
 *   `…/api/coding/v3` would become `…/v3/v1/responses`.
 * - `volcengine-ark-seed21` uses `…/api/v3` with codexApiKind `chat`.
 *   spark-engine has no Chat Completions adapter
 *   (`resolveSparkUpstreamProtocol` rejects `chat`).
 */
export function endpointRefusal(baseUrl, protocol) {
  const path = new URL(baseUrl).pathname.replace(/\/+$/u, '')
  const codingFamily = /\/api\/coding(?:\/|$)/iu.test(path) || /\/coding\/v\d+$/iu.test(path)
  const bareCodingPlan = /\/api\/coding$/iu.test(path)
  const responsesRoot = /\/v1$/iu.test(path)
  const would = resolveEndpoint(baseUrl, protocol)

  if (protocol === 'anthropic-messages' && bareCodingPlan) return null
  if (protocol === 'openai-responses' && responsesRoot) return null

  if (codingFamily && protocol === 'openai-responses') {
    return [
      `Refusing ARK_BASE_URL ${baseUrl} with SPARK_EVAL_PROTOCOL=openai-responses.`,
      `spark-engine would POST ${would}. That is not an Ark Coding request this repo sends.`,
      `${ARK_CODING_ANTHROPIC} is the Anthropic Coding Plan preset (volcengine-ark-anthropic). Set SPARK_EVAL_PROTOCOL=anthropic-messages. The CLI then calls ${ARK_CODING_ANTHROPIC}/v1/messages.`,
      `${ARK_CODING_OPENAI} is the OpenAI Coding preset. This repo's provider client posts ${ARK_CODING_OPENAI}/responses when the API kind is responses, or ${ARK_CODING_OPENAI}/chat/completions when the wire API is chat. spark-engine's CLI config path always inserts /v1 and has no Chat Completions adapter, so this harness will not send the call.`,
      'openai-responses here requires a base that already ends in /v1, for example https://api.openai.com/v1, which is called as https://api.openai.com/v1/responses.',
    ].join('\n')
  }

  if (codingFamily && protocol === 'anthropic-messages') {
    return [
      `Refusing ARK_BASE_URL ${baseUrl} with SPARK_EVAL_PROTOCOL=anthropic-messages.`,
      `spark-engine would POST ${would}.`,
      `The in-repo Anthropic Coding Plan base is exactly ${ARK_CODING_ANTHROPIC} with no /v3 segment. A versioned /api/coding/vN or /coding/vN URL is the OpenAI preset, not that Anthropic root.`,
      `Set ARK_BASE_URL=${ARK_CODING_ANTHROPIC} with SPARK_EVAL_PROTOCOL=anthropic-messages, or point openai-responses at a base that already ends in /v1.`,
    ].join('\n')
  }

  if (
    protocol === 'openai-responses' &&
    (/\/chat\/completions\b/iu.test(path) || /\/api\/v3(?:\/|$)/iu.test(path))
  ) {
    return [
      `Refusing ARK_BASE_URL ${baseUrl} with SPARK_EVAL_PROTOCOL=openai-responses.`,
      `spark-engine would POST ${would}.`,
      'Paths containing /api/v3 or /chat/completions are Chat Completions in this repo (volcengine-ark-seed21 uses https://ark.cn-beijing.volces.com/api/v3 with codexApiKind chat). spark-engine has no chat/completions adapter.',
      `Use a Responses base that already ends in /v1, or ${ARK_CODING_ANTHROPIC} with SPARK_EVAL_PROTOCOL=anthropic-messages.`,
    ].join('\n')
  }

  return null
}

export function endpointWarnings(baseUrl, protocol) {
  const refusal = endpointRefusal(baseUrl, protocol)
  return refusal ? [refusal] : []
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
  const refusal = endpointRefusal(baseUrl, protocol)
  if (refusal) {
    if (refusal.includes(env.ARK_API_KEY.trim())) {
      throw new Error(
        'Refusing this base URL, and the explanation unexpectedly contained ARK_API_KEY',
      )
    }
    throw new Error(refusal)
  }
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
