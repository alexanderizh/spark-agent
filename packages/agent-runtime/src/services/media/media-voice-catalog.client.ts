/**
 * 通用音色目录请求 client。
 *
 * 渠道「音色获取」在两种情况下走这里（其余情况走厂商内置实现，见 `provider.service.ts`）：
 *   1. 用户改了模板默认值（改地址 / 改字段映射等）——按「模板默认 + 覆盖项」发请求；
 *   2. 自定义媒体渠道——完全按用户填写的请求发。
 *
 * 与 `zhipu-voice-api.ts` 的分工：那边是智谱专用（错误体是 `{error:{code,message}}`、
 * 上传 / 复刻走 multipart），这里只做「一个 JSON 请求 + 字段提取」，保持厂商无关。
 *
 * 安全性：请求头 / 请求体里的 `{{apiKey}}` 占位在这里被替换，密钥由调用方从 Keychain
 * 取出后注入，不落 profile、不写日志（日志只打方法、URL、耗时与条数）。
 */

import { createLogger, describeNetworkError } from '@spark/shared'
import type { ProviderMediaVoiceCatalogConfig, VoiceCatalogTemplateId } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'

const log = createLogger('media:voice-catalog')

const REQUEST_TIMEOUT_MS = 20_000

/** 合并后的请求计划：模板默认值 + 用户覆盖项已经扁平化，便于纯函数测试。 */
export interface VoiceCatalogRequestPlan {
  templateId: VoiceCatalogTemplateId
  /** 最终请求地址（已解析为完整 URL）。 */
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  listPath: string
  valueField: string
  labelField?: string
  privateListPaths: string[]
  privateFlagField?: string
  privateFlagValues: string[]
}

export interface VoiceCatalogSnapshot {
  options: { value: string; label?: string }[]
  privateVoices: { value: string; label?: string }[]
  officialCount: number
  privateCount: number
}

/**
 * 配置里是否填了任何**覆盖项**。
 *
 * 只有 templateId 不算覆盖：那种情况下继续走厂商内置实现，保证升级后既有渠道行为不变。
 */
export function hasVoiceCatalogOverrides(
  config: ProviderMediaVoiceCatalogConfig | undefined,
): boolean {
  if (config == null) return false
  if (nonEmpty(config.url)) return true
  if (config.method !== undefined) return true
  if (config.headers != null && Object.keys(config.headers).length > 0) return true
  if (nonEmpty(config.body)) return true
  if (nonEmpty(config.listPath)) return true
  if (nonEmpty(config.valueField)) return true
  if (nonEmpty(config.labelField)) return true
  if ((config.privateListPaths ?? []).some(nonEmpty)) return true
  if (nonEmpty(config.privateFlagField)) return true
  if ((config.privateFlagValues ?? []).some(nonEmpty)) return true
  return false
}

export interface ResolveVoiceCatalogRequestInput {
  templateId: VoiceCatalogTemplateId
  /** 模板默认值（`VOICE_CATALOG_TEMPLATES[templateId]`）。 */
  defaults: {
    path: string | null
    method: 'GET' | 'POST'
    body: string | null
    headers: Record<string, string> | null
    listPath: string
    valueField: string
    labelField: string | null
    privateListPaths: string[]
    privateFlagField: string | null
    privateFlagValues: string[]
  }
  config: ProviderMediaVoiceCatalogConfig | undefined
  /** 渠道 API Base URL。 */
  apiEndpoint: string
  /** 渠道按「完整 URL」配置：地址指向单个业务端点，无法推导子路径。 */
  apiEndpointFullUrl?: boolean
  action: string
}

/**
 * 解析最终请求计划；无法确定地址时抛可读错误（不猜测路径）。
 *
 * 地址优先级：配置里的 `url` → 模板默认 `path` + 渠道 Base URL。
 * 「完整 URL」渠道在信息不足时直接报错并引导用户填写音色获取地址 —— 这正是改造前
 * 用户拿不到音色的场景，现在有了可填的出口，但依然不做静默猜测。
 */
