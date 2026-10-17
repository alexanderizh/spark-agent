/**
 * 图片本地缓存（桌面端图片的小程序侧持久缓存）。
 *
 * 背景：小程序访问不到桌面端本地路径，此前每次渲染图片都经中继拉 base64 重传，
 * 列表滚动/重进会话反复消耗流量与时间。本模块把「桌面端绝对路径 → 本地文件」
 * 统一收敛为 resolveImagePath：内存索引 + 磁盘文件双层缓存，LRU 限量，
 * 同 key 并发请求去重（只拉一次中继）。
 *
 * 容量纪律：双阈值 50MB / 500 条，超限按最近访问淘汰；启动时 reconcile()
 * 对账清理孤儿（索引有但文件丢 / 文件在但索引丢），兜底系统清理缓存目录的场景。
 *
 * 依赖方向：本模块不 import bridge（避免循环）；附件拉取器由 bridge.ts
 * 加载时经 configureImageFetcher 注入。未注入时 resolve 返回 null（调用方降级）。
 */

/** 附件内容拉取器签名（bridge.ts 注入；返回 null = 拉取失败） */
export type ImageFetcher = (
  path: string,
  deviceId?: string,
) => Promise<{ base64: string; mimeType?: string } | null>

let fetcher: ImageFetcher | null = null

/** 由 bridge.ts 在模块加载时注入（唯一注入点） */
export function configureImageFetcher(fn: ImageFetcher): void {
  fetcher = fn
}

// ─── 容量与存储常量 ─────────────────────────────────────────────────────────────

const CACHE_DIR = `${wx.env.USER_DATA_PATH}/img-cache`
const INDEX_STORAGE_KEY = 'img-cache-index-v1'
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 500

interface CacheEntry {
  /** 本地缓存文件绝对路径 */
  file: string
  size: number
  /** 最近访问时间戳（LRU 淘汰序） */
  lastAccess: number
}

/** 内存索引：桌面端路径 → 缓存条目（启动时从 storage 恢复） */
const index = new Map<string, CacheEntry>()
/** 并发去重：同一桌面路径的拉取共享同一个 Promise */
const inflight = new Map<string, Promise<string | null>>()
let persistScheduled = false
/** 索引是否已从 storage 恢复过（空索引同样只读一次 storage） */
let indexLoaded = false

// ─── key 与工具 ─────────────────────────────────────────────────────────────────

/** FNV-1a 64 位哈希（BigInt 实现）；桌面路径可能很长且含中文，不适合直接当文件名 */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff)
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

function extensionOf(desktopPath: string): string {
  const dot = desktopPath.lastIndexOf('.')
  const raw = dot >= 0 ? desktopPath.slice(dot).toLowerCase() : ''
  // 扩展名白名单（只缓存图片；非法/超长一律 png 兜底，防止路径拼接出怪文件名）
  return /^(\.png|\.jpe?g|\.webp|\.gif|\.bmp)$/.test(raw) && raw.length <= 5 ? raw : '.png'
}

function cacheKey(desktopPath: string): string {
  return fnv1a64(desktopPath) + extensionOf(desktopPath)
}

function fs(): WechatMiniprogram.FileSystemManager {
  return wx.getFileSystemManager()
}

// ─── 索引持久化 ─────────────────────────────────────────────────────────────────

function loadIndex(): void {
  if (indexLoaded) return
  indexLoaded = true
  try {
    const raw = wx.getStorageSync(INDEX_STORAGE_KEY) as Record<string, CacheEntry> | ''
    if (raw != null && raw !== '') {
      for (const key of Object.keys(raw)) {
        const entry = raw[key]
        if (entry != null && typeof entry.file === 'string' && typeof entry.size === 'number') {
          index.set(key, entry)
        }
      }
    }
  } catch {
    /* 索引损坏按空缓存起步，文件由 reconcile 清理 */
  }
}

/** 索引变更落盘（合并写：流式渲染可能短时间多次解析，避免频繁 setStorageSync） */
function schedulePersist(): void {
  if (persistScheduled) return
  persistScheduled = true
  setTimeout(() => {
    persistScheduled = false
    try {
      const plain: Record<string, CacheEntry> = {}
      for (const [key, entry] of index) plain[key] = entry
      wx.setStorageSync(INDEX_STORAGE_KEY, plain)
    } catch {
      /* 持久化失败不影响本次会话的内存缓存 */
    }
  }, 500)
}

// ─── LRU 淘汰 ───────────────────────────────────────────────────────────────────

