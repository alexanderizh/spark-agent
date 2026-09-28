import type { SessionReasoningEffort } from '@spark/protocol'

export interface ReasoningEffortOption {
  value: SessionReasoningEffort
  label: string
  description: string
}

/**
 * 会话推理强度档位（单一真相源）。
 *
 * claude / codex / spark 引擎共用同一套语义标签：档位与引擎是正交的，
 * 具体到执行器的映射（minimal→low、codex 封顶 xhigh 等）由 agent-runtime
 * 的 sdk/reasoning-effort 负责，前端只展示统一档位。
 *
 * 使用方：会话输入栏推理控件（ComposerV2）与「模型设置」弹窗的默认推理强度下拉。
 */
export const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { value: 'minimal', label: '极低', description: '最低推理强度，优先缩短响应时间' },
  { value: 'low', label: '低', description: '减少推理开销，适合明确而简单的任务' },
  { value: 'medium', label: '平衡', description: '速度与质量均衡，适合大多数日常任务' },
  { value: 'high', label: '高', description: '加强分析，适合有一定复杂度的任务' },
  { value: 'xhigh', label: '超高', description: '进行更深入的推理，响应时间会更长' },
  { value: 'max', label: 'Max', description: '使用最高推理强度处理最复杂的任务' },
]

export function resolveReasoningEffortLabel(
  value: SessionReasoningEffort | null | undefined,
): string {
  if (value == null) return ''
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? value
}
