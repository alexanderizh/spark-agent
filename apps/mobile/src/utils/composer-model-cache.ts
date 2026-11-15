/**
 * 模型选择偏好的本地缓存（会话页 / 首页 / 项目会话页三处入口共用）。
 *
 * 记两件事（都按电脑维度隔离，一台电脑一个上下文）：
 *   pinned  用户置顶的常用模型：模型选择列表把置顶项排最前；
 *   last    上次选过的具体模型：下次新建会话默认选中它（不再回落「电脑默认」）。
 *
 * ref 与桌面端 PATCH 字段一致：{ providerProfileId, modelId }（modelId null =
 * 自动路由 / 渠道默认模型）。存储是外来的（旧版本 / 手改 / 半截写入都可能），
 * 读时逐条校验，脏数据只丢自身、绝不抛错——与 utils/filter-cache 同一口径。
 */

import { StorageKeys, getItem, setItem } from './storage'

export interface ComposerModelRef {
  providerProfileId: string
  /** null = 渠道自动路由 / 渠道默认模型 */
  modelId: string | null
}

export interface ComposerModelCache {
  pinned: ComposerModelRef[]
  last: ComposerModelRef | null
}

export const EMPTY_COMPOSER_MODEL_CACHE: ComposerModelCache = { pinned: [], last: null }

/** 缓存的设备数上限：超限按写入顺序淘汰最旧的（防止长期使用无限膨胀） */
const MAX_CACHED_DEVICES = 20

function refKey(ref: ComposerModelRef): string {
  return `${ref.providerProfileId}::${ref.modelId ?? ''}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRef(value: unknown): ComposerModelRef | null {
  if (!isRecord(value)) return null
  const providerProfileId = value.providerProfileId
  const modelId = value.modelId
  if (typeof providerProfileId !== 'string' || providerProfileId.length === 0) return null
  if (modelId !== null && typeof modelId !== 'string') return null
  return { providerProfileId, modelId }
}

function sanitizeCache(raw: unknown): ComposerModelCache | null {
  if (!isRecord(raw)) return null
  const pinned: ComposerModelRef[] = []
  if (Array.isArray(raw.pinned)) {
    const seen = new Set<string>()
    for (const entry of raw.pinned) {
      const ref = asRef(entry)
      if (ref == null || seen.has(refKey(ref))) continue
      seen.add(refKey(ref))
      pinned.push(ref)
    }
  }
  return { pinned, last: asRef(raw.last) }
}

function readTable(): Record<string, unknown> {
  const stored = getItem<unknown>(StorageKeys.composerModelPrefs)
  return isRecord(stored) ? stored : {}
}

export function readComposerModelCache(deviceId: string): ComposerModelCache {
  if (!deviceId) return EMPTY_COMPOSER_MODEL_CACHE
  const cache = sanitizeCache(readTable()[deviceId])
  return cache ?? EMPTY_COMPOSER_MODEL_CACHE
}

function writeTable(table: Record<string, unknown>): void {
  // 超限淘汰最旧的一台（跳过刚写入的 key 由调用方保证在表内）
  const keys = Object.keys(table)
  if (keys.length > MAX_CACHED_DEVICES) {
    for (const key of keys.slice(0, keys.length - MAX_CACHED_DEVICES)) delete table[key]
  }
  setItem(StorageKeys.composerModelPrefs, table)
}

/** 记住「上次选的模型」；传 null 表示用户选了「电脑默认」，清除记录（回落默认） */
export function rememberLastComposerModel(deviceId: string, ref: ComposerModelRef | null): void {
  if (!deviceId) return
  const table = readTable()
  const cache = sanitizeCache(table[deviceId]) ?? { ...EMPTY_COMPOSER_MODEL_CACHE }
  // 自动路由渠道（modelId null）同样要记住——它是一个明确的选择，「电脑默认」才是清除
  const nextLast = ref
  if (
    (cache.last == null && nextLast == null) ||
    (cache.last != null && nextLast != null && refKey(cache.last) === refKey(nextLast))
  ) {
    return
  }
  table[deviceId] = { pinned: cache.pinned, last: nextLast }
  writeTable(table)
}

/** 置顶 / 取消置顶一个具体模型（顺序即「常用」区的展示顺序） */
export function toggleComposerModelPin(deviceId: string, ref: ComposerModelRef): void {
  if (!deviceId) return
  const table = readTable()
  const cache = sanitizeCache(table[deviceId]) ?? { ...EMPTY_COMPOSER_MODEL_CACHE }
  const key = refKey(ref)
  const exists = cache.pinned.some((item) => refKey(item) === key)
  const pinned = exists
    ? cache.pinned.filter((item) => refKey(item) !== key)
    : [ref, ...cache.pinned]
  table[deviceId] = { pinned, last: cache.last }
  writeTable(table)
}

/**
 * 从选项 id 解析 ref。两种 id 形态都在用：`${providerId}::${modelId}`（会话页
 * 模型面板 / 首页渠道项）；「电脑默认」合成项没有 `::` 分隔符，返回 null。
 */
export function parseComposerModelRef(id: string): ComposerModelRef | null {
  const sep = id.indexOf('::')
  if (sep < 0) return null
  const providerProfileId = id.slice(0, sep)
  if (providerProfileId.length === 0) return null
  const rest = id.slice(sep + 2)
  return { providerProfileId, modelId: rest.length > 0 ? rest : null }
}

/**
 * 置顶项排最前（pin 顺序），其余保持原相对顺序。返回新数组不改入参。
 * refOf 返回 null 的项（合成项等）永远排非置顶区。
 */
export function sortComposerModelOptions<T>(
  options: readonly T[],
  cache: ComposerModelCache,
  refOf: (option: T) => ComposerModelRef | null,
): T[] {
  if (cache.pinned.length === 0) return [...options]
  const order = new Map<string, number>()
  cache.pinned.forEach((ref, index) => order.set(refKey(ref), index))
  const NOT_PINNED = Number.MAX_SAFE_INTEGER
  return options
    .map((option, index) => {
      const ref = refOf(option)
      const rank = ref != null ? (order.get(refKey(ref)) ?? NOT_PINNED) : NOT_PINNED
      return { option, index, rank }
    })
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.option)
}

/** 上次选的模型在 options 里的 id；没有记录或已失效（渠道被删等）返回 null */
export function resolveCachedModelId<T extends { id: string }>(
  options: readonly T[],
  cache: ComposerModelCache,
  refOf: (option: T) => ComposerModelRef | null,
): string | null {
  if (cache.last == null) return null
  const key = refKey(cache.last)
  const hit = options.find((option) => {
    const ref = refOf(option)
    return ref != null && refKey(ref) === key
  })
  return hit?.id ?? null
}
