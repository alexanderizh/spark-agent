/**
 * @module composer-drafts
 *
 * 输入框草稿的本地持久化（per-bucket key 方案）。
 *
 * 每个 bucket（= 一个会话或 'draft:new'）独占一个 localStorage key——
 * `spark-agent:composer-draft:<bucket>`。写入只序列化当前 bucket，删除是 O(1) removeItem。
 *
 * 与旧方案（全部草稿塞一个 key、每次 stringify 全量字典）的对比：
 *   - 单次写入成本：O(当前 bucket) vs O(全部 bucket)。200 个会话挂草稿时，
 *     旧方案每次 debounce 触发都 stringify ~40KB；新方案只 stringify 当前这一条。
 *   - 删除成本：O(1) removeItem vs O(N) 重写剩余全量。
 *   - 配额耗尽时：只丢当前 bucket，其余不受影响 vs 整个字典写不进去。
 *
 * 兼容旧数据：readComposerDrafts 同时读旧 key（COMPOSER_DRAFTS_LEGACY_KEY），
 * 合并后清掉旧 key，迁移是自然发生的、无需显式步骤。
 */

import type { ComposerDraftSnapshot } from './ChatComposerTypes'

/** 旧的全量 key，仅用于读侧迁移；新写入不再用它 */
export const COMPOSER_DRAFTS_LEGACY_KEY = 'spark-agent:composer-drafts'
/** 未绑定会话时（hero / 新会话）使用的草稿桶 */
export const NEW_SESSION_DRAFT_BUCKET = 'draft:new'

/** per-bucket key 前缀，bucket = sessionId 或 NEW_SESSION_DRAFT_BUCKET */
const DRAFT_KEY_PREFIX = 'spark-agent:composer-draft:'

/** 落盘节流间隔：足够小以至于用户感知不到丢失，又不会每次按键都写盘 */
const WRITE_DEBOUNCE_MS = 500

/**
 * 草稿条目数上限。超出说明 GC 没跟上（例如会话在别处被删），由 GC 截断。
 */
const MAX_DRAFT_ENTRIES = 200

export type ComposerDraftMap = Record<string, ComposerDraftSnapshot>

export function isEmptyDraft(draft: ComposerDraftSnapshot | undefined): boolean {
  if (draft == null) return true
  return draft.value.trim().length === 0 && draft.attachments.length === 0
}

function bucketStorageKey(bucket: string): string {
  return DRAFT_KEY_PREFIX + bucket
}

/** 校验单条草稿形状（localStorage 是用户可改的外部输入） */
function sanitizeDraft(value: unknown): ComposerDraftSnapshot | null {
  if (value == null || typeof value !== 'object') return null
  const candidate = value as Partial<ComposerDraftSnapshot>
  if (typeof candidate.value !== 'string') return null
  if (!Array.isArray(candidate.attachments)) return null
  return {
    value: candidate.value,
    attachments: candidate.attachments,
    manualExpanded: candidate.manualExpanded === true,
  }
}

/**
 * 读全部草稿。
 *
 * 优先读 per-bucket key；同时检测旧的全量 key（COMPOSER_DRAFTS_LEGACY_KEY），
 * 若存在则迁移为 per-bucket 后清掉旧 key——迁移自然发生，无需显式步骤。
 */
export function readComposerDrafts(): ComposerDraftMap {
  if (typeof window === 'undefined') return {}
  const result: ComposerDraftMap = {}

  // 1. 读 per-bucket key
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const storageKey = window.localStorage.key(i)
      if (storageKey == null || !storageKey.startsWith(DRAFT_KEY_PREFIX)) continue
      const bucket = storageKey.slice(DRAFT_KEY_PREFIX.length)
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (raw == null) continue
        const draft = sanitizeDraft(JSON.parse(raw))
        if (draft != null && !isEmptyDraft(draft)) result[bucket] = draft
      } catch {
        // 单条损坏只丢这一条
      }
    }
  } catch {
    // localStorage 不可用时返回已读到的部分
  }

  // 2. 迁移旧的全量 key（只迁一次：读完即删）
  migrateLegacyDrafts(result)

  return result
}

/** 把旧的全量字典迁移成 per-bucket key，然后删掉旧 key */
function migrateLegacyDrafts(into: ComposerDraftMap): void {
  let legacyRaw: string | null = null
  try {
    legacyRaw = window.localStorage.getItem(COMPOSER_DRAFTS_LEGACY_KEY)
  } catch {
    return
  }
  if (legacyRaw == null) return
  try {
    const parsed = JSON.parse(legacyRaw) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [bucket, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (into[bucket] != null) continue // per-bucket 已有的不覆盖
        const draft = sanitizeDraft(value)
        if (draft != null && !isEmptyDraft(draft)) {
          try {
            window.localStorage.setItem(bucketStorageKey(bucket), JSON.stringify(draft))
            into[bucket] = draft
          } catch {
            // per-bucket 写失败（配额）跳过，旧 key 不删，下次启动再试
            return
          }
        }
      }
    }
    // 全部迁移成功，删旧 key
    window.localStorage.removeItem(COMPOSER_DRAFTS_LEGACY_KEY)
  } catch {
    // 旧数据 JSON 损坏：直接删，避免每次启动都白读一遍
    try {
      window.localStorage.removeItem(COMPOSER_DRAFTS_LEGACY_KEY)
    } catch {
      // ignore
    }
  }
}

