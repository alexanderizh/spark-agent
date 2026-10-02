/**
 * ttsSpeechCache — 消息播报 TTS 磁盘缓存（主进程）
 *
 * 内容寻址：sha256(渠道 + 实际模型 + 合成参数 + 句子文本) → 文件名。命中即播本地
 * 文件、零渠道请求，避免同一条消息重复播报、刷新后重播同一段的重复计费。
 *
 * 设计要点：
 * - 内存索引 Map<key, entry> 启动扫描构建，磁盘是唯一事实源（无 JSON 索引文件，
 *   不存在索引损坏/双写不一致）
 * - 近似 LRU：命中 utimes touch mtime，淘汰删最旧；惰性触发（put 后 + 启动时），
 *   fire-and-forget 不阻塞播放
 * - 双上限（条数 + 体积）先到先淘汰；TTS 句子音频典型 50–300KB
 * - put 失败仅告警，播放路径回退原产物（缓存是纯优化，不是正确性依赖）
 */

import { copyFile, mkdir, readdir, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createLogger } from '@spark/shared'

const log = createLogger('voice-assistant')

/** 缓存键版本：键计算规则变化时升级，旧键自然失配重合成（旧文件经淘汰清理） */
const CACHE_KEY_VERSION = 'v1'
/** 缓存文件名形如 <64位hex>.<ext>，扫描时以此识别归属文件（其余文件忽略） */
const CACHE_FILE_PATTERN = /^([0-9a-f]{64})\.[0-9a-zA-Z]+$/
/** 无扩展名产物（罕见）的兜底扩展名 */
const FALLBACK_EXT = '.audio'

/** 默认双上限：条数 + 体积（先到先淘汰） */
export const TTS_CACHE_DEFAULT_MAX_ENTRIES = 300
export const TTS_CACHE_DEFAULT_MAX_BYTES = 128 * 1024 * 1024

export interface TtsCacheKeyParts {
  /** 解析后的渠道 profile id（与 invoke 同源：显式设置 or 自动选路首个支持 audio.speech） */
  providerId: string
  /** 解析后的实际模型 id（显式 ttsModelId 优先，否则渠道默认模型） */
  modelId: string
  /**
   * 实际下发给渠道的合成参数（speed/voice/vol/pitch/emotion）。
   * 构造顺序固定，JSON 序列化稳定；任何影响请求的参数变化都会改变键。
   */
  params: Record<string, unknown>
  /** 句子文本 */
  text: string
}

export interface TtsSpeechCacheOptions {
  /** 缓存目录（userData/voice-assistant/tts-cache，safe-file 白名单内） */
  cacheDir: string
  maxEntries?: number
  maxBytes?: number
}

export interface TtsSpeechCache {
  /** 启动扫描建索引 + 容量检查（幂等；未就绪期间 get 恒 miss，put 仍可正常落盘） */
  initialize(): Promise<void>
  /** 命中返回文件路径（touch mtime）；未命中 / 文件失效返回 null */
  get(key: string): Promise<string | null>
  /** 把合成产物移入缓存，返回缓存文件路径；失败返回 null（调用方回退原产物） */
  put(key: string, sourceFilePath: string): Promise<string | null>
}

interface TtsCacheEntry {
  filePath: string
  size: number
  mtimeMs: number
}

