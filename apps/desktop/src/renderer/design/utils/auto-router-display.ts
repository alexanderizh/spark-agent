import type { RouterIntensity } from '@spark/protocol'
import { BUILTIN_AVATARS } from '../builtinAvatars'

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

/**
 * AutoRouter 一次性强度 worker 的身份解析（显示点 4 配套）。
 *
 * worker id 形如 `autorouter:{routerId}:{turnId}:{index}`，每轮临时合成、
 * 不入 Agent 表：渲染端按 id 前缀识别，按尾段序号推导稳定身份——
 * 名称「子任务 N」+ 内置动物头像按序分配（同轮不同 worker 不重复、
 * 跨轮同序号稳定同款）。事件携带 workerName 时优先使用。
 */

const AUTO_ROUTER_WORKER_ID_PREFIX = 'autorouter:'

/** animal 分类头像池（按 BUILTIN_AVATARS 稳定排序），供 worker 顺序分配。 */
const WORKER_AVATAR_IDS: string[] = BUILTIN_AVATARS.filter(
  (avatar) => avatar.category === 'animal',
).map((avatar) => avatar.id)

/** 解析 worker id 尾段序号；非 autorouter worker 返回 null。 */
export function parseAutoRouterWorkerIndex(memberAgentId: string): number | null {
  if (!memberAgentId.startsWith(AUTO_ROUTER_WORKER_ID_PREFIX)) return null
  const tail = memberAgentId.split(':').pop() ?? ''
  const index = Number.parseInt(tail, 10)
  return Number.isInteger(index) && index >= 0 && tail === String(index) ? index : null
}

/** 是否 AutoRouter 一次性 worker id。 */
export function isAutoRouterWorkerId(memberAgentId: string): boolean {
  return parseAutoRouterWorkerIndex(memberAgentId) != null
}

/**
 * worker 显示名：事件 workerName 优先，回退按 id 序号推导「子任务 N」。
 * 非 autorouter worker 返回 null。
 */
export function resolveAutoRouterWorkerName(
  memberAgentId: string,
  workerName?: string | undefined,
): string | null {
  const index = parseAutoRouterWorkerIndex(memberAgentId)
  if (index == null) return null
  const trimmed = workerName?.trim()
  if (trimmed != null && trimmed.length > 0) return trimmed
  return `子任务${index + 1}`
}

/**
 * worker 内置头像：animal 池按序号顺序分配（同轮 worker 数 ≤ 池大小时不重复）。
 * 非 autorouter worker 返回 null。
 */
export function resolveAutoRouterWorkerAvatarId(memberAgentId: string): string | null {
  const index = parseAutoRouterWorkerIndex(memberAgentId)
  if (index == null) return null
  if (WORKER_AVATAR_IDS.length === 0) return null
  return WORKER_AVATAR_IDS[index % WORKER_AVATAR_IDS.length] ?? null
}
