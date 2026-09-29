/**
 * MiniMax 音色目录同步。
 *
 * 与智谱同理：MiniMax 的音色是**动态资源**——除系统音色外，用户还能通过
 * 「快速复刻（voice_cloning）」与「文生音色（voice_generation）」产出账号私有音色。
 * manifest 里只能塞一份精选 `examples`（见 minimaxSpeechSchema），因此提供本同步能力：
 * 调 `POST /v1/get_voice` 拉取音色清单，转换成平台通用的动态参数候选
 * （`mediaDynamicParamOptions`），由调用方持久化到 Provider profile，
 * 画布 / 快速创作 / 语音助手再通过共享 manifest 解析自动继承。
 *
 * 接口事实核对自官方文档 https://platform.minimax.io/docs/api-reference/voice-management-get
 * （2026-09-30 复核）：
 *   - `POST /v1/get_voice`，Header `Authorization: Bearer <api key>`，无需 GroupId
 *   - Body：`{ voice_type: 'system' | 'voice_cloning' | 'voice_generation' | 'all' }`
 *   - Response：`{ system_voice: [{ voice_id, voice_name, description[], created_time }],
 *                  voice_cloning: [{ voice_id, ... }], voice_generation: [{ voice_id, ... }],
 *                  base_resp: { status_code, status_msg } }`
 *   - 官方说明：voice_cloning / voice_generation 的音色需先成功用于一次语音合成，
 *     才会出现在列表里（这里如实透传，不做本地补全）
 *
 * 本模块是纯函数：不做持久化、不读 Keychain，由主进程 handler 注入 endpoint 与密钥。
 */

import { createLogger } from '@spark/shared'
import { resolveMinimaxEndpoint, type MediaDynamicParamOption } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'

const log = createLogger('minimax:voice-catalog')

const REQUEST_TIMEOUT_MS = 20_000
const GET_VOICE_PATH = '/v1/get_voice'

export interface FetchMinimaxVoiceCatalogInput {
  /** 渠道 API Base URL，官方为 `https://api.minimaxi.com`（带 /v1 后缀也能归一）。 */
  apiEndpoint: string
  apiKey: string
  /**
   * 渠道按「完整 URL」配置时地址指向单个业务端点（如 /audio/speech），
   * 无法推导音色列表地址；此时抛出可读错误而不是猜测拼接。
   */
  apiEndpointFullUrl?: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface MinimaxVoiceCatalog {
  /** 已排序的候选：系统音色在前、账号私有音色（复刻 / 文生）在后。 */
  options: MediaDynamicParamOption[]
  /** 仅账号私有音色，供「删除音色」类 UI 复用（MiniMax 暂未接入复刻删除）。 */
  privateVoices: MediaDynamicParamOption[]
  officialCount: number
  privateCount: number
}

/**
 * 拉取 MiniMax 音色清单并转换为平台候选。
 *
 * `value` 用 `voice_id`（提交值，对应 manifest 的 `voice` 参数），
 * `label` 用 `voice_name`（系统音色才有可读名，如 Steady Executive）；
 * 私有音色官方不给名称，保持 `{ value }` 避免候选里出现重复的裸 ID 文案。
 */
export async function fetchMinimaxVoiceCatalog(
  input: FetchMinimaxVoiceCatalogInput,
): Promise<MinimaxVoiceCatalog> {
  if (input.apiEndpointFullUrl === true) {
    log.warn('refused 完整 URL channel for 音色目录同步')
    throw new MediaProviderError(
      'invalid_input',
      '该渠道配置为「完整 URL」模式，无法推导音色列表地址；请改用标准 API Base URL 后再同步',
    )
  }
  if (!input.apiEndpoint.trim()) {
    throw new MediaProviderError('provider_not_configured', '渠道未配置 API 地址，无法同步音色目录')
  }
  const base = resolveMinimaxEndpoint(input.apiEndpoint, GET_VOICE_PATH)
  const doFetch = input.fetchImpl ?? fetch
  const startedAt = Date.now()
  const response = await doFetch(base, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ voice_type: 'all' }),
    signal: AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS),
  })
  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    log.warn(`MiniMax get_voice failed, status=${response.status}, detail=${raw.slice(0, 200)}`)
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

  const baseResp = isRecord(payload) && isRecord(payload['base_resp']) ? payload['base_resp'] : null
  const statusCode =
    baseResp && typeof baseResp['status_code'] === 'number' ? baseResp['status_code'] : 0
  if (baseResp != null && statusCode !== 0) {
    const message = typeof baseResp['status_msg'] === 'string' ? baseResp['status_msg'] : ''
    log.warn(`MiniMax get_voice returned error, statusCode=${statusCode}, message=${message}`)
    throw new MediaProviderError(
      'provider_http_error',
      `同步音色失败：${[String(statusCode), message].filter(Boolean).join(' ')}`,
      response.status,
    )
  }

  const systemVoices = toOptions(isRecord(payload) ? payload['system_voice'] : undefined)
  const privateVoices = [
    ...toOptions(isRecord(payload) ? payload['voice_cloning'] : undefined),
    ...toOptions(isRecord(payload) ? payload['voice_generation'] : undefined),
  ]

  log.info('MiniMax voice catalog synced', {
    total: systemVoices.length + privateVoices.length,
    official: systemVoices.length,
    private: privateVoices.length,
    durationMs: Date.now() - startedAt,
  })
  return {
    options: [...systemVoices, ...privateVoices],
    privateVoices,
    officialCount: systemVoices.length,
    privateCount: privateVoices.length,
  }
}

function toOptions(raw: unknown): MediaDynamicParamOption[] {
  if (!Array.isArray(raw)) return []
  const options: MediaDynamicParamOption[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const voiceId = typeof item['voice_id'] === 'string' ? item['voice_id'].trim() : ''
    if (!voiceId || seen.has(voiceId)) continue
    seen.add(voiceId)
    const voiceName = typeof item['voice_name'] === 'string' ? item['voice_name'].trim() : ''
    options.push(
      voiceName && voiceName !== voiceId
        ? { value: voiceId, label: voiceName }
        : { value: voiceId },
    )
  }
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
