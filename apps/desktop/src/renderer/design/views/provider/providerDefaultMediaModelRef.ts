import type {
  CanvasMediaModelSummary,
  MediaApiType,
  MediaProviderKind,
  ProviderMediaModelRef,
  ProviderModelType,
} from '@spark/protocol'
import { appendCustomMediaModelRef } from './providerCustomMediaModelRefs'

/** 自定义模型 manifestId 前缀（与 ProvidersView 的 CUSTOM_MODEL_REF_PREFIX 同源语义）。 */
const CUSTOM_MODEL_REF_PREFIX = 'custom:'

export interface EnsureMediaDefaultModelRefContext {
  mediaApiType: MediaApiType
  mediaProvider: MediaProviderKind | ''
  modelType: ProviderModelType
  /** 语音渠道勾选的 audio.* 能力，决定自定义语音模型的 manifest 契约。 */
  mediaCapabilities: readonly string[]
}

export interface EnsureMediaDefaultModelRefResult {
  refs: ProviderMediaModelRef[]
  /** 是否因为「手填默认模型不在清单里」而补了 ref（调用方据此保留用户填写的默认值）。 */
  added: boolean
}

function refModelId(ref: ProviderMediaModelRef): string {
  return ((ref.modelId ?? '').trim() || ref.manifestId.slice(CUSTOM_MODEL_REF_PREFIX.length)).trim()
}

/**
 * 把「手填但不在模型清单里」的默认模型补成一条 ref。
 *
 * 背景（缺陷）：媒体渠道保存时 `defaultModel` 会被强制对齐到第一个 enabled ref，
 * 用户手填的模型名因此被静默改写；如果这个模型又不在任何 ref 里，主进程解析
 * （`resolveProfileMediaModels`）就永远看不到它——表现为快速创作、画布面板、
 * 语音助手的模型候选里都没有这个模型。
 *
 * 处理顺序与 UI 的「添加模型」入口保持一致：
 *  1. 目录里能按模型 ID 命中，就按目录 ref 添加（沿用内置 manifest 与原生适配器）；
 *  2. 否则按「添加自定义模型」同一套规则添加（custom 渠道会带上 inline manifest）。
 *
 * 幂等：已存在同 modelId 的 ref 时原样返回（`added: false`），不会重复添加。
 */
export function ensureMediaDefaultModelRef(
  refs: readonly ProviderMediaModelRef[],
  modelId: string,
  context: EnsureMediaDefaultModelRefContext,
  catalogModels: readonly CanvasMediaModelSummary[],
): EnsureMediaDefaultModelRefResult {
  const trimmed = modelId.trim()
  if (!trimmed) return { refs: [...refs], added: false }
  if (refs.some((ref) => refModelId(ref) === trimmed)) return { refs: [...refs], added: false }

  const catalogModel = catalogModels.find(
    (model) =>
      !model.manifestId.startsWith(CUSTOM_MODEL_REF_PREFIX) &&
      model.effectiveModelId.trim() === trimmed,
  )
  if (catalogModel) {
    return {
      refs: [
        ...refs,
        {
          manifestId: catalogModel.manifestId,
          modelId: catalogModel.effectiveModelId.trim(),
          enabled: true,
        },
      ],
      added: true,
    }
  }

  const next = appendCustomMediaModelRef([...refs], {
    mediaApiType: context.mediaApiType,
    mediaProvider: context.mediaProvider,
    modelId: trimmed,
    modelType: context.modelType,
    ...(context.modelType === 'voice' ? { audioCapabilities: context.mediaCapabilities } : {}),
  })
  const appended = next.length > refs.length
  return { refs: next, added: appended }
}
