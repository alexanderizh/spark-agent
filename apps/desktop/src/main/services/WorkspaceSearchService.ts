/**
 * WorkspaceSearchService — 代码侧栏「工作区搜索」主进程服务。
 *
 * 性能设计（与本文件实现强相关，改动前先读）：
 *   1. 文件清单索引：全工作区 BFS 一次遍历（跳过固定忽略目录 + .gitignore 规则 +
 *      symlink 防环），结果按 rootPath 缓存（TTL 30s + LRU 8 + 同 root 并发防重入）。
 *      文件搜索（quick open）只做纯内存打分，无磁盘 IO。
 *   2. 内容搜索：文件清单复用缓存；逐文件 stat（>1MB 跳过）→ readFile →
 *      二进制检测（前 1KB 含 0x00 跳过）→ 行级正则匹配。
 *      并发上限 8（分 chunk 推进）、单文件匹配上限、总匹配上限（达限置 truncated）。
 *   3. 取消：requestId 令牌；新搜索 / 显式 cancel 使旧令牌失效，
 *      每个 chunk 边界与批 flush 前检查，及时停止。
 *   4. 流式：结果攒批（30 条或 120ms）经回调推送，避免长搜索白屏与大 payload。
 */

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  WorkspaceSearchContentMatch,
  WorkspaceSearchContentStats,
  WorkspaceSearchFileHit,
} from '@spark/protocol'
import {
  createGitignoreMatcher,
  isIgnoredByStack,
  type GitignoreMatcher,
  type GitignoreStackEntry,
} from './WorkspaceSearchGitignore.js'

/* ============================================================
   常量（性能护栏）
   ============================================================ */

/** 固定忽略的目录/文件名（与 workspace.service.ts 的文件树口径对齐 + 搜索特有） */
const ALWAYS_IGNORED_NAMES = new Set([
  '.git',
  '.next',
  '.hg',
  '.svn',
  '.cache',
  'coverage',
  'dist',
  'node_modules',
  'out',
  // 搜索特有：vendored 三方源码通常不需要被搜到
  '.pnpm-store',
  '.turbo',
  '.vite',
  'vendor',
])

/** 隔离 worktree 容器目录（对齐 workspace.service.ts 的 WORKTREE_CONTAINER_PATHS） */
const WORKTREE_CONTAINER_NAMES = new Set(['.worktrees', 'spark-worktrees'])

/** 索引上限（防 pathological 仓库把主进程拖死） */
const MAX_INDEX_FILES = 200_000
const MAX_INDEX_DIRS = 30_000

/** 索引缓存 TTL 与容量 */
const INDEX_TTL_MS = 30_000
const INDEX_CACHE_MAX = 8

/** 内容搜索护栏 */
const CONTENT_MAX_FILE_BYTES = 1024 * 1024 // 1MB
const CONTENT_BINARY_SNIFF_BYTES = 1024
const CONTENT_CONCURRENCY = 8
const CONTENT_CHUNK_SIZE = 64
const CONTENT_FLUSH_EVERY = 30
const CONTENT_FLUSH_INTERVAL_MS = 120
const CONTENT_DEFAULT_MAX_RESULTS = 2000
const CONTENT_PER_FILE_MATCH_LIMIT = 50
const CONTENT_LINE_TEXT_MAX_CHARS = 300

/* ============================================================
   文件清单索引
   ============================================================ */

interface WorkspaceFileIndex {
  files: string[]
  builtAt: number
}

interface IndexCacheEntry extends WorkspaceFileIndex {
  /** 同 root 并发 build 防重入：进行中的构建 promise */
  building: Promise<string[]> | null
}

export interface FileIndexOptions {
  /** true = 强制重建（绕过 TTL） */
  refresh?: boolean
}

/* ============================================================
   取消令牌
   ============================================================ */

interface ContentRunToken {
  requestId: string
  cancelled: boolean
}

export interface ContentSearchRunOptions {
  /** IPC 调用由渲染端预生成；直接调用服务时自动生成。 */
  requestId?: string
  query: string
  caseSensitive?: boolean
  maxResults?: number
  /** 批量结果回调（由 IPC 层桥接到流式推送） */
  onBatch: (batch: WorkspaceSearchContentMatch[]) => void
}

export interface ContentSearchRunResult {
  requestId: string
  truncated: boolean
  cancelled: boolean
  stats: WorkspaceSearchContentStats
}

/* ============================================================
   Service
   ============================================================ */

export class WorkspaceSearchService {
  private readonly indexCache = new Map<string, IndexCacheEntry>()
  private readonly activeRuns = new Map<string, ContentRunToken>()

  /* ---------- 文件清单 ---------- */