/** 超限淘汰：按 lastAccess 从旧到新删，直到回到阈值内 */
function evictIfNeeded(): void {
  let totalSize = 0
  for (const entry of index.values()) totalSize += entry.size
  if (index.size <= MAX_ENTRIES && totalSize <= MAX_TOTAL_BYTES) return
  const byOldest = [...index.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  for (const [key, entry] of byOldest) {
    if (index.size <= MAX_ENTRIES && totalSize <= MAX_TOTAL_BYTES) break
    try {
      fs().unlinkSync(entry.file)
    } catch {
      /* 文件可能已不在；索引照删 */
    }
    index.delete(key)
    totalSize -= entry.size
  }
  schedulePersist()
}

// ─── 对外读取 ───────────────────────────────────────────────────────────────────

/** 已缓存时直接返回本地路径（同步、零 IO；调用方用于渲染占位） */
export function cachedImagePath(desktopPath: string): string | null {
  loadIndex()
  return index.get(cacheKey(desktopPath))?.file ?? null
}

/**
 * 桌面端图片路径 → 本地缓存文件路径。
 * 命中即回（异步校验文件仍在，微信中途清理缓存目录时自动回源重拉，不返回僵尸路径）；
 * 未命中经注入的 fetcher 拉取后落盘；同路径并发调用共享同一请求。
 * 失败返回 null（调用方降级占位）。
 */
export function resolveImagePath(desktopPath: string, deviceId?: string): Promise<string | null> {
  if (!desktopPath) return Promise.resolve(null)
  loadIndex()
  const key = cacheKey(desktopPath)
  const hit = index.get(key)
  if (hit != null) {
    hit.lastAccess = Date.now()
    schedulePersist()
    // 异步校验缓存文件真实存在（不阻塞渲染主线程）；丢失则删僵尸索引并回源重拉
    return new Promise<string | null>((resolve) => {
      fs().stat({
        path: hit.file,
        success: () => resolve(hit.file),
        fail: () => {
          index.delete(key)
          schedulePersist()
          resolve(fetchAndCache(key, desktopPath, deviceId))
        },
      })
    })
  }
  return fetchAndCache(key, desktopPath, deviceId)
}

/** 经注入的 fetcher 拉取并落盘；同 key 并发共享同一请求（并发去重唯一入口） */
function fetchAndCache(
  key: string,
  desktopPath: string,
  deviceId?: string,
): Promise<string | null> {
  const pending = inflight.get(key)
  if (pending != null) return pending

  const task = (async () => {
    const fn = fetcher
    if (fn == null) return null
    const payload = await fn(desktopPath, deviceId)
    if (payload == null || !payload.base64) return null
    try {
      fs().mkdirSync(CACHE_DIR, true)
      const file = `${CACHE_DIR}/${key}`
      fs().writeFileSync(file, payload.base64, 'base64')
      // statSync 类型含数组重载（readdir 场景），文件态取对象分支
      const stats = fs().statSync(file)
      const size = Array.isArray(stats) ? 0 : stats.size || 0
      if (size > MAX_TOTAL_BYTES) {
        // 单图超出总容量上限：入库必被 LRU 立刻淘汰，直接不缓存（调用方降级）
        fs().unlinkSync(file)
        return null
      }
      index.set(key, { file, size, lastAccess: Date.now() })
      evictIfNeeded()
      if (!index.has(key)) {
        // 防御：本条目被淘汰（超额图已在上方拦截，此分支理论不可达），
        // 此时文件已随淘汰删除，绝不能把已删路径返回给调用方
        try {
          fs().unlinkSync(file)
        } catch {
          /* 已不在 */
        }
        return null
      }
      schedulePersist()
      return file
    } catch {
      return null
    }
  })()
  inflight.set(key, task)
  return task.finally(() => {
    inflight.delete(key)
  })
}

// ─── 启动对账 ───────────────────────────────────────────────────────────────────

/**
 * 启动时对账（app onLaunch 调用一次）：
 *   1. 索引有但磁盘丢 → 删索引项（系统清理缓存目录后的自愈）
 *   2. 磁盘有但索引无（孤儿文件）→ 删文件
 */
export function reconcileImageCache(): void {
  loadIndex()
  const manager = fs()
  let files: string[]
  try {
    files = manager.readdirSync(CACHE_DIR) as unknown as string[]
  } catch {
    files = []
  }
  const knownFiles = new Set<string>()
  for (const [key, entry] of [...index.entries()]) {
    let exists: boolean
    try {
      manager.statSync(entry.file)
      exists = true
    } catch {
      exists = false
    }
    if (!exists) {
      index.delete(key)
    } else {
      knownFiles.add(entry.file.split('/').pop() ?? key)
    }
  }
  for (const name of files) {
    if (!knownFiles.has(name)) {
      try {
        manager.unlinkSync(`${CACHE_DIR}/${name}`)
      } catch {
        /* 目录项可能是子目录，unlink 失败忽略 */
      }
    }
  }
  schedulePersist()
}