/** 缓存键：配置或文本任一变化都会得到不同键（绝不误命中旧音色/旧模型音频） */
export function computeTtsCacheKey(parts: TtsCacheKeyParts): string {
  const payload = JSON.stringify({
    v: CACHE_KEY_VERSION,
    providerId: parts.providerId,
    modelId: parts.modelId,
    params: parts.params,
    text: parts.text,
  })
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/** 日志用短键（前 8 位） */
function shortKey(key: string): string {
  return `${key.slice(0, 8)}…`
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function createTtsSpeechCache(options: TtsSpeechCacheOptions): TtsSpeechCache {
  const cacheDir = resolve(options.cacheDir)
  const maxEntries = options.maxEntries ?? TTS_CACHE_DEFAULT_MAX_ENTRIES
  const maxBytes = options.maxBytes ?? TTS_CACHE_DEFAULT_MAX_BYTES
  /** 内存索引：磁盘是唯一事实源，索引仅用于免 readdir 的快速查找 */
  const index = new Map<string, TtsCacheEntry>()
  let initialized = false
  /** prune 在途 Promise：连续 put（长消息几十句）并发触发时复用同一次淘汰，避免快照交叉早停 */
  let pruneInFlight: Promise<void> | null = null

  function cacheFilePath(key: string, ext: string): string {
    const normalized = ext.startsWith('.') ? ext : `.${ext}`
    return join(cacheDir, `${key}${normalized}`)
  }

  function sumSizes(): number {
    let total = 0
    for (const entry of index.values()) total += entry.size
    return total
  }

  async function initialize(): Promise<void> {
    if (initialized) return
    initialized = true
    try {
      await mkdir(cacheDir, { recursive: true })
      const files = await readdir(cacheDir)
      for (const name of files) {
        const matched = CACHE_FILE_PATTERN.exec(name)
        if (matched == null) continue
        const key = matched[1] as string
        try {
          const info = await stat(join(cacheDir, name))
          if (!info.isFile() || info.size === 0) continue
          index.set(key, { filePath: join(cacheDir, name), size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          // stat 失败：文件在扫描期间被删，跳过
        }
      }
    } catch (error) {
      log.warn(`[voice-assistant] tts cache init failed: ${String(error)}`)
      return
    }
    log.info(`[voice-assistant] tts cache loaded (${index.size} entries, ${formatMb(sumSizes())})`)
    void pruneOnce()
  }

  async function get(key: string): Promise<string | null> {
    const entry = index.get(key)
    if (entry == null) return null
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(entry.filePath)
    } catch {
      index.delete(key) // 文件被外部删除：索引项失效
      return null
    }
    if (!info.isFile() || info.size === 0) {
      index.delete(key) // 空文件/目录占位：当未命中，等待重合成覆盖
      return null
    }
    // 以磁盘实际体积校准索引：文件被外部替换时体积统计不失真，prune 估算才准
    entry.size = info.size
    // 近似 LRU：刷新 mtime 作为最近使用标记；touch 失败不影响本次命中
    try {
      const now = new Date()
      await utimes(entry.filePath, now, now)
      entry.mtimeMs = now.getTime()
    } catch {
      // 只读文件系统等场景：命中仍成立，淘汰时自然清理
    }
    return entry.filePath
  }

  async function put(key: string, sourceFilePath: string): Promise<string | null> {
    const ext = extname(sourceFilePath) || FALLBACK_EXT
    const destPath = cacheFilePath(key, ext)
    await mkdir(cacheDir, { recursive: true }).catch(() => undefined)
    try {
      // 同 userData 下同卷：原子覆盖；跨卷兜底 copy + 删源
      await rename(sourceFilePath, destPath)
    } catch {
      try {
        await copyFile(sourceFilePath, destPath)
        await unlink(sourceFilePath)
      } catch (error) {
        log.warn(`[voice-assistant] tts cache put failed (key=${shortKey(key)}): ${String(error)}`)
        return null
      }
    }
    try {
      const info = await stat(destPath)
      index.set(key, { filePath: destPath, size: info.size, mtimeMs: info.mtimeMs })
      log.info(
        `[voice-assistant] tts cached (key=${shortKey(key)}, ${(info.size / 1024).toFixed(1)} KB)`,
      )
      void pruneOnce()
      return destPath
    } catch (error) {
      // rename 成功但 stat 失败（几乎不可能）：清索引防脏，调用方回退原产物仍在盘上
      index.delete(key)
      log.warn(`[voice-assistant] tts cache stat failed (key=${shortKey(key)}): ${String(error)}`)
      return null
    }
  }

  /**
   * 并发去重：prune 在途时复用同一次淘汰（put 与扫盘回调可能并发触发）。
   * 落败的并发触发不用再跑：磁盘状态即目标状态，prune 天然幂等。
   */
  function pruneOnce(): Promise<void> {
    if (pruneInFlight == null) {
      pruneInFlight = prune().finally(() => {
        pruneInFlight = null
      })
    }
    return pruneInFlight
  }

  /** 惰性容量控制：双上限先到先淘汰（mtime 升序删最旧），并发触发安全 */
  async function prune(): Promise<void> {
    const totalBytes = sumSizes()
    if (index.size <= maxEntries && totalBytes <= maxBytes) return
    // 体积超限时按平均体积估算目标条数，与条数上限取严
    const avg = index.size > 0 ? totalBytes / index.size : 0
    const byBytesTarget = avg > 0 ? Math.floor(maxBytes / avg) : 0
    const targetCount = totalBytes > maxBytes ? Math.min(maxEntries, byBytesTarget) : maxEntries
    const sorted = [...index.entries()].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs)
    let removed = 0
    let freed = 0
    let currentBytes = totalBytes
    for (const [key, entry] of sorted) {
      // index.delete 已使 index.size 反映真实剩余，不能再扣 removed：否则条数超限
      // 时只淘汰约应删的一半，缓存规模长期收敛不到目标上限
      if (index.size <= targetCount && currentBytes <= maxBytes) break
      try {
        await rm(entry.filePath, { force: true })
      } catch {
        // 文件已消失也算删成功（磁盘状态即目标状态）
      }
      index.delete(key)
      removed += 1
      freed += entry.size
      currentBytes -= entry.size
    }
    if (removed === 0) return
    log.info(
      `[voice-assistant] tts cache pruned (removed=${removed}, freed=${formatMb(freed)}, remaining=${index.size})`,
    )
  }

  return { initialize, get, put }
}