  /** 获取（或构建）某 root 的文件清单；命中缓存无磁盘 IO。 */
  async getFileIndex(rootPath: string, options: FileIndexOptions = {}): Promise<string[]> {
    const root = path.resolve(rootPath)
    const cached = this.indexCache.get(root)
    const fresh = cached != null && Date.now() - cached.builtAt < INDEX_TTL_MS
    if (cached != null && fresh && !options.refresh && cached.building == null) {
      return cached.files
    }
    if (cached?.building != null && !options.refresh) return cached.building

    const building = this.buildFileIndex(root)
    const entry: IndexCacheEntry = { files: [], builtAt: Date.now(), building }
    this.indexCache.set(root, entry)
    try {
      entry.files = await building
    } finally {
      entry.building = null
      entry.builtAt = Date.now()
      this.evictIndexCache(root)
    }
    return entry.files
  }

  private evictIndexCache(justUsed: string): void {
    if (this.indexCache.size <= INDEX_CACHE_MAX) return
    // LRU：淘汰最久未构建的（当前 root 除外）
    const entries = [...this.indexCache.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)
    for (const [key] of entries) {
      if (this.indexCache.size <= INDEX_CACHE_MAX) break
      if (key === justUsed) continue
      this.indexCache.delete(key)
    }
  }

  /**
   * BFS 全工作区遍历。
   * 每目录一次 readdir；从同批结果中检测 .gitignore（避免额外 stat）；
   * 目录被忽略即整棵子树剪枝；symlink 一律跳过（防环 + 安全）。
   */
  private async buildFileIndex(root: string): Promise<string[]> {
    const files: string[] = []
    let dirsSeen = 0
    let aborted = false

    interface QueueItem {
      absDir: string
      /** 相对根的 posix 前缀（root 自身为 ''；子项 relPath = prefix + name） */
      relPrefix: string
      /** 该目录的段深度（root = 0），用于 gitignore 栈路径切片 */
      depth: number
      /** 从根到本目录（含）生效的 gitignore 栈 */
      stack: readonly GitignoreStackEntry[]
    }
    const queue: QueueItem[] = [{ absDir: root, relPrefix: '', depth: 0, stack: [] }]
    let queueIndex = 0

    // cursor 遍历避免 Array.shift() 在大仓库目录队列上产生 O(n²) 搬移。
    while (queueIndex < queue.length && !aborted) {
      const item = queue[queueIndex]
      queueIndex += 1
      if (item == null) break
      let children: import('node:fs').Dirent[]
      try {
        children = await fs.readdir(item.absDir, { withFileTypes: true })
      } catch {
        continue // EACCES / 已删除等：跳过该目录
      }

      // 本目录若含 .gitignore，读取后对子项生效
      let stack = item.stack
      const gitignoreEntry = children.find((c) => c.name === '.gitignore' && c.isFile())
      if (gitignoreEntry != null) {
        try {
          const content = await fs.readFile(path.join(item.absDir, '.gitignore'), 'utf8')
          const matcher: GitignoreMatcher = createGitignoreMatcher(content)
          stack = [...stack, { matcher, depth: item.depth }]
        } catch {
          /* 读取失败按无规则处理 */
        }
      }

      for (const child of children) {
        if (aborted) break
        if (ALWAYS_IGNORED_NAMES.has(child.name) || WORKTREE_CONTAINER_NAMES.has(child.name))
          continue
        // 隐藏文件：保留（.env / .github 等是常见搜索目标），由 gitignore 规则决定去留

        const isDirectory = child.isDirectory()
        if (child.isSymbolicLink()) continue
        const relPath = item.relPrefix === '' ? child.name : `${item.relPrefix}/${child.name}`
        if (isIgnoredByStack(stack, relPath, isDirectory)) continue

        if (isDirectory) {
          if (dirsSeen >= MAX_INDEX_DIRS || files.length >= MAX_INDEX_FILES) {
            aborted = true
            break
          }
          dirsSeen += 1
          queue.push({
            absDir: path.join(item.absDir, child.name),
            relPrefix: relPath,
            depth: item.depth + 1,
            stack,
          })
        } else {
          if (files.length >= MAX_INDEX_FILES) {
            aborted = true
            break
          }
          files.push(relPath)
        }
      }
    }
    return files
  }

  /* ---------- 文件名搜索（纯内存） ---------- */

