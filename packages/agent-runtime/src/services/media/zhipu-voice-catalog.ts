/**
 * 智谱音色目录同步。
 *
 * 智谱的音色是**动态资源**：除 7 个系统音色外，用户还能在开放平台复刻音色（数量不限）。
 * 静态 `examples` 覆盖不了，因此提供本同步能力——调 `GET /paas/v4/voice/list` 拉取
 * 音色清单，转换成平台通用的动态参数候选（`mediaDynamicParamOptions`），
 * 由调用方持久化到 Provider profile，四端再通过共享的 manifest 解析自动继承。
 *
 * 接口事实核对自官方 OpenAPI（docs.bigmodel.cn/openapi/openapi.json）：
 *   - `GET /paas/v4/voice/list`
 *   - Query：`voiceName`（模糊搜索，中文需 url encode）/ `voiceType`（PRIVATE | OFFICIAL）
 *   - Response：`{ voice_list: [{ voice, voice_name, voice_type, download_url, create_time }] }`
 *
 * 本模块是纯函数：不做持久化、不读 Keychain，由主进程 handler 注入 endpoint 与密钥。
 */

import { createLogger } from '@spark/shared'
import type { MediaDynamicParamOption } from '@spark/protocol'

const log = createLogger('zhipu:voice-catalog')

const REQUEST_TIMEOUT_MS = 20_000

/** 官方 voice/list 的单条音色（字段名保持厂商原始语义）。 */
export interface ZhipuVoiceEntry {
  /** 提交给 GLM-TTS 的 voice 值。 */
  voice: string
  /** 人类可读音色名；复刻音色为用户创建时指定的名称。 */
  voiceName?: string
  /** OFFICIAL 为官方音色，PRIVATE 为自定义（复刻）音色。 */
  voiceType?: string
  downloadUrl?: string
  createTime?: string
}

export interface FetchZhipuVoiceCatalogInput {
  /** 渠道 API Base URL，通常为 `https://open.bigmodel.cn/api/paas/v4`。 */
  apiEndpoint: string
  apiKey: string
  /**
   * 渠道按「完整 URL」配置时无法推导音色列表地址（该模式地址指向单个业务端点），
   * 此时抛出可读错误而不是猜测拼接。
   */
  apiEndpointFullUrl?: boolean
  /** 按类型过滤；缺省拉取全部。 */
  voiceType?: 'PRIVATE' | 'OFFICIAL'
  fetchImpl?: typeof fetch
}

export interface ZhipuVoiceCatalog {
  /** 已排序的候选：官方音色在前、复刻音色在后。 */
  options: MediaDynamicParamOption[]
  officialCount: number
  privateCount: number
}

/**
 * 拉取智谱音色清单并转换为平台候选。
 *
 * 排序为「官方在前、复刻在后」（组内保持服务端顺序），与 manifest 内置的
 * 7 个系统音色优先语义一致；`value` 用 `voice`（提交值），`label` 用
 * `voice_name`（可读名，如「彤彤」），两者相同时省略 label。
 */
export async function fetchZhipuVoiceCatalog(
  input: FetchZhipuVoiceCatalogInput,
): Promise<ZhipuVoiceCatalog> {
  if (input.apiEndpointFullUrl === true) {
    throw new Error(
      '该渠道配置为「完整 URL」模式，无法推导音色列表地址；请改用标准 API Base URL 后再同步',
    )
  }
  const base = input.apiEndpoint.trim().replace(/\/+$/, '')
  if (!base) throw new Error('渠道未配置 API 地址，无法同步音色')

  const url = new URL(`${base}/voice/list`)
  if (input.voiceType) url.searchParams.set('voiceType', input.voiceType)

  const doFetch = input.fetchImpl ?? fetch
  const startedAt = Date.now()
  const response = await doFetch(url.toString(), {
    method: 'GET',
    headers: { authorization: `Bearer ${input.apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    log.warn('Zhipu voice list request failed', {
      status: response.status,
      detail: detail.slice(0, 200),
    })
    throw new Error(
      `音色列表请求失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 200)}` : ''}`,
    )
  }

  const payload = (await response.json()) as { voice_list?: unknown }
  const raw = Array.isArray(payload.voice_list) ? payload.voice_list : []
  const entries = raw
    .map((item) => parseVoiceEntry(item))
    .filter((entry): entry is ZhipuVoiceEntry => entry != null)

  const official = entries.filter((entry) => entry.voiceType !== 'PRIVATE')
  const privateVoices = entries.filter((entry) => entry.voiceType === 'PRIVATE')
  const options = [...official, ...privateVoices].map((entry) => toOption(entry))

  log.info('Zhipu voice catalog synced', {
    total: options.length,
    official: official.length,
    private: privateVoices.length,
    durationMs: Date.now() - startedAt,
  })
  return { options, officialCount: official.length, privateCount: privateVoices.length }
}

function parseVoiceEntry(raw: unknown): ZhipuVoiceEntry | null {
  if (raw == null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const voice = typeof record.voice === 'string' ? record.voice.trim() : ''
  if (!voice) return null
  return {
    voice,
    ...(typeof record.voice_name === 'string' && record.voice_name.trim()
      ? { voiceName: record.voice_name.trim() }
      : {}),
    ...(typeof record.voice_type === 'string' ? { voiceType: record.voice_type.trim() } : {}),
    ...(typeof record.download_url === 'string' ? { downloadUrl: record.download_url } : {}),
    ...(typeof record.create_time === 'string' ? { createTime: record.create_time } : {}),
  }
}

function toOption(entry: ZhipuVoiceEntry): MediaDynamicParamOption {
  const label = entry.voiceName?.trim()
  return label && label !== entry.voice ? { value: entry.voice, label } : { value: entry.voice }
}
