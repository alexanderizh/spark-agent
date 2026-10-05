/**
 * 语音助手 TTS / 云端识别（STT）候选推导（纯函数，便于单测）。
 *
 * 数据源是 `canvas:media-models:list`（TTS 用 capability=audio.speech，STT 用
 * capability=audio.transcription），与主进程 VoiceAssistantService 的合成/云转写
 * 链路使用同一份「已配置渠道 + 已启用模型」口径：
 * - 未显式指定渠道时，主进程取 providers 中第一个支持对应能力的渠道；列表顺序
 *   同为 ProviderService.listProviders()，因此这里用首个模型所属渠道对齐展示。
 * - 模型候选取渠道下按 modelId 去重的清单：同一渠道可复用同一 modelId 的多个 manifest，
 *   媒体路由器按 modelId 命中首个，这里同口径去重，避免下拉出现同值项。
 *
 * 下方的 stt* 系列是 tts* 同实现的语义别名：云端识别渠道/模型选择复用完全相同的
 * 「渠道去重 → 渠道下模型 → 默认模型」推导，仅候选清单的 capability 过滤不同。
 */

import type { CanvasMediaModelSummary } from '@spark/protocol'
import { mediaParamOptions, VOICE_PARAM_FIELD_NAMES } from '../utils/mediaParamOptions'
import type { MediaParamOption } from '../utils/mediaParamOptions'

export interface TtsChannelOption {
  value: string
  label: string
}

/** 渠道候选：按清单顺序去重 providerProfileId，展示渠道名。 */
export function ttsChannelOptions(models: readonly CanvasMediaModelSummary[]): TtsChannelOption[] {
  const seen = new Set<string>()
  const options: TtsChannelOption[] = []
  for (const model of models) {
    const id = model.providerProfileId
    if (id == null || seen.has(id)) continue
    seen.add(id)
    options.push({ value: id, label: model.providerName ?? id })
  }
  return options
}

/**
 * 生效渠道：显式选择优先；未选择时对齐主进程「第一个可用语音渠道」。
 * 列表中无任何语音模型时返回 null。
 */
export function resolveTtsChannelId(
  models: readonly CanvasMediaModelSummary[],
  selectedChannelId: string | null,
): string | null {
  if (selectedChannelId != null) return selectedChannelId
  return models[0]?.providerProfileId ?? null
}

/** 指定渠道下的语音模型（按 modelId 去重，保序）。 */
export function ttsChannelModels(
  models: readonly CanvasMediaModelSummary[],
  channelId: string | null,
): CanvasMediaModelSummary[] {
  if (channelId == null) return []
  const seen = new Set<string>()
  const picked: CanvasMediaModelSummary[] = []
  for (const model of models) {
    if (model.providerProfileId !== channelId) continue
    if (seen.has(model.modelId)) continue
    seen.add(model.modelId)
    picked.push(model)
  }
  return picked
}

/** 生效模型：显式选择优先，未选择时取渠道首个模型（下拉的「渠道默认模型」档）。 */
export function resolveTtsModel(
  models: readonly CanvasMediaModelSummary[],
  channelId: string | null,
  modelId: string | null,
): CanvasMediaModelSummary | undefined {
  const channelModels = ttsChannelModels(models, channelId)
  if (channelModels.length === 0) return undefined
  if (modelId == null) return channelModels[0]
  return channelModels.find((model) => model.modelId === modelId) ?? channelModels[0]
}

/**
 * 音色候选：限定在生效模型上；未指定模型时用整条渠道的 audio.speech 模型合并去重
 * （同一渠道的语音模型通常共用同一套音色）。
 */
export function ttsVoiceOptions(
  models: readonly CanvasMediaModelSummary[],
  channelId: string | null,
  modelId: string | null,
): MediaParamOption[] {
  const channelModels = ttsChannelModels(models, channelId)
  const scoped =
    modelId == null ? channelModels : channelModels.filter((model) => model.modelId === modelId)
  return mediaParamOptions(scoped.length > 0 ? scoped : channelModels, VOICE_PARAM_FIELD_NAMES, {
    capabilityId: 'audio.speech',
    useLabels: true,
  })
}

// ─── 云端识别（STT）候选：与 TTS 同实现的语义别名 ───────────────────────────

/** 云端识别渠道候选：与 ttsChannelOptions 同口径（capability=audio.transcription 清单）。 */
export const sttChannelOptions = ttsChannelOptions

/** 生效云端识别渠道：与 resolveTtsChannelId 同口径（显式选择优先，否则首个可用渠道）。 */
export const resolveSttChannelId = resolveTtsChannelId

/** 指定渠道下的云端识别模型：与 ttsChannelModels 同口径（按 modelId 去重，保序）。 */
export const sttChannelModels = ttsChannelModels