export function resolveVoiceCatalogRequest(
  input: ResolveVoiceCatalogRequestInput,
): VoiceCatalogRequestPlan {
  const { defaults, config, action } = input
  const explicitUrl = config?.url?.trim() ?? ''
  const listPath = (config?.listPath?.trim() || defaults.listPath).trim()
  const valueField = (config?.valueField?.trim() || defaults.valueField).trim()

  let url: string
  if (explicitUrl) {
    url = explicitUrl.startsWith('http')
      ? explicitUrl
      : joinBaseAndPath(input.apiEndpoint, explicitUrl)
    if (!/^https?:\/\//i.test(url)) {
      throw new MediaProviderError(
        'invalid_input',
        `${action}失败：请填写以 http(s) 开头的完整请求地址`,
      )
    }
  } else {
    if (!defaults.path) {
      throw new MediaProviderError('invalid_input', `${action}失败：该音色获取方式需要填写请求地址`)
    }
    if (input.apiEndpointFullUrl === true) {
      throw new MediaProviderError(
        'invalid_input',
        `该渠道配置为「完整 URL」模式，无法推导${action}地址；请在「音色获取」里填写完整请求地址后重试`,
      )
    }
    if (!input.apiEndpoint.trim()) {
      throw new MediaProviderError('provider_not_configured', `渠道未配置 API 地址，无法${action}`)
    }
    url = joinBaseAndPath(input.apiEndpoint, defaults.path)
  }

  if (!listPath) {
    throw new MediaProviderError(
      'invalid_input',
      `${action}失败：请在音色获取里填写「音色列表路径」（响应中音色数组的字段名）`,
    )
  }
  if (!valueField) {
    throw new MediaProviderError(
      'invalid_input',
      `${action}失败：请在音色获取里填写「音色值字段」（如 voice / voice_id / VoiceType）`,
    )
  }

  const headers = { ...(defaults.headers ?? {}), ...(config?.headers ?? {}) }
  const plan: VoiceCatalogRequestPlan = {
    templateId: input.templateId,
    url,
    method: config?.method ?? defaults.method,
    headers,
    listPath,
    valueField,
    privateListPaths: sanitizeList(config?.privateListPaths, defaults.privateListPaths),
    privateFlagValues: sanitizeList(config?.privateFlagValues, defaults.privateFlagValues),
  }
  const body = config?.body ?? defaults.body
  if (plan.method === 'POST' && nonEmpty(body)) plan.body = body.trim()
  const labelField = config?.labelField?.trim() || defaults.labelField
  if (nonEmpty(labelField)) plan.labelField = labelField.trim()
  const privateFlagField = config?.privateFlagField?.trim() || defaults.privateFlagField
  if (nonEmpty(privateFlagField)) plan.privateFlagField = privateFlagField.trim()
  return plan
}

/**
 * 发请求并解析音色候选。
 *
 * 非 2xx 与非法 JSON 都归一到 `MediaProviderError`（IPC 边界据此透传可读原因），
 * 与智谱 / MiniMax 专用 client 的错误口径保持一致。
 */
export async function fetchVoiceCatalogByPlan(
  plan: VoiceCatalogRequestPlan,
  auth: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<VoiceCatalogSnapshot> {
  const timeoutMs = auth.timeoutMs ?? REQUEST_TIMEOUT_MS
  const doFetch = auth.fetchImpl ?? fetch
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(plan.headers)) {
    headers[key] = interpolateApiKey(value, auth.apiKey)
  }
  const body = plan.body == null ? undefined : interpolateApiKey(plan.body, auth.apiKey)
  if (plan.method === 'POST' && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json'
  }

  const startedAt = Date.now()
  let response: Response
  try {
    response = await doFetch(plan.url, {
      method: plan.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // 传输层失败（超时 / DNS / 连接被拒）不会走到非 2xx 分支，这里归一后
    // IPC 层才能把可读原因透出去（DOMException / 'fetch failed' 对用户没有信息量）。
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`voice catalog request transport failed, url=${plan.url}, error=${message}`)
    if (name === 'TimeoutError' || /aborted due to timeout|timed out/i.test(message)) {
      const seconds = Math.ceil(timeoutMs / 1000)
      throw new MediaProviderError(
        'task_timeout',
        `同步音色超时（>${seconds}s），请检查网络、代理或接口地址后重试`,
      )
    }
    const detail = describeNetworkError(error, plan.method, plan.url) ?? message
    throw new MediaProviderError('provider_http_error', `同步音色失败：${detail}`)
  }

  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    log.warn(
      `voice catalog request failed, url=${plan.url}, status=${response.status}, ` +
        `detail=${raw.slice(0, 200)}`,
    )
    throw new MediaProviderError(
      'provider_http_error',
      `同步音色失败：HTTP ${response.status}${raw ? ` · ${raw.slice(0, 200)}` : ''}`,
      response.status,
    )
  }

  let payload: unknown
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    throw new MediaProviderError(
      'provider_http_error',
      `同步音色失败：返回内容不是合法 JSON：${raw.slice(0, 200)}`,
      response.status,
    )
  }

  const snapshot = extractVoiceCatalog(payload, plan)
  log.info('voice catalog synced by plan', {
    templateId: plan.templateId,
    total: snapshot.options.length,
    official: snapshot.officialCount,
    private: snapshot.privateCount,
    durationMs: Date.now() - startedAt,
  })
  if (snapshot.options.length === 0) {
    throw new MediaProviderError(
      'invalid_input',
      `同步成功但未解析到音色：请检查「音色列表路径」（当前 ${plan.listPath}）与「音色值字段」（当前 ${plan.valueField}）是否匹配该接口返回`,
    )
  }
  return snapshot
}

