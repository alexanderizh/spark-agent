import type { ProviderModelSettingStored } from '@spark/protocol'
import type { SparkReasoningEffort } from '../sdk/reasoning-effort.js'

/** 渠道 config_json 中与模型级设置相关的字段子集（结构化入参，避免耦合完整 ProviderConfig）。 */
export interface ProviderModelSettingsSource {
  modelSettings?: Record<string, ProviderModelSettingStored>
}

const REASONING_EFFORTS: readonly SparkReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

function isSparkReasoningEffort(value: unknown): value is SparkReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value)
}

/**
 * 解析渠道内某个模型的「默认推理强度」（模型设置弹窗配置）。
 *
 * 语义：仅当该模型在 modelSettings 中显式配置了合法档位时返回该档位，否则返回 undefined
 * （调用方继续回落到更上层默认，例如 SDK 默认）。存放了非法值时同样返回 undefined，
 * 不猜测、不静默套用其它档位。
 *
 * 运行时消费点：session.service 在 router 显式档位与会话级 reasoning_effort 均缺省时兜底
 * （覆盖定时任务 / 工作流等不经过 Composer 的链路）。
 */
export function resolveModelDefaultReasoningEffort(
  source: ProviderModelSettingsSource | null | undefined,
  modelId: string | null | undefined,
): SparkReasoningEffort | undefined {
  const id = typeof modelId === 'string' ? modelId.trim() : ''
  if (id.length === 0) return undefined
  const value = source?.modelSettings?.[id]?.reasoningEffort
  return isSparkReasoningEffort(value) ? value : undefined
}

/**
 * 该模型是否在会话模型选择器中隐藏。
 *
 * 仅用于选择器渲染过滤：provider:list 数据保持完整，已选中该模型的会话继续可用
 * （与 modelSchedules 定时禁用的读取侧剔除语义不同，见设计文档 §2.3）。
 */
export function isModelHiddenInPicker(
  source: ProviderModelSettingsSource | null | undefined,
  modelId: string | null | undefined,
): boolean {
  const id = typeof modelId === 'string' ? modelId.trim() : ''
  if (id.length === 0) return false
  return source?.modelSettings?.[id]?.hidden === true
}
