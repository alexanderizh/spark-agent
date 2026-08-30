/**
 * FileWatcherService — 文件系统变更检测服务
 *
 * 使用 Node.js fs.watch (recursive) 监听工作区目录变更，
 * 通过 IPC stream 推送到渲染进程。
 *
 * 特性：
 *   - 防抖：100ms 内同一路径的多次事件合并为一次
 *   - 过滤：忽略 node_modules, .git, .DS_Store, dist, build 等
 *   - 生命周期管理：start/stop，workspace 切换时自动停止上一个
 *   - 相对路径：推送相对于 workspace root 的路径
 */

import { watch, type FSWatcher } from 'fs'
import { relative, join, basename } from 'path'
import { createLogger } from '@spark/shared'
import type { WorkspaceFileChangePayload } from '@spark/protocol'
import { pushStreamEvent } from '../ipc/typed-ipc.js'

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

export class FileWatcherService {
  private activeWatchers = new Map<string, FSWatcher>()
  private pendingChanges = new Map<string, WorkspaceFileChangePayload>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private workspaceRoots = new Map<string, string>()

  /**
   * 开始监听指定工作区的文件变更
   *
   * @param workspaceId - 工作区 ID
   * @param rootPath - 工作区根目录绝对路径
   * @param ignorePatterns - 自定义忽略模式
   */
  start(workspaceId: string, rootPath: string, ignorePatterns?: string[]): void {
    // 如果已有 watcher，先停止
    this.stop(workspaceId)

    this.workspaceRoots.set(workspaceId, rootPath)
    const patterns = [...DEFAULT_IGNORE_PATTERNS, ...(ignorePatterns ?? [])]

    log.info(`Starting file watcher for workspace ${workspaceId}, root=${rootPath}`)

    try {
      const watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
        if (filename == null) return
        if (this.shouldIgnore(filename, patterns)) return

        const fullPath = join(rootPath, filename)
        const relativePath = relative(rootPath, fullPath)

        // 映射 fs.watch eventType 到变更类型
        const changeType = eventType === 'rename' ? 'create' : 'modify'

        this.addPendingChange(workspaceId, {
          workspaceId,
          changeType,
          path: relativePath,
          timestamp: new Date().toISOString(),
        })
      })

      watcher.on('error', (err) => {
        log.error(`File watcher error for ${workspaceId}: ${String(err)}`)
      })

      this.activeWatchers.set(workspaceId, watcher)
      log.info(`File watcher started for workspace ${workspaceId}`)
    } catch (err) {
      log.error(`Failed to start file watcher for ${workspaceId}: ${String(err)}`)
    }
  }

  /**
   * 停止指定工作区的文件监听
   */
  stop(workspaceId: string): boolean {
    const watcher = this.activeWatchers.get(workspaceId)
    if (watcher == null) return false

    watcher.close()
    this.activeWatchers.delete(workspaceId)
    this.workspaceRoots.delete(workspaceId)

    // 清理 pending
    for (const [key, change] of this.pendingChanges.entries()) {
      if (change.workspaceId === workspaceId) {
        this.pendingChanges.delete(key)
      }
    }

    // 清理 debounce timer
    const timerKey = `${workspaceId}:`
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (key.startsWith(timerKey)) {
        clearTimeout(timer)
        this.debounceTimers.delete(key)
      }
    }

    log.info(`File watcher stopped for workspace ${workspaceId}`)
    return true
  }

  /**
   * 停止所有 watcher
   */
  stopAll(): void {
    for (const [workspaceId] of this.activeWatchers) {
      this.stop(workspaceId)
    }
    if (this.batchTimer != null) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /**
   * 检查指定工作区是否正在监听
   */
  isWatching(workspaceId: string): boolean {
    return this.activeWatchers.has(workspaceId)
  }

  /**
   * 添加待推送的变更，防抖处理
   */
  private addPendingChange(workspaceId: string, change: WorkspaceFileChangePayload): void {
    const key = `${workspaceId}:${change.path}`

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
      if (segments.some((s) => s.startsWith('.') && s !== '.' && s !== '.env' && s !== '.editorconfig')) {
        // 只要路径中包含隐藏目录就忽略（除了 .env, .editorconfig）
        // 但允许 .github, .vscode 等常见配置目录
        const allowedHiddenDirs = ['.github', '.vscode', '.env', '.editorconfig', '.npmrc', '.nvmrc', '.node-version']
        const hiddenDir = segments.find((s) => s.startsWith('.') && s !== '.' && !allowedHiddenDirs.includes(s))
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