/** 从响应体按字段映射提取候选（纯函数，便于单测）。 */
export function extractVoiceCatalog(
  payload: unknown,
  plan: Pick<
    VoiceCatalogRequestPlan,
    | 'listPath'
    | 'valueField'
    | 'labelField'
    | 'privateListPaths'
    | 'privateFlagField'
    | 'privateFlagValues'
  >,
): VoiceCatalogSnapshot {
  const listed = pickPath(payload, plan.listPath)
  const mainEntries = Array.isArray(listed) ? listed : []
  const isPrivateByFlag = (item: unknown): boolean => {
    if (!plan.privateFlagField || plan.privateFlagValues.length === 0) return false
    const raw = pickPath(item, plan.privateFlagField)
    if (raw == null) return false
    const value = String(raw).trim()
    return plan.privateFlagValues.some((candidate) => candidate.trim() === value)
  }

  const seen = new Set<string>()
  const official: { value: string; label?: string }[] = []
  const flagged: { value: string; label?: string }[] = []
  for (const item of mainEntries) {
    const option = toOption(item, plan.valueField, plan.labelField)
    if (!option || seen.has(option.value)) continue
    seen.add(option.value)
    if (isPrivateByFlag(item)) {
      flagged.push(option)
      continue
    }
    official.push(option)
  }

  const privateVoices = [...flagged]
  for (const path of plan.privateListPaths) {
    const extra = pickPath(payload, path)
    if (!Array.isArray(extra)) continue
    for (const item of extra) {
      const option = toOption(item, plan.valueField, plan.labelField)
      if (!option || seen.has(option.value)) continue
      seen.add(option.value)
      privateVoices.push(option)
    }
  }

  return {
    // 官方在前、账号私有在后，与厂商专用实现（智谱 / MiniMax）的排序语义一致。
    options: [...official, ...privateVoices],
    privateVoices,
    officialCount: official.length,
    privateCount: privateVoices.length,
  }
}

function toOption(
  item: unknown,
  valueField: string,
  labelField: string | undefined,
): { value: string; label?: string } | null {
  // 支持字符串数组形态（部分渠道直接返回 ["voice-a", ...]）。
  if (typeof item === 'string' || typeof item === 'number') {
    const value = String(item).trim()
    return value ? { value } : null
  }
  if (item == null || typeof item !== 'object') return null
  const rawValue = pickPath(item, valueField)
  const value = rawValue == null ? '' : String(rawValue).trim()
  if (!value) return null
  const rawLabel = labelField ? pickPath(item, labelField) : undefined
  const label = rawLabel == null ? '' : String(rawLabel).trim()
  return label && label !== value ? { value, label } : { value }
}

/** 点路径取值：`a.b.c`；路径为空时返回原值。数组下标用数字段（如 `items.0.name`）。 */
export function pickPath(source: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed) return source
  let current: unknown = source
  for (const segment of trimmed.split('.')) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * 拼接 Base 与路径。
 *
 * 除了去尾斜杠，还要处理「Base 已经把版本段写进去」的常见配置方式
 * （`https://api.minimaxi.com/v1` + `/v1/get_voice`）：若 Base 以路径首段结尾则先剥掉，
 * 避免拼出 `/v1/v1/get_voice`。智谱那种 Base 不含路径首段的情况不受影响。
 */
function joinBaseAndPath(baseRaw: string, pathRaw: string): string {
  const base = baseRaw.trim().replace(/\/+$/, '')
  const path = pathRaw.trim()
  if (!path) return base
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!base) return normalizedPath
  const lowerBase = base.toLowerCase()
  const lowerPath = normalizedPath.toLowerCase()
  if (lowerBase.endsWith(lowerPath)) return base
  const firstSegment = normalizedPath.split('/')[1] ?? ''
  if (firstSegment) {
    const suffix = `/${firstSegment.toLowerCase()}`
    if (lowerBase.endsWith(suffix)) {
      return `${base.slice(0, base.length - suffix.length)}${normalizedPath}`
    }
  }
  return `${base}${normalizedPath}`
}

function interpolateApiKey(template: string, apiKey: string): string {
  return template.replaceAll('{{apiKey}}', apiKey)
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

/**
 * 列表类覆盖项：显式空数组（或全为空白）等同「未覆盖」，与 `hasVoiceCatalogOverrides`
 * 的判定口径保持一致 —— 否则 `privateListPaths: []` 会清空模板默认的私有音色路径
 * （MiniMax 的 voice_cloning / voice_generation 就此消失，私有音色全丢）。
 */
function sanitizeList(values: string[] | undefined, fallback: string[]): string[] {
  if (values === undefined) return [...fallback]
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0)
  return cleaned.length > 0 ? cleaned : [...fallback]
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
