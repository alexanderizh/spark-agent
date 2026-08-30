/**
 * @module media-input-transfer-cache
 *
 * 渠道级媒体上传缓存：同一份本地素材（画布资源节点）被多个下游任务反复使用时，
 * 避免对同一渠道（xAI Files / 火山 Ark Files / MiniMax Files / Spark 平台上传）
 * 重复上传同一文件。
 *
 * 缓存键 = provider + scope（endpoint + apiKey 指纹）+ 内容指纹：
 *   - 有本地路径时用 `path + mtimeMs + size`（零读盘成本；文件被替换会自然 miss）；
 *   - 仅内存 buffer / dataUrl 时退回 sha256(buffer)。
 *
 * 缓存值只存引用元数据（file_id 或公网 URL），不占大内存；默认 TTL 24h
 * （低于各渠道 file_id 的最短生命周期），过期即视为 miss 重新上传。
 * 进程内内存缓存（主进程单例），重启后自然预热。
 */

import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createLogger } from '@spark/shared'

const log = createLogger('media:transfer-cache')

/** 默认 TTL：24h，需低于各渠道 Files file_id 的最短生命周期。 */
export const DEFAULT_MEDIA_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000
/** 条目上限：仅存引用元数据，256 条足够覆盖画布常见复用规模，防止无界增长。 */
const MAX_ENTRIES = 256

export type MediaTransferValue = { kind: 'file_id'; fileId: string } | { kind: 'url'; url: string }

export interface MediaTransferCacheIdentity {
  /** 渠道标识：'xai' | 'volcengine-ark' | 'minimax-hailuo' | 'spark' 等。 */
  provider: string
  /** endpoint + apiKey 指纹（不同账号/网关的文件空间互不相通）。 */
  scope: string
}

export interface MediaTransferCacheContent {
  /** 本地文件绝对路径；提供时优先用 stat 指纹（零读盘）。 */
  filePath?: string
  /** 无路径时的内容 buffer（dataUrl 物化等场景），按 sha256 指纹。 */
  buffer?: Buffer
}

interface CacheEntry {
  value: MediaTransferValue
  expiresAt: number
}

const entries = new Map<string, CacheEntry>()

/**
 * 计算 scope：endpoint + apiKey 指纹。apiKey 只以哈希形式进入缓存键与日志，
 * 不落明文。同渠道不同账号的文件空间隔离靠它保证。
 */
export function mediaTransferScopeOf(input: { apiEndpoint?: string; apiKey?: string }): string {
  const endpoint = input.apiEndpoint?.trim() || 'default'
  const apiKeyFingerprint = input.apiKey
    ? createHash('sha256').update(input.apiKey).digest('hex').slice(0, 16)
    : 'anonymous'
  return `${endpoint}#${apiKeyFingerprint}`
}

async function contentFingerprint(content: MediaTransferCacheContent): Promise<string | null> {
  const filePath = content.filePath?.trim()
  if (filePath) {
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return null
      return `p:${filePath}:${info.mtimeMs}:${info.size}`
    } catch {
      return null
    }
  }
  if (content.buffer) {
    return `b:${createHash('sha256').update(content.buffer).digest('hex')}`
  }
  return null
}

function cacheKey(identity: MediaTransferCacheIdentity, fingerprint: string): string {
  return `${identity.provider}|${identity.scope}|${fingerprint}`
}

function pruneExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key)
  }
}

/** LRU 淘汰：Map 保持插入序，命中时重插提升 recency；超上限删最旧。 */
function evictIfNeeded(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
  }
}

/** 查询缓存；命中返回引用元数据，过期条目即时清除。 */
export async function lookupMediaTransferCache(
  identity: MediaTransferCacheIdentity,
  content: MediaTransferCacheContent,
): Promise<MediaTransferValue | null> {
  const fingerprint = await contentFingerprint(content)
  if (!fingerprint) return null
  const key = cacheKey(identity, fingerprint)
  const now = Date.now()
  const entry = entries.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    entries.delete(key)
    return null
  }
  // 命中：重插提升 LRU recency
  entries.delete(key)
  entries.set(key, entry)
  log.debug(
    `event=cache-hit provider=${identity.provider} valueKind=${entry.value.kind} remainingMs=${entry.expiresAt - now}`,
  )
  return entry.value
}

/** 写入缓存；ttlMs 缺省 24h。 */
export async function recordMediaTransferCache(
  identity: MediaTransferCacheIdentity,
  content: MediaTransferCacheContent,
  value: MediaTransferValue,
  ttlMs: number = DEFAULT_MEDIA_TRANSFER_TTL_MS,
): Promise<void> {
  const fingerprint = await contentFingerprint(content)
  if (!fingerprint) return
  const key = cacheKey(identity, fingerprint)
  const now = Date.now()
  pruneExpired(now)
  entries.set(key, { value, expiresAt: now + ttlMs })
  evictIfNeeded()
  log.debug(
    `event=cache-record provider=${identity.provider} valueKind=${value.kind} ttlMs=${ttlMs}`,
  )
}

/** 主动清除单条缓存（如渠道侧 file_id 已失效，换 URL 失败时避免后续继续命中）。 */
export async function evictMediaTransferCache(
  identity: MediaTransferCacheIdentity,
  content: MediaTransferCacheContent,
): Promise<void> {
  const fingerprint = await contentFingerprint(content)
  if (!fingerprint) return
  entries.delete(cacheKey(identity, fingerprint))
}

/** 仅测试用：清空全部条目。 */
export function clearMediaTransferCacheForTest(): void {
  entries.clear()
}
