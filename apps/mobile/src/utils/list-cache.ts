/**
 * 轻量列表快照缓存：按 key 保存带时间戳的列表快照。
 *
 * 用途：列表页「首屏秒开 + 从子页面返回不重拉」的加速手段。缓存只存渲染所需的
 * 小数组/对象，服务端数据仍是事实来源；写入失败（如超出 wx.setStorageSync 单 key
 * 1MB 上限）一律静默容错，不阻塞业务。
 */

import { getItem, setItem } from './storage'

/** 缓存 key 命名空间，避免与 storage.ts 中其它键冲突 */
const KEY_PREFIX = 'spark-mobile:list-cache:'
/** 默认新鲜窗口：30s */
export const DEFAULT_LIST_CACHE_TTL = 30_000
/** 单条快照序列化后的体积上限（字符数），超过则放弃写入，避免缓存大对象 */
const MAX_SNAPSHOT_CHARS = 512 * 1024

export interface ListCacheSnapshot<T> {
  /** 写入时间戳（ms；约定只在「成功加载到数据」后写入，故代表最近一次成功加载时刻） */
  ts: number
  data: T
}

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key}`
}

/** 读取带时间戳的完整快照；不存在或结构损坏时返回 null */
export function readListCacheSnapshot<T>(key: string): ListCacheSnapshot<T> | null {
  try {
    const value = getItem<ListCacheSnapshot<T>>(storageKey(key))
    if (value == null || typeof value !== 'object') return null
    if (typeof value.ts !== 'number' || !('data' in value)) return null
    return value
  } catch {
    return null
  }
}

/** 只取快照数据（首屏渲染用），无有效缓存时返回 null */
export function readListCache<T>(key: string): T | null {
  return readListCacheSnapshot<T>(key)?.data ?? null
}

/** 写入快照并打上当前时间戳；体积过大或写入异常时静默跳过 */
export function writeListCache<T>(key: string, data: T): void {
  try {
    const snapshot: ListCacheSnapshot<T> = { ts: Date.now(), data }
    const serialized = JSON.stringify(snapshot)
    if (typeof serialized !== 'string' || serialized.length > MAX_SNAPSHOT_CHARS) return
    setItem(storageKey(key), snapshot)
  } catch {
    // 静默容错：缓存不可用不影响业务
  }
}

/** 距最近一次成功写入（= 最近一次成功加载）是否在 ttlMs 内 */
export function isFresh(key: string, ttlMs: number = DEFAULT_LIST_CACHE_TTL): boolean {
  const snapshot = readListCacheSnapshot<unknown>(key)
  if (snapshot == null) return false
  return Date.now() - snapshot.ts < ttlMs
}

/** 主动使缓存失效（下次 onLoad 视为无缓存） */
export function invalidateListCache(key: string): void {
  try {
    setItem(storageKey(key), null)
  } catch {
    // 静默容错
  }
}