  async searchFiles(
    rootPath: string,
    query: string,
    limit = 100,
    options: FileIndexOptions = {},
  ): Promise<{
    hits: WorkspaceSearchFileHit[]
    totalFiles: number
    fromCache: boolean
    truncated: boolean
  }> {
    const root = path.resolve(rootPath)
    const wasCached = (() => {
      const cached = this.indexCache.get(root)
      return (
        !options.refresh &&
        cached != null &&
        Date.now() - cached.builtAt < INDEX_TTL_MS &&
        cached.building == null
      )
    })()
    const files = await this.getFileIndex(rootPath, options)
    const q = query.trim().toLowerCase()
    if (q === '') {
      return { hits: [], totalFiles: files.length, fromCache: wasCached, truncated: false }
    }

    const scored: WorkspaceSearchFileHit[] = []
    for (const file of files) {
      const score = scoreFileMatch(file, q)
      if (score > 0) scored.push({ path: file, score })
    }
    // 命中集合通常远小于全量；排序开销可控
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    const truncated = scored.length > limit
    return {
      hits: truncated ? scored.slice(0, limit) : scored,
      totalFiles: files.length,
      fromCache: wasCached,
      truncated,
    }
  }

  /* ---------- 内容搜索（并发 + 流式 + 可取消） ---------- */

  /** 取消进行中的内容搜索；不指定 requestId 则全部取消。 */
  cancelContentSearch(requestId?: string): boolean {
    let cancelled = false
    for (const [id, token] of this.activeRuns) {
      if (requestId != null && id !== requestId) continue
      token.cancelled = true
      this.activeRuns.delete(id)
      cancelled = true
    }
    return cancelled
  }

  /**
   * 启动一次内容搜索。同步返回 requestId（渲染端立即用它过滤流事件），
   * 完成状态与统计由 done promise 给出；结果经 onBatch 流式回调。
   *
   * 不在服务层全局互斥：不同窗口的搜索可并行存在；每个渲染端会用
   * 自己预生成的 requestId 精确取消上一轮，避免窗口之间相互打断。
   */
  runContentSearch(
    rootPath: string,
    options: ContentSearchRunOptions,
  ): { requestId: string; done: Promise<ContentSearchRunResult> } {
    const root = path.resolve(rootPath)
    const startedAt = Date.now()
    const requestId = options.requestId ?? randomUUID()
    const token: ContentRunToken = { requestId, cancelled: false }
    this.cancelContentSearch(requestId)
    this.activeRuns.set(requestId, token)

    const done = (async (): Promise<ContentSearchRunResult> => {
      const stats: WorkspaceSearchContentStats = {
        filesScanned: 0,
        filesSearched: 0,
        matches: 0,
        elapsedMs: 0,
      }
      let truncated = false
      let error: string | null = null
      const matches: WorkspaceSearchContentMatch[] = []
      let lastFlushAt = Date.now()

      const flush = (): void => {
        if (matches.length === 0) return
        const dueByCount = matches.length >= CONTENT_FLUSH_EVERY
        const dueByTime = Date.now() - lastFlushAt >= CONTENT_FLUSH_INTERVAL_MS
        if (!dueByCount && !dueByTime) return
        const batch = matches.splice(0, matches.length)
        lastFlushAt = Date.now()
        try {
          options.onBatch(batch)
        } catch {
          /* 推送异常不中断搜索 */
        }
      }

      try {
        if (options.query.length === 0) throw new Error('搜索关键词不能为空')
        const files = await this.getFileIndex(root)
        const maxResults = options.maxResults ?? CONTENT_DEFAULT_MAX_RESULTS
        const pattern = escapeRegExp(options.query)
        const regex = new RegExp(pattern, options.caseSensitive === true ? 'g' : 'gi')

        const searchOne = async (relPath: string): Promise<void> => {
          if (token.cancelled || truncated) return
          const absPath = path.join(root, relPath)
          stats.filesScanned += 1
          let size: number
          try {
            size = (await fs.stat(absPath)).size
          } catch {
            return
          }
          if (size > CONTENT_MAX_FILE_BYTES || size === 0) return

          let buffer: Buffer
          try {
            buffer = await fs.readFile(absPath)
          } catch {
            return
          }
          if (looksBinary(buffer)) return
          stats.filesSearched += 1

          const text = buffer.toString('utf8')
          const lines = text.split('\n')
          let fileMatches = 0
          for (let i = 0; i < lines.length; i += 1) {
            if (fileMatches >= CONTENT_PER_FILE_MATCH_LIMIT) break
            const line = lines[i]
            if (line == null || line.length === 0) continue
            regex.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = regex.exec(line)) != null) {
              // push 前检查总量上限：并发文件的同步块互不交错，
              // 先达标的 push 置 truncated 后，其余并发的下一次检查即退出，保证上限精确
              if (stats.matches >= maxResults) {
                truncated = true
                return
              }
              const preview = createLinePreview(line, m.index)
              matches.push({
                path: relPath,
                line: i + 1,
                text: preview.text,
                column: preview.column,
                length: m[0].length,
              })
              fileMatches += 1
              stats.matches += 1
              if (fileMatches >= CONTENT_PER_FILE_MATCH_LIMIT) break
            }
          }
        }

        for (let start = 0; start < files.length; start += CONTENT_CHUNK_SIZE) {
          if (token.cancelled || truncated) break
          const chunk = files.slice(start, start + CONTENT_CHUNK_SIZE)
          // 并发受限推进：一次只放 CONTENT_CONCURRENCY 个文件在飞
          for (let i = 0; i < chunk.length; i += CONTENT_CONCURRENCY) {
            if (token.cancelled || truncated) break
            const inFlight = chunk.slice(i, i + CONTENT_CONCURRENCY)
            await Promise.all(inFlight.map(searchOne))
            flush()
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      } finally {
        // 终态前把剩余匹配全部推出（cancelled 时也推，避免渲染端丢已见批次）
        if (matches.length > 0) {
          const batch = matches.splice(0, matches.length)
          try {
            options.onBatch(batch)
          } catch {
            /* 忽略终态推送异常 */
          }
        }
        if (this.activeRuns.get(requestId) === token) this.activeRuns.delete(requestId)
        stats.elapsedMs = Date.now() - startedAt
      }

      if (error != null) throw new Error(error)
      return { requestId, truncated, cancelled: token.cancelled, stats }
    })()

    return { requestId, done }
  }
}

