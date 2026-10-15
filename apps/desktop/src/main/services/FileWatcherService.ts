/**
 * FileWatcherService — 文件系统变更检测服务
 *
 * 使用 Node.js fs.watch (recursive) 监听工作区目录变更，
 * 通过 IPC stream 推送到渲染进程。
 *
 * 特性：
 *   - 防抖：100ms 内同一路径的多次事件合并为一次
 *   - 过滤：忽略 node_modules, .git, .DS_Store, dist, build 等
 *   - 生命周期管理：同一根目录的消费方共享 watcher；计数与会话范围分别维护
 *   - 相对路径：推送相对于本次监听根目录的路径
 */

import { watch, existsSync, type FSWatcher } from 'fs'
import { relative, join, basename, resolve } from 'path'
import { createLogger } from '@spark/shared'
import type { SessionId, WorkspaceFileChangePayload } from '@spark/protocol'
import { pushStreamEvent } from '../ipc/typed-ipc.js'

export type FileWatcherEventListener = (
  eventType: 'rename' | 'change',
  filename: string | Buffer | null,
) => void

export type FileWatcherFactory = (rootPath: string, listener: FileWatcherEventListener) => FSWatcher

const defaultWatchFactory: FileWatcherFactory = (rootPath, listener) =>
  watch(rootPath, { recursive: true, encoding: 'utf8' }, listener)

const log = createLogger('file-watcher')

/** 默认忽略的目录和文件模式 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  'Thumbs.db',
  'dist',
  'build',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.eslintcache',
  '*.pyc',
  '__pycache__',
  '.venv',
  'venv',
  '.env.local',
  '.env.*.local',
  'coverage',
  '.coverage',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '*.swp',
  '*.swo',
  '*~',
]

/** 防抖间隔（ms） */
const DEBOUNCE_MS = 100

/** 批量推送间隔（ms） */
const BATCH_INTERVAL_MS = 200

/** 最大批量大小 */
const MAX_BATCH_SIZE = 50

type WatchScope = {
  sessionId?: SessionId
  refCount: number
}

type ActiveWatcher = {
  workspaceId: string
  watcher: FSWatcher
  scopes: Map<string, WatchScope>
}

type WatchRegistration = {
  watchKey: string
  refCount: number
}

