/**
 * 渠道音色目录同步的 IPC 契约。
 *
 * 音色是部分渠道的**动态资源**（智谱开放平台可枚举并复刻音色），静态 manifest
 * examples 覆盖不了。同步动作把厂商音色清单转成动态参数候选并写入 Provider
 * profile 的 `mediaDynamicParamOptions`，画布 / 快速创作等端随后通过共享的
 * manifest 解析自动继承。
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

export const ProviderMediaSyncVoicesResponseSchema = z.object({
  providerId: z.string(),
  /** 原始候选列表（已按官方在前、复刻在后排序）。 */
  options: z.array(ProviderMediaVoiceOptionSchema),
  officialCount: z.number().int().min(0),
  privateCount: z.number().int().min(0),
  /** 实际写入的 manifestId 与参数名，供 UI 反馈定位。 */
  manifestId: z.string(),
  paramName: z.string(),
})
export type ProviderMediaSyncVoicesResponse = z.infer<
  typeof ProviderMediaSyncVoicesResponseSchema
>
