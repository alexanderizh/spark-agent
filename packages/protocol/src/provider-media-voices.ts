/**
 * 渠道音色目录的 IPC 契约：同步 / 复刻 / 删除。
 *
 * 音色是部分渠道的**动态资源**（智谱开放平台可枚举并复刻音色），静态 manifest
 * examples 覆盖不了。三个动作都围绕同一份候选展开：写入 Provider profile 的
 * `mediaDynamicParamOptions`，画布 / 快速创作等端随后通过共享的 manifest 解析
 * 自动继承。
 *
 * 契约保持厂商无关命名，后续其他渠道接入时复用同一组类型。
 */

import { z } from 'zod'

/**
 * 同步请求。
 *
 * 只接受 providerId：同步语义是「刷新该渠道的完整音色目录」，候选整体替换。
 * 刻意不暴露厂商的 voiceType 过滤 —— 按类型过滤会只写回一半候选、静默丢掉另一半，
 * 而同步结果又是整体替换，属于会误伤既有候选的 API 设计。
 */
export const ProviderMediaSyncVoicesRequestSchema = z.object({
  providerId: z.string().min(1).max(120),
})
export type ProviderMediaSyncVoicesRequest = z.infer<typeof ProviderMediaSyncVoicesRequestSchema>

export const ProviderMediaVoiceOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1).optional(),
})

/**
 * 同步后的候选快照。
 *
 * 复刻 / 删除都会顺带刷新一次目录，因此复用同一份形状直接回传给 UI，
 * 免去「动作成功后再拉一次列表」的第二跳。
 */
const voiceCatalogSnapshot = {
  /** 原始候选列表（已按官方在前、复刻在后排序）。 */
  options: z.array(ProviderMediaVoiceOptionSchema),
  /**
   * 仅复刻音色（厂商标注为私有），供「删除音色」UI 列出可删项。
   * 由厂商判定而非前端用差集推断，避免官方音色扩充后被误判成可删项。
   */
  privateVoices: z.array(ProviderMediaVoiceOptionSchema),
  officialCount: z.number().int().min(0),
  privateCount: z.number().int().min(0),
  /** 实际写入的 manifestId 与参数名，供 UI 反馈定位。 */
  manifestId: z.string(),
  paramName: z.string(),
}

export const ProviderMediaSyncVoicesResponseSchema = z.object({
  providerId: z.string(),
  ...voiceCatalogSnapshot,
})
export type ProviderMediaSyncVoicesResponse = z.infer<
  typeof ProviderMediaSyncVoicesResponseSchema
>

/**
 * 音色复刻请求。
 *
 * `samplePath` 是本地绝对路径（主进程负责读取上传）；示例音频格式与体积在本地先拦
 * 一道，时长（官方建议 3–30 秒）与音频质量仍由厂商判定。
 * `previewText` 对应官方必填的 `input`（试听文本），缺省由平台给默认句 ——
 * 它只影响试听段内容，不该拦住复刻动作本身。
 */
export const ProviderMediaCloneVoiceRequestSchema = z.object({
  providerId: z.string().min(1).max(120),
  samplePath: z.string().min(1).max(4000),
  voiceName: z.string().min(1).max(120),
  previewText: z.string().max(400).optional(),
  /** 示例音频对应的文本（官方选填，可提升复刻质量）。 */
  sampleText: z.string().max(2000).optional(),
})
export type ProviderMediaCloneVoiceRequest = z.infer<typeof ProviderMediaCloneVoiceRequestSchema>

export const ProviderMediaCloneVoiceResponseSchema = ProviderMediaSyncVoicesResponseSchema.extend({
  /** 新音色 id，可直接作为 TTS 的 voice 参数值。 */
  voice: z.string(),
  voiceName: z.string(),
})
export type ProviderMediaCloneVoiceResponse = z.infer<
  typeof ProviderMediaCloneVoiceResponseSchema
>

/** 删除复刻音色请求；官方只按 `voice` 删除。 */
export const ProviderMediaDeleteVoiceRequestSchema = z.object({
  providerId: z.string().min(1).max(120),
  voice: z.string().min(1).max(200),
})
export type ProviderMediaDeleteVoiceRequest = z.infer<typeof ProviderMediaDeleteVoiceRequestSchema>

export const ProviderMediaDeleteVoiceResponseSchema = ProviderMediaSyncVoicesResponseSchema.extend({
  voice: z.string(),
})
export type ProviderMediaDeleteVoiceResponse = z.infer<
  typeof ProviderMediaDeleteVoiceResponseSchema
>
