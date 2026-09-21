import type { RouterIntensity } from '@spark/protocol'

/**
 * AutoRouter 强度展示口径（显示点 1/2/3/4/5 共用）。
 *
 * 强度文案与色点语义必须在模型选择器、管理页、轮次提示条、轮次 meta 行、
 * 子任务块头部保持完全一致，因此收敛到单一模块；颜色取项目全局 token
 * （高=danger / 平衡=success / 低=info），不新增色板。
 */
export const ROUTER_INTENSITY_LABEL: Record<RouterIntensity, string> = {
  high: '高',
  balanced: '平衡',
  low: '低',
}

export const ROUTER_INTENSITY_COLOR: Record<RouterIntensity, string> = {
  high: 'var(--danger)',
  balanced: 'var(--success)',
  low: 'var(--info)',
}

/** 强度色点颜色（内联 style 用；与 .badge.dot 强度色语义一致）。 */
export function routerIntensityColor(intensity: RouterIntensity): string {
  return ROUTER_INTENSITY_COLOR[intensity]
}

/** 强度中文标签。 */
export function routerIntensityLabel(intensity: RouterIntensity): string {
  return ROUTER_INTENSITY_LABEL[intensity]
}
