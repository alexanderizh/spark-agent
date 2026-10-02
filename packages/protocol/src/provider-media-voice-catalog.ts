/**
 * 渠道「音色获取」配置。
 *
 * 音色是部分厂商的**动态资源**（系统音色会扩充、用户还有账号私有音色），静态 manifest
 * examples 覆盖不了，因此平台提供「同步音色目录」能力：拉取厂商音色清单写入
 * `mediaDynamicParamOptions`，画布 / 快速创作 / 语音助手通过共享 manifest 解析自动继承。
 *
 * 改造前这套能力是**厂商硬编码**的：`provider.service.ts` 里写死一张「支持同步的厂商」
 * 白名单，各自绑定一个专用 client，且「完整 URL」渠道被直接拒绝（无法推导子路径）。
 * 本模块把「怎么取音色」变成可配置：内置模板给默认值，用户可覆盖请求与字段映射。
 *
 * 三档语义（由后端 `ProviderService` 解析，见 media-voice-catalog 相关实现）：
 *   1. 未配置 / 未填任何覆盖项 → 走内置实现，与改造前**行为完全一致**（向后兼容）；
 *   2. 模板 + 覆盖项 → 按模板默认值合并覆盖项后发通用请求；
 *   3. `templateId: 'custom'` → 完全自定义请求（自定义媒体渠道走这一档）。
 *
 * 安全：请求头里的 `{{apiKey}}` 占位由主进程替换为 Keychain 中的真实密钥，
 * 密钥本身不落 profile、不回显到渲染端。
 */

import { z } from 'zod'

/**
 * 音色参数在各渠道 manifest 里的字段名（OpenAI / MiniMax / 火山 / 智谱各不相同）。
 *
 * 后端据此把同步结果写到正确的参数上（火山是 `speaker`，其余多为 `voice`）；
 * 渲染端 `renderer/design/utils/mediaParamOptions.ts` 复用同一份清单，
 * 保证「写入哪个参数」与「界面上哪个参数显示候选」一致。
 */
export const VOICE_CATALOG_PARAM_ALIASES: readonly string[] = [
  'voice',
  'voice_id',
  'voiceId',
  'speaker',
  'speaker_id',
]

export const VOICE_CATALOG_TEMPLATE_IDS = [
  'zhipu',
  'minimax',
  'volcengine-speech',
  'custom',
] as const

export type VoiceCatalogTemplateId = (typeof VOICE_CATALOG_TEMPLATE_IDS)[number]

/** 模板对应的内置实现（不可被覆盖项替换的部分）。 */
export type VoiceCatalogBuiltinKind = 'zhipu' | 'minimax' | 'volcengine-speech-static' | null

export interface VoiceCatalogTemplateDefaults {
  id: VoiceCatalogTemplateId
  label: string
  /** 配置弹层里的一句话说明。 */
  hint: string
  /** 有值表示该模板存在内置实现；未做任何覆盖时会直接走它（不发通用请求）。 */
  builtin: VoiceCatalogBuiltinKind
  /**
   * 默认请求地址。
   * - `path`：相对渠道 Base URL 的路径（标准渠道）；
   * - `absoluteUrl`：完整地址（目前只有火山内置静态表用不到网络，留作占位）。
   */
  path: string | null
  method: 'GET' | 'POST'
  body: string | null
  headers: Record<string, string> | null
  /** 音色数组在响应体中的点路径，如 `voice_list` / `Result.Speakers`。 */
  listPath: string
  valueField: string
  labelField: string | null
  /** 私有（账号复刻 / 文生）音色所在的数组路径，可多个。 */
  privateListPaths: string[]
  /** 或按标记字段判定私有，如智谱 `voice_type === PRIVATE`。 */
  privateFlagField: string | null
  privateFlagValues: string[]
  docsUrl: string | null
}

