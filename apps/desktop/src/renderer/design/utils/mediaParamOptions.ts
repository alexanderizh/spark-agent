/**
 * 多媒体模型 paramSchema → 参数候选项。
 *
 * 渠道表单（ProvidersView「参数默认值」）与语音助手（TTS 音色）共用同一口径，
 * 并与画布 `schemaFields` / `canvasParameterPresentation` 对齐，避免同一份 manifest
 * 在画布能选、在渠道表单只能手输：
 * - `enum` 是 provider 的有限约束，始终收集；
 * - `examples` 只是示例（渠道同步的音色目录也经 mergeDynamicParamOptions 落到这里），
 *   仅在 manifest 显式声明 `x-allow-custom: true` 时才并入候选，否则会把示例误当约束；
 * - `default` 始终并入，保证「渠道默认值」在候选里可见、可回选；
 * - 只有显式要求 `useLabels` 时才用 `x-template-labels` 的可读名（如音色名、模板名）
 *   作为文案；默认保持 label = value，不改动既有下拉的展示。
 */

import type { CanvasMediaModelSummary } from '@spark/protocol'

export interface MediaParamOption {
  value: string
  label: string
}

/** 音色参数在各渠道 manifest 里的字段名（OpenAI / MiniMax / 火山 / xAI / 智谱各不相同）。 */
export const VOICE_PARAM_FIELD_NAMES: readonly string[] = [
  'voice',
  'voice_id',
  'voiceId',
  'speaker',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pushScalar(target: string[], value: unknown): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    target.push(String(value))
  }
}

function scalarList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) pushScalar(out, item)
  return out
}

/** 读取 `x-template-labels`（值 → 可读名）；非对象或值非字符串时忽略该项。 */
function readTemplateLabels(spec: Record<string, unknown>): Record<string, string> {
  const raw = asRecord(spec['x-template-labels'])
  if (raw == null) return {}
  const labels: Record<string, string> = {}
  for (const [key, label] of Object.entries(raw)) {
    if (typeof label === 'string') labels[key] = label
  }
  return labels
}

/**
 * 单个 paramSchema 内若干字段的候选值，按 enum → examples → default 的声明顺序去重。
 * `fieldNames` 内同名字段只取首个命中的（渠道对同一语义有多种命名，命中即止）。
 */
export function paramOptionsFromSchema(
  paramSchema: Record<string, unknown> | undefined,
  fieldNames: readonly string[],
  options?: { useLabels?: boolean },
): MediaParamOption[] {
  const properties = asRecord(paramSchema?.properties)
  if (properties == null) return []
  const useLabels = options?.useLabels === true
  const options_: MediaParamOption[] = []
  const seen = new Set<string>()
  for (const name of fieldNames) {
    const spec = asRecord(properties[name])
    if (spec == null) continue
    const values = scalarList(spec.enum)
    const allowCustom = spec['x-allow-custom'] === true || spec.allowCustom === true
    if (allowCustom) values.push(...scalarList(spec.examples))
    pushScalar(values, spec.default)
    const labels = useLabels ? readTemplateLabels(spec) : {}
    for (const value of values) {
      if (seen.has(value)) continue
      seen.add(value)
      options_.push({ value, label: labels[value] ?? value })
    }
  }
  return options_
}

/**
 * 多个模型 / 能力上同一字段的候选值合并（渠道表单可能同时勾选多个模型）。
 * 先出现者胜出，候选顺序与模型清单顺序一致；`capabilityId` 用于限定能力（如 audio.speech）。
 */
export function mediaParamOptions(
  models: readonly CanvasMediaModelSummary[],
  fieldNames: readonly string[],
  options?: { capabilityId?: string; useLabels?: boolean },
): MediaParamOption[] {
  const capabilityId = options?.capabilityId
  const schemaOptions = options?.useLabels === true ? { useLabels: true } : undefined
  const merged = new Map<string, MediaParamOption>()
  for (const model of models) {
    for (const capability of model.capabilities) {
      if (capabilityId != null && capability.id !== capabilityId) continue
      for (const option of paramOptionsFromSchema(
        capability.paramSchema,
        fieldNames,
        schemaOptions,
      )) {
        if (!merged.has(option.value)) merged.set(option.value, option)
      }
    }
  }
  return [...merged.values()]
}

/**
 * 取模型的「渠道默认音色」提示文案（能力 defaults 或 paramSchema 声明的 voice 默认值）。
 * 仅用于占位提示，取不到时返回 null。
 */
export function mediaModelDefaultVoice(
  model: CanvasMediaModelSummary | undefined,
  capabilityId = 'audio.speech',
): string | null {
  if (model == null) return null
  const capability = model.capabilities.find((item) => item.id === capabilityId)
  if (capability == null) return null
  for (const source of [capability.defaults, model.defaults]) {
    const value = asRecord(source)?.['voice']
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  const properties = asRecord(capability.paramSchema?.properties)
  const declared = asRecord(properties?.['voice'])?.['default']
  return typeof declared === 'string' && declared.trim().length > 0 ? declared : null
}
