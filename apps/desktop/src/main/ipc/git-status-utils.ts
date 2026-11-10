import * as fs from 'node:fs/promises'
import path from 'node:path'

export type GitFileLineStats = {
  additions: number
  deletions: number
}

const EMPTY_STATS: GitFileLineStats = { additions: 0, deletions: 0 }
const READ_BUFFER_SIZE = 64 * 1024

/**
 * 未跟踪文件行数统计的防御上限。
 *
 * 背景：超大工作区（曾实测 14 万+ 未跟踪文件）下，每 2 秒的 git 状态轮询会
 * 以 16 并发全量读取所有未跟踪文件并在主进程逐字节扫描，导致事件循环阻塞
 * 至 critical、海量 FileHandle 高频开关，最终在主进程 HandleWrap close 回调
 * 路径触发 SIGTRAP 崩溃。此处通过缓存 + 截断 + 大小上限 + 原生扫描收敛开销。
 */
// 单次统计最多处理的未跟踪文件数；超出部分不统计（显示 0 行，语义等同 git numstat 对二进制显示 `-`）。
const MAX_UNTRACKED_STAT_FILES = 200
// 单文件超过该大小不再统计行数（大文件逐字节统计的收益趋零，代价线性膨胀）。
const MAX_UNTRACKED_STAT_FILE_BYTES = 2 * 1024 * 1024
// 并发读取数：从 16 收敛到 8，压低 FileHandle 生命周期频率与 I/O 峰值。
const DEFAULT_CONCURRENCY = 8
// 统计结果缓存：键为 absolutePath，值带 size+mtimeMs 指纹，指纹一致视为内容未变。
const UNTRACKED_STAT_CACHE_MAX = 5000

type UntrackedStatCacheEntry = {
  size: number
  mtimeMs: number
  stats: GitFileLineStats
}

const untrackedStatCache = new Map<string, UntrackedStatCacheEntry>()

function readUntrackedStatCache(
  absolutePath: string,
  size: number,
  mtimeMs: number,
): GitFileLineStats | null {
  const cached = untrackedStatCache.get(absolutePath)
  if (cached == null) return null
  if (cached.size !== size || cached.mtimeMs !== mtimeMs) {
    untrackedStatCache.delete(absolutePath)
    return null
  }
  return cached.stats
}

function writeUntrackedStatCache(
  absolutePath: string,
  size: number,
  mtimeMs: number,
  stats: GitFileLineStats,
): void {
  if (untrackedStatCache.size >= UNTRACKED_STAT_CACHE_MAX) untrackedStatCache.clear()
  untrackedStatCache.set(absolutePath, { size, mtimeMs, stats })
}

/**
 * Git does not include untracked files in `git diff --numstat HEAD`. Count text
 * lines directly so the review UI can still show useful addition statistics.
 * Binary files match Git's numstat behaviour and contribute zero text lines.
 */
export async function getUntrackedFileLineStats(
  rootPath: string,
  filePath: string,
): Promise<GitFileLineStats> {
  const absoluteRoot = path.resolve(rootPath)
  const absolutePath = path.resolve(absoluteRoot, filePath)
  const relativePath = path.relative(absoluteRoot, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return EMPTY_STATS

  try {
    const stat = await fs.lstat(absolutePath)
    // Git represents a newly added symlink as one line containing its target.
    if (stat.isSymbolicLink()) return { additions: 1, deletions: 0 }
    if (!stat.isFile() || stat.size === 0) return EMPTY_STATS
    if (stat.size > MAX_UNTRACKED_STAT_FILE_BYTES) return EMPTY_STATS

    const cached = readUntrackedStatCache(absolutePath, stat.size, stat.mtimeMs)
    if (cached != null) return cached

    const handle = await fs.open(absolutePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE)
      let additions = 0
      let bytesReadTotal = 0
      let lastByte = -1

      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        bytesReadTotal += bytesRead
        lastByte = buffer[bytesRead - 1] ?? -1
        // subarray 是零拷贝视图：防止复用 buffer 中上一次读取的残留字节参与扫描。
        // indexOf/includes 走原生实现，避免 JS 逐字节循环拖垮主进程事件循环。
        const view = buffer.subarray(0, bytesRead)
        if (view.includes(0)) return EMPTY_STATS
        let cursor = 0
        while (cursor < view.length) {
          const newlineIndex = view.indexOf(10, cursor)
          if (newlineIndex < 0) break
          additions += 1
          cursor = newlineIndex + 1
        }
      }

      if (bytesReadTotal > 0 && lastByte !== 10) additions += 1
      const stats = { additions, deletions: 0 }
      writeUntrackedStatCache(absolutePath, stat.size, stat.mtimeMs, stats)
      return stats
    } finally {
      await handle.close()
    }
  } catch {
    // A file may disappear between `git status` and this read. The next refresh
    // will reconcile the list, so keep this refresh usable instead of failing it.
    return EMPTY_STATS
  }
}

export async function getUntrackedFilesLineStats(
  rootPath: string,
  filePaths: string[],
  concurrency = DEFAULT_CONCURRENCY,
): Promise<Map<string, GitFileLineStats>> {
  const result = new Map<string, GitFileLineStats>()
  if (filePaths.length === 0) return result

  // 截断防御：超大工作区（数万未跟踪文件）下全量统计没有意义且会拖垮主进程。
  const boundedPaths = filePaths.slice(0, MAX_UNTRACKED_STAT_FILES)

  let cursor = 0
  const workerCount = Math.min(Math.max(1, concurrency), boundedPaths.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < boundedPaths.length) {
        const filePath = boundedPaths[cursor]
        cursor += 1
        if (filePath == null) continue
        result.set(filePath, await getUntrackedFileLineStats(rootPath, filePath))
      }
    }),
  )
  return result
}