/** 只写一个 bucket（序列化成本 = 当前这一条草稿，不碰其他 bucket） */
export function writeComposerDraftBucket(bucket: string, draft: ComposerDraftSnapshot): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(bucketStorageKey(bucket), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/** 删一个 bucket（O(1) removeItem） */
export function removeComposerDraftBucket(bucket: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(bucketStorageKey(bucket))
  } catch {
    // ignore
  }
}

/**
 * GC：按存活会话回收孤儿/空草稿 bucket。
 *
 * `liveSessionIds` 传 null 表示「会话列表尚未加载完成」，此时不做任何删除——
 * 否则首屏那一瞬间会把用户全部草稿误删。超 MAX_DRAFT_ENTRIES 时按最短内容优先丢。
 *
 * 直接操作 localStorage（removeItem），不依赖内存 map。
 *
 * @returns 被删除的 bucket 列表（供调用方同步内存 state）
 */
export function gcComposerDraftBuckets(
  liveSessionIds: ReadonlySet<string> | null,
): { removed: string[]; kept: ComposerDraftMap } {
  const removed: string[] = []
  const kept: ComposerDraftMap = {}
  if (typeof window === 'undefined') return { removed, kept }

  const all: Array<{ bucket: string; draft: ComposerDraftSnapshot }> = []
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const storageKey = window.localStorage.key(i)
      if (storageKey == null || !storageKey.startsWith(DRAFT_KEY_PREFIX)) continue
      const bucket = storageKey.slice(DRAFT_KEY_PREFIX.length)
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (raw == null) continue
        const draft = sanitizeDraft(JSON.parse(raw))
        if (draft == null || isEmptyDraft(draft)) {
          removeComposerDraftBucket(bucket)
          removed.push(bucket)
          continue
        }
        all.push({ bucket, draft })
      } catch {
        // 损坏条目直接删
        removeComposerDraftBucket(bucket)
        removed.push(bucket)
      }
    }
  } catch {
    return { removed, kept }
  }

  for (const { bucket, draft } of all) {
    if (bucket !== NEW_SESSION_DRAFT_BUCKET) {
      if (liveSessionIds != null && !liveSessionIds.has(bucket)) {
        removeComposerDraftBucket(bucket)
        removed.push(bucket)
        continue
      }
    }
    kept[bucket] = draft
  }

  // 超限截断：丢内容最短的，保住信息量最大的
  const keptEntries = Object.entries(kept)
  if (keptEntries.length > MAX_DRAFT_ENTRIES) {
    const sorted = keptEntries
      .filter(([bucket]) => bucket !== NEW_SESSION_DRAFT_BUCKET)
      .sort((a, b) => (b[1].value.length ?? 0) - (a[1].value.length ?? 0))
    const survivors = new Set(sorted.slice(0, MAX_DRAFT_ENTRIES).map(([b]) => b))
    if (kept[NEW_SESSION_DRAFT_BUCKET] != null) survivors.add(NEW_SESSION_DRAFT_BUCKET)
    for (const [bucket] of keptEntries) {
      if (!survivors.has(bucket)) {
        removeComposerDraftBucket(bucket)
        removed.push(bucket)
        delete kept[bucket]
      }
    }
  }

  return { removed, kept }
}

/**
 * 创建一个 per-bucket 节流写盘器。
 *
 * 打字期间只在内存里累积 pending 变更（每个 bucket 单独跟踪），最多每
 * {@link WRITE_DEBOUNCE_MS} 落盘一次。`removeBucket` 立即执行（不 debounce），
 * 避免「已发送内容残留」窗口。`flush()` 用于切换会话/卸载/页面隐藏等时机。
 */
export function createComposerDraftWriter(options: {
  onPersistError?: () => void
  debounceMs?: number
}): {
  writeBucket: (bucket: string, draft: ComposerDraftSnapshot) => void
  removeBucket: (bucket: string) => void
  flush: () => void
  dispose: () => void
} {
  const debounceMs = options.debounceMs ?? WRITE_DEBOUNCE_MS
  // pending: bucket → draft（写入）或 null（删除）
  let pending = new Map<string, ComposerDraftSnapshot | null>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let errorReported = false

  const flush = (): void => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return
    const snapshot = pending
    pending = new Map()
    let anyFailed = false
    for (const [bucket, draft] of snapshot) {
      if (draft == null) {
        removeComposerDraftBucket(bucket)
      } else if (!writeComposerDraftBucket(bucket, draft)) {
        anyFailed = true
      }
    }
    if (anyFailed && !errorReported) {
      errorReported = true
      options.onPersistError?.()
    } else if (!anyFailed) {
      errorReported = false
    }
  }

  return {
    writeBucket: (bucket, draft) => {
      pending.set(bucket, draft)
      if (timer == null) timer = setTimeout(flush, debounceMs)
    },
    removeBucket: (bucket) => {
      // 删除立即执行——发送后残留是用户可感知的 bug，不能等 debounce
      pending.delete(bucket)
      removeComposerDraftBucket(bucket)
    },
    flush,
    dispose: flush,
  }
}