/* ============================================================
   纯函数工具（导出可测）
   ============================================================ */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 前 1KB 含 NUL 视为二进制。 */
export function looksBinary(buffer: Buffer): boolean {
  const sniffLen = Math.min(buffer.length, CONTENT_BINARY_SNIFF_BYTES)
  for (let i = 0; i < sniffLen; i += 1) {
    if (buffer[i] === 0) return true
  }
  return false
}

/** 截取包含命中位置的单行预览，并把列号换算为预览内坐标。 */
export function createLinePreview(
  line: string,
  matchColumn: number,
): { text: string; column: number } {
  if (line.length <= CONTENT_LINE_TEXT_MAX_CHARS) {
    return { text: line, column: matchColumn }
  }
  const safeColumn = Math.min(Math.max(0, matchColumn), line.length)
  const preferredContextBefore = 100
  const maxStart = Math.max(0, line.length - CONTENT_LINE_TEXT_MAX_CHARS)
  const start = Math.min(maxStart, Math.max(0, safeColumn - preferredContextBefore))
  return {
    text: line.slice(start, start + CONTENT_LINE_TEXT_MAX_CHARS),
    column: safeColumn - start,
  }
}

/**
 * 文件名模糊打分（越大越靠前）。
 *   basename 全等 1000 / 前缀 800 / 子串 600 / 路径子串 400 / 子序列 200，
 *   并叠加：深度惩罚、basename 匹配位置惩罚。
 */
export function scoreFileMatch(filePath: string, lowerQuery: string): number {
  const lowerPath = filePath.toLowerCase()
  const slashIdx = lowerPath.lastIndexOf('/')
  const lowerBase = slashIdx >= 0 ? lowerPath.slice(slashIdx + 1) : lowerPath
  const base = slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath

  let score: number
  if (lowerBase === lowerQuery) {
    score = 1000
  } else if (lowerBase.startsWith(lowerQuery)) {
    score = 800
  } else {
    const baseIdx = lowerBase.indexOf(lowerQuery)
    if (baseIdx >= 0) {
      score = 600 - Math.min(baseIdx, 200)
    } else {
      const pathIdx = lowerPath.indexOf(lowerQuery)
      if (pathIdx >= 0) {
        score = 400 - Math.min(pathIdx, 200)
      } else {
        score = fuzzySubsequenceScore(lowerBase, lowerQuery)
      }
    }
  }
  if (score <= 0) return 0

  // 深度惩罚：浅层文件优先
  const depth = slashIdx >= 0 ? lowerPath.slice(0, slashIdx).split('/').length : 0
  score -= depth * 2
  // 大小写精确匹配奖励
  if (base.includes(lowerQuery) && base.indexOf(lowerQuery) >= 0) score += 5
  return score
}

function fuzzySubsequenceScore(lowerBase: string, lowerQuery: string): number {
  if (lowerQuery.length < 2) return 0
  let qi = 0
  let last = -2
  let gaps = 0
  for (let i = 0; i < lowerBase.length && qi < lowerQuery.length; i += 1) {
    if (lowerBase[i] === lowerQuery[qi]) {
      if (last >= 0 && i - last > 1) gaps += 1
      last = i
      qi += 1
    }
  }
  if (qi < lowerQuery.length) return 0
  return 200 - gaps * 10 - Math.min(lowerBase.length, 100)
}
