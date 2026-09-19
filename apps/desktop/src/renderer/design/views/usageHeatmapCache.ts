import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from './usageHeatmap.utils'

/**
 * 用量热力图数据的同步缓存（内存 + localStorage）。
 *
 * 背景：热力图数据来自异步 IPC（`usage:get-by-date-range`），首次渲染时一定还没有数据，
 * 空会话 hero 只能先按「无用量」渲染快捷卡片，等 IPC 返回后再切成热力图，于是每次进入
 * 空会话都会闪一次「快捷卡片 → 热力图」。
 *
 * 这里保存最近一次成功结果（内存供同一次运行内复用，localStorage 供重启后首帧复用），
 * 让 hook 首次渲染就能同步拿到数据：已知有用量就直接渲染热力图，后台再静默刷新覆盖，
 * 不再经过 pending 态。
 *
 * 约束：localStorage 不可用（隐私模式 / 配额写满）时静默降级为纯内存缓存；读取时校验
 * 数据形状，脏数据直接丢弃并回落 IPC 加载。
 */

const STORAGE_KEY_PREFIX = 'spark-agent:usage-heatmap'
const STORAGE_VERSION = 1
const ALL_RANGES: readonly UsageHeatmapRange[] = ['12w', '16w', '6m', '1y']

/** 已解析的缓存值；每个 range 只读一次 localStorage，之后走内存。 */
const memoryCache = new Map<UsageHeatmapRange, UsageHeatmapDailyGroup[]>()
/** 已确认过持久层状态的 range（命中缓存或确认没有持久化数据）。 */
const hydratedRanges = new Set<UsageHeatmapRange>()

function storageKey(range: UsageHeatmapRange): string {
  return `${STORAGE_KEY_PREFIX}:${range}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function isUsageHeatmapDailyGroup(value: unknown): value is UsageHeatmapDailyGroup {
  if (typeof value !== 'object' || value === null) return false
  const group = value as Partial<Record<keyof UsageHeatmapDailyGroup, unknown>>
  return (
    typeof group.date === 'string' &&
    typeof group.totalInputTokens === 'number' &&
    typeof group.totalOutputTokens === 'number' &&
    typeof group.totalReasoningOutputTokens === 'number' &&
    typeof group.totalCostUsd === 'number' &&
    typeof group.recordCount === 'number'
  )
}

function readStored(range: UsageHeatmapRange): UsageHeatmapDailyGroup[] | null {
  const storage = getStorage()
  if (storage == null) return null
  try {
    const raw = storage.getItem(storageKey(range))
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { version?: unknown; dailyGroups?: unknown }
    if (record.version !== STORAGE_VERSION || !Array.isArray(record.dailyGroups)) return null
    return record.dailyGroups.filter(isUsageHeatmapDailyGroup)
  } catch {
    // 解析失败按「没有缓存」处理。
    return null
  }
}

/** 同步读取缓存；没有缓存（含已确认无持久化数据）返回 undefined。 */
export function readCachedUsageHeatmap(
  range: UsageHeatmapRange,
): UsageHeatmapDailyGroup[] | undefined {
  const cached = memoryCache.get(range)
  if (cached != null) return cached
  if (hydratedRanges.has(range)) return undefined
  hydratedRanges.add(range)
  const stored = readStored(range)
  if (stored == null) return undefined
  memoryCache.set(range, stored)
  return stored
}

/**
 * 写入一次成功结果。空数组同样写入：表示「确实没有用量」，
 * 下次进入空会话可直接按快捷卡片渲染，不必再等一次 IPC。
 */
export function writeUsageHeatmapCache(
  range: UsageHeatmapRange,
  dailyGroups: UsageHeatmapDailyGroup[],
): void {
  memoryCache.set(range, dailyGroups)
  hydratedRanges.add(range)
  const storage = getStorage()
  if (storage == null) return
  try {
    storage.setItem(storageKey(range), JSON.stringify({ version: STORAGE_VERSION, dailyGroups }))
  } catch {
    // 忽略：localStorage 不可用或写满，内存缓存仍然有效。
  }
}

/** 清空内存与持久化缓存（测试隔离、用量记录被清理后调用）。 */
export function clearUsageHeatmapCache(): void {
  memoryCache.clear()
  hydratedRanges.clear()
  const storage = getStorage()
  if (storage == null) return
  try {
    for (const range of ALL_RANGES) storage.removeItem(storageKey(range))
  } catch {
    // 忽略：localStorage 不可用。
  }
}