export class FileWatcherService {
  /** A physical watcher is shared only when workspace and resolved root match. */
  private activeWatchers = new Map<string, ActiveWatcher>()
  /** Each UI scope balances its own start/stop calls, even when roots are shared. */
  private registrations = new Map<string, WatchRegistration>()
  private pendingChanges = new Map<string, WorkspaceFileChangePayload>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly watchFactory: FileWatcherFactory = defaultWatchFactory) {}

  /**
   * 开始监听指定工作区根目录。相同根目录可以共享底层 watcher，
   * 但不同 session 的订阅和事件仍保持隔离。
   *
   * @param workspaceId - 工作区 ID
   * @param rootPath - 工作区根目录绝对路径
   * @param ignorePatterns - 自定义忽略模式
   */
  start(
    workspaceId: string,
    rootPath: string,
    ignorePatterns?: string[],
    sessionId?: SessionId,
  ): void {
    const normalizedRoot = resolve(rootPath)
    const watchKey = JSON.stringify([workspaceId, normalizedRoot])
    const scopeKey = JSON.stringify([workspaceId, sessionId ?? null])
    const priorRegistration = this.registrations.get(scopeKey)
    const watcherEntry = this.activeWatchers.get(watchKey)

    if (priorRegistration?.watchKey === watchKey && watcherEntry?.scopes.has(scopeKey) === true) {
      priorRegistration.refCount += 1
      const scope = watcherEntry.scopes.get(scopeKey)
      if (scope != null) scope.refCount += 1
      log.debug(`File watcher shared for workspace ${workspaceId}`)
      return
    }

    const carriedRefCount = priorRegistration?.refCount ?? 0
    if (priorRegistration != null) {
      this.registrations.delete(scopeKey)
      this.detachScope(scopeKey, priorRegistration.watchKey)
    }

    let entry = this.activeWatchers.get(watchKey)
    if (entry == null) {
      const patterns = [...DEFAULT_IGNORE_PATTERNS, ...(ignorePatterns ?? [])]
      const scopes = new Map<string, WatchScope>()
      log.info(`Starting file watcher for workspace ${workspaceId}, root=${normalizedRoot}`)

      try {
        const watcher = this.watchFactory(normalizedRoot, (eventType, filename) => {
          if (filename == null) return
          const fileName = typeof filename === 'string' ? filename : filename.toString()
          if (this.shouldIgnore(fileName, patterns)) return

          const fullPath = join(normalizedRoot, fileName)
          const relativePath = relative(normalizedRoot, fullPath)
          // macOS/Linux report both create and delete as `rename`; path existence distinguishes them.
          const changeType: WorkspaceFileChangePayload['changeType'] =
            eventType === 'rename' ? (existsSync(fullPath) ? 'create' : 'delete') : 'modify'

          for (const [activeScopeKey, scope] of scopes) {
            this.addPendingChange(watchKey, activeScopeKey, {
              workspaceId,
              ...(scope.sessionId == null ? {} : { sessionId: scope.sessionId }),
              changeType,
              path: relativePath,
              timestamp: new Date().toISOString(),
            })
          }
        })
        watcher.on('error', (err) => {
          log.error(`File watcher error for workspace ${workspaceId}: ${String(err)}`)
        })
        entry = { workspaceId, watcher, scopes }
        this.activeWatchers.set(watchKey, entry)
      } catch (err) {
        log.error(`Failed to start file watcher for workspace ${workspaceId}: ${String(err)}`)
        return
      }
    }

    const refCount = carriedRefCount + 1
    entry.scopes.set(scopeKey, { ...(sessionId == null ? {} : { sessionId }), refCount })
    this.registrations.set(scopeKey, { watchKey, refCount })
    log.info(`File watcher started for workspace ${workspaceId}`)
  }

  /**
   * 停止一个 UI scope 的监听。返回值表示其最后一个底层 watcher 是否被关闭。
   */
  stop(workspaceId: string, sessionId?: SessionId): boolean {
    const scopeKey = JSON.stringify([workspaceId, sessionId ?? null])
    const registration = this.registrations.get(scopeKey)
    if (registration == null) return false

    if (registration.refCount > 1) {
      registration.refCount -= 1
      const entry = this.activeWatchers.get(registration.watchKey)
      const scope = entry?.scopes.get(scopeKey)
      if (scope != null) scope.refCount = registration.refCount
      log.debug(
        `File watcher stop deferred for workspace ${workspaceId} (refCount=${registration.refCount})`,
      )
      return false
    }

    this.registrations.delete(scopeKey)
    const entry = this.activeWatchers.get(registration.watchKey)
    if (entry == null) return false
    entry.scopes.delete(scopeKey)
    this.clearPendingChanges(registration.watchKey, scopeKey)
    if (entry.scopes.size > 0) return false

    entry.watcher.close()
    this.activeWatchers.delete(registration.watchKey)
    this.clearPendingChanges(registration.watchKey)
    log.info(`File watcher stopped for workspace ${workspaceId}`)
    return true
  }

  /**
   * 停止所有 watcher
   */
  stopAll(): void {
    for (const entry of this.activeWatchers.values()) {
      entry.scopes.clear()
      entry.watcher.close()
    }
    this.activeWatchers.clear()
    this.registrations.clear()
    this.pendingChanges.clear()
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
    if (this.batchTimer != null) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /**
   * 检查指定工作区是否正在监听
   */
  isWatching(workspaceId: string): boolean {
    return Array.from(this.activeWatchers.values()).some(
      (entry) => entry.workspaceId === workspaceId,
    )
  }

  private detachScope(scopeKey: string, watchKey: string): void {
    const entry = this.activeWatchers.get(watchKey)
    if (entry == null) return
    entry.scopes.delete(scopeKey)
    this.clearPendingChanges(watchKey, scopeKey)
    if (entry.scopes.size === 0) {
      entry.watcher.close()
      this.activeWatchers.delete(watchKey)
      this.clearPendingChanges(watchKey)
    }
  }

  private clearPendingChanges(watchKey: string, scopeKey?: string): void {
    const prefix = scopeKey == null ? `${watchKey}\0` : `${watchKey}\0${scopeKey}\0`
    for (const key of this.pendingChanges.keys()) {
      if (key.startsWith(prefix)) this.pendingChanges.delete(key)
    }
    for (const [key, timer] of this.debounceTimers) {
      if (!key.startsWith(prefix)) continue
      clearTimeout(timer)
      this.debounceTimers.delete(key)
    }
  }

  /**
   * 添加待推送的变更，防抖处理
   */
  private addPendingChange(
    watchKey: string,
    scopeKey: string,
    change: WorkspaceFileChangePayload,
  ): void {
    const key = `${watchKey}\0${scopeKey}\0${change.path}`

    // 防抖：同一路径在 DEBOUNCE_MS 内的多次变更合并
    const existingTimer = this.debounceTimers.get(key)
    if (existingTimer != null) {
      clearTimeout(existingTimer)
    }

    // 如果已有 pending change，升级 changeType（create 优先级最低，delete 最高）
    const existing = this.pendingChanges.get(key)
    if (existing != null) {
      // 如果已有 create，新来 modify 仍保持 create；如果已有 modify，新来 delete 升级为 delete
      const typePriority: Record<string, number> = { create: 0, modify: 1, delete: 2, rename: 3 }
      if ((typePriority[change.changeType] ?? 0) > (typePriority[existing.changeType] ?? 0)) {
        existing.changeType = change.changeType
      }
      existing.timestamp = change.timestamp
    } else {
      this.pendingChanges.set(key, change)
    }

    // 设置防抖 timer
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key)
        this.flushBatch()
      }, DEBOUNCE_MS),
    )

    // 安全阀：pending 太多时立即 flush
    if (this.pendingChanges.size >= MAX_BATCH_SIZE) {
      this.flushBatch()
    }
  }

  /**
   * 批量推送 pending changes
   */
  private flushBatch(): void {
    if (this.pendingChanges.size === 0) return

    // 取出所有 pending
    const changes = [...this.pendingChanges.values()]
    this.pendingChanges.clear()

    // 逐个推送到渲染进程
    for (const change of changes) {
      try {
        pushStreamEvent('stream:workspace:file-change', change)
      } catch (err) {
        log.error(`Failed to push file change event: ${String(err)}`)
      }
    }

    log.debug(`Pushed ${changes.length} file change events to renderer`)
  }

  /**
   * 检查文件路径是否应该被忽略
   */
  private shouldIgnore(filePath: string, patterns: string[]): boolean {
    const segments = filePath.split(/[/\\]/)
    const filename = segments[segments.length - 1] ?? ''

    for (const pattern of patterns) {
      // 目录级匹配（如 node_modules, .git）
      if (!pattern.includes('*') && !pattern.includes('.')) {
        if (segments.includes(pattern)) return true
      }
      // 文件扩展名匹配（如 *.pyc）
      else if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1) // '.pyc'
        if (filename.endsWith(ext)) return true
      }
      // 精确文件名匹配（如 .DS_Store, Thumbs.db）
      else if (!pattern.includes('*') && pattern.includes('.')) {
        if (filename === pattern || segments.includes(pattern)) return true
      }
      // 通配符匹配（如 .env.*.local）
      else if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
        if (regex.test(filename)) return true
      }
    }

    // 忽略隐藏文件（以 . 开头）
    if (filename.startsWith('.') && filename !== '.env' && filename !== '.editorconfig') {
      // 允许 .env 和 .editorconfig，其他隐藏文件忽略
      if (
        segments.some(
          (s) => s.startsWith('.') && s !== '.' && s !== '.env' && s !== '.editorconfig',
        )
      ) {
        // 只要路径中包含隐藏目录就忽略（除了 .env, .editorconfig）
        // 但允许 .github, .vscode 等常见配置目录
        const allowedHiddenDirs = [
          '.github',
          '.vscode',
          '.env',
          '.editorconfig',
          '.npmrc',
          '.nvmrc',
          '.node-version',
        ]
        const hiddenDir = segments.find(
          (s) => s.startsWith('.') && s !== '.' && !allowedHiddenDirs.includes(s),
        )
        if (hiddenDir != null) return true
      }
    }

    return false
  }
}

/** 全局单例 */
let _instance: FileWatcherService | null = null

export function getFileWatcherService(): FileWatcherService {
  if (_instance == null) {
    _instance = new FileWatcherService()
  }
  return _instance
}