/** 模板默认值表：前端（配置弹层回填）与后端（解析请求）共用，避免两端漂移。 */
export const VOICE_CATALOG_TEMPLATES: Record<VoiceCatalogTemplateId, VoiceCatalogTemplateDefaults> =
  {
    zhipu: {
      id: 'zhipu',
      label: '智谱开放平台',
      hint: 'GET /voice/list，返回系统音色与复刻音色（voice_type=PRIVATE）。',
      builtin: 'zhipu',
      path: '/voice/list',
      method: 'GET',
      body: null,
      headers: { authorization: 'Bearer {{apiKey}}' },
      listPath: 'voice_list',
      valueField: 'voice',
      labelField: 'voice_name',
      privateListPaths: [],
      privateFlagField: 'voice_type',
      privateFlagValues: ['PRIVATE'],
      docsUrl: 'https://docs.bigmodel.cn/openapi/openapi.json',
    },
    minimax: {
      id: 'minimax',
      label: 'MiniMax',
      hint: 'POST /v1/get_voice，系统音色在 system_voice，账号私有音色在 voice_cloning / voice_generation。',
      builtin: 'minimax',
      path: '/v1/get_voice',
      method: 'POST',
      body: '{"voice_type":"all"}',
      headers: { authorization: 'Bearer {{apiKey}}' },
      listPath: 'system_voice',
      valueField: 'voice_id',
      labelField: 'voice_name',
      privateListPaths: ['voice_cloning', 'voice_generation'],
      privateFlagField: null,
      privateFlagValues: [],
      docsUrl: 'https://platform.minimax.io/docs/api-reference/voice-management-get',
    },
    'volcengine-speech': {
      id: 'volcengine-speech',
      label: '火山豆包语音（内置音色表）',
      hint:
        '应用内置官方「豆包语音合成模型 2.0」音色表，离线可用；' +
        '需按账号实时拉取时可改为自定义请求（官方 ListSpeakers 走火山 OpenAPI AK/SK 签名）。',
      builtin: 'volcengine-speech-static',
      path: null,
      method: 'POST',
      body: null,
      headers: null,
      listPath: 'Result.Speakers',
      valueField: 'VoiceType',
      labelField: 'Name',
      privateListPaths: [],
      privateFlagField: null,
      privateFlagValues: [],
      docsUrl: 'https://www.volcengine.com/docs/6561/2160690',
    },
    custom: {
      id: 'custom',
      label: '自定义请求',
      hint: '完全自定义接口地址与字段映射；填完整 URL 即可，不受渠道「完整 URL」模式限制。',
      builtin: null,
      path: null,
      method: 'GET',
      body: null,
      headers: null,
      listPath: '',
      valueField: '',
      labelField: null,
      privateListPaths: [],
      privateFlagField: null,
      privateFlagValues: [],
      docsUrl: null,
    },
  }

/** 按厂商推断默认模板；无对应模板时返回 null（自定义媒体渠道由用户显式选择）。 */
export function inferVoiceCatalogTemplate(
  mediaProvider: string | null | undefined,
): VoiceCatalogTemplateId | null {
  if (mediaProvider === 'zhipu') return 'zhipu'
  if (mediaProvider === 'minimax-hailuo') return 'minimax'
  if (mediaProvider === 'volcengine-speech') return 'volcengine-speech'
  return null
}

/**
 * 渠道「音色获取」配置。
 *
 * 全部字段可选：`templateId` 缺省时按渠道厂商推断；其余字段是**覆盖项**，
 * 留空即用模板默认值（因此未配置 profile 与配置了空对象完全等价，向后兼容）。
 */
export interface ProviderMediaVoiceCatalogConfig {
  templateId?: VoiceCatalogTemplateId | undefined
  /** 完整请求地址；填了就优先于模板默认路径（不受渠道 Base URL / 完整 URL 模式限制）。 */
  url?: string | undefined
  method?: 'GET' | 'POST' | undefined
  /** 请求头；value 支持 `{{apiKey}}` 占位。 */
  headers?: Record<string, string> | undefined
  /** POST 请求体（JSON 字符串）。 */
  body?: string | undefined
  listPath?: string | undefined
  valueField?: string | undefined
  labelField?: string | undefined
  privateListPaths?: string[] | undefined
  privateFlagField?: string | undefined
  privateFlagValues?: string[] | undefined
}

const templates = VOICE_CATALOG_TEMPLATE_IDS as readonly string[]

export const ProviderMediaVoiceCatalogConfigSchema = z.object({
  templateId: z.enum(VOICE_CATALOG_TEMPLATE_IDS).optional(),
  url: z.string().min(1).max(500).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z
    .record(z.string().min(1).max(120), z.string().min(1).max(1_000))
    .refine((value) => Object.keys(value).length <= 20, {
      message: '请求头最多 20 条',
    })
    .optional(),
  body: z.string().max(8_000).optional(),
  listPath: z.string().max(200).optional(),
  valueField: z.string().max(80).optional(),
  labelField: z.string().max(80).optional(),
  privateListPaths: z.array(z.string().max(200)).max(5).optional(),
  privateFlagField: z.string().max(80).optional(),
  privateFlagValues: z.array(z.string().max(80)).max(5).optional(),
})

/** 模板 id 是否合法（导出/导入等宽松入口用）。 */
export function isVoiceCatalogTemplateId(value: unknown): value is VoiceCatalogTemplateId {
  return typeof value === 'string' && templates.includes(value)
}
