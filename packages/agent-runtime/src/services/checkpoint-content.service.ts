/**
 * CheckpointContentService —— 自包含的工作区内容快照（替代失效的 SDK rewindFiles）。
 *
 * 设计见 docs/superpowers/2026-06-30-checkpoint-redesign-content-snapshot.md。
 * 仅在会话开启 checkpoint 且工作区发生实际文件变更时由 SessionService 调用：
 *   - snapshot：把工作区受控文件（受 ignore/size/count 限制）的内容拷入 app-data 存储目录。
 *   - restore：把某个存储目录的内容拷回工作区（含删除快照范围内、当前多出的文件）。
 *   - prune：每会话只保留最近 N 个 checkpoint 目录。
 * 内容拷贝按字节进行（文本/二进制均可精确还原）。
 */
import { readdir, stat, mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('checkpoint-content')

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.turbo', '.next', '.nuxt',
  '.cache', '.parcel-cache', '__pycache__', '.venv', 'venv', 'coverage', 'target',
  'bin', 'obj', '.idea', '.vscode', '.spark-cache', '.spark-artifacts', '.spark-checkpoints',
])
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.eslintcache'])

/** 单文件大小上限（超出跳过，避免快照大二进制/媒体）。 */
const MAX_FILE_SIZE = 5 * 1024 * 1024
/** 单次快照最多文件数（保护主进程）。 */
const MAX_FILES = 5_000

export interface CheckpointSnapshotResult {
  /** 快照存储目录绝对路径 */
  storageDir: string
  /** 已快照的工作区相对路径列表 */
  filePaths: string[]
  /** 是否因数量上限被截断 */
  truncated: boolean
}

export interface CheckpointRestoreOutcome {
  restoredFiles: string[]
  missingFiles: string[]
  /** 因不在快照中而被删除的当前文件（限快照采集范围内） */
  deletedFiles: string[]
}

export class CheckpointContentService {
  /** checkpoint 存储根目录（app-data，db 同目录下的 checkpoints/）。 */
  constructor(private readonly baseDir: string) {}

  private sessionDir(sessionId: string): string {
    return join(this.baseDir, sanitizeId(sessionId))
  }

  checkpointDir(sessionId: string, checkpointId: string): string {
    return join(this.sessionDir(sessionId), sanitizeId(checkpointId))
  }

  /** 把工作区受控文件内容快照到指定 checkpoint 目录。 */
  async snapshot(rootPath: string, sessionId: string, checkpointId: string): Promise<CheckpointSnapshotResult> {
    const storageDir = this.checkpointDir(sessionId, checkpointId)
    const filePaths: string[] = []
    let truncated = false

    const walk = async (dir: string): Promise<void> => {
      if (truncated) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (truncated) return
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue
          await walk(join(dir, entry.name))
        } else if (entry.isFile()) {
          if (IGNORE_FILES.has(entry.name)) continue
          if (filePaths.length >= MAX_FILES) {
            truncated = true
            log.warn('checkpoint snapshot truncated', { rootPath, count: filePaths.length })
            return
          }
          const fullPath = join(dir, entry.name)
          let size = 0
          try {
            size = (await stat(fullPath)).size
          } catch {
            continue
          }
          if (size > MAX_FILE_SIZE) continue
          const rel = relative(rootPath, fullPath)
          const dest = join(storageDir, rel)
          try {
            await mkdir(dirname(dest), { recursive: true })
            await copyFile(fullPath, dest)
            filePaths.push(rel)
          } catch (err) {
            log.warn('checkpoint snapshot copy failed', { rel, error: errMsg(err) })
          }
        }
      }
    }

    await mkdir(storageDir, { recursive: true })
    await walk(rootPath)
    // 记录文件清单，restore 时据此判断「快照范围内多出的文件」可删。
    try {
      await writeFile(join(storageDir, '.manifest.json'), JSON.stringify({ filePaths }), 'utf8')
    } catch {
      // manifest 失败不致命，restore 退化为不删除多余文件
    }
    log.info('checkpoint snapshot done', { sessionId, checkpointId, files: filePaths.length, truncated })
    return { storageDir, filePaths, truncated }
  }

  /** 把某个 checkpoint 目录的内容拷回工作区。 */
  async restore(rootPath: string, sessionId: string, checkpointId: string): Promise<CheckpointRestoreOutcome> {
    const storageDir = this.checkpointDir(sessionId, checkpointId)
    if (!existsSync(storageDir)) {
      throw new Error(`Checkpoint storage not found: ${checkpointId}`)
    }
    const restoredFiles: string[] = []
    const missingFiles: string[] = []
    const snapshotRel = new Set<string>()

    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile()) {
          if (entry.name === '.manifest.json' && dir === storageDir) continue
          const rel = relative(storageDir, fullPath)
          snapshotRel.add(rel)
          const dest = join(rootPath, rel)
          try {
            await mkdir(dirname(dest), { recursive: true })
            await copyFile(fullPath, dest)
            restoredFiles.push(rel)
          } catch (err) {
            missingFiles.push(rel)
            log.warn('checkpoint restore copy failed', { rel, error: errMsg(err) })
          }
        }
      }
    }
    await walk(storageDir)

    // 删除「快照采集范围内、当前工作区存在但快照里没有」的文件（即该 checkpoint 之后新增的文件）。
    const deletedFiles = await this.deleteFilesNotInSnapshot(rootPath, snapshotRel)

    log.info('checkpoint restore done', { sessionId, checkpointId, restored: restoredFiles.length, deleted: deletedFiles.length })
    return { restoredFiles, missingFiles, deletedFiles }
  }

  /** 删除工作区中不在快照集合内的「受控」文件（同 snapshot 的 ignore/size 规则），避免误删 node_modules 等。 */
  private async deleteFilesNotInSnapshot(rootPath: string, snapshotRel: Set<string>): Promise<string[]> {
    const deleted: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue
          await walk(fullPath)
        } else if (entry.isFile()) {
          if (IGNORE_FILES.has(entry.name)) continue
          let size = 0
          try {
            size = (await stat(fullPath)).size
          } catch {
            continue
          }
          if (size > MAX_FILE_SIZE) continue
          const rel = relative(rootPath, fullPath)
          if (!snapshotRel.has(rel)) {
            try {
              await rm(fullPath)
              deleted.push(rel)
            } catch (err) {
              log.warn('checkpoint restore delete failed', { rel, error: errMsg(err) })
            }
          }
        }
      }
    }
    await walk(rootPath)
    return deleted
  }

  /** 读取某 checkpoint 的快照文件清单（无则返回 null）。 */
  async readManifest(sessionId: string, checkpointId: string): Promise<string[] | null> {
    try {
      const raw = await readFile(join(this.checkpointDir(sessionId, checkpointId), '.manifest.json'), 'utf8')
      const parsed = JSON.parse(raw) as { filePaths?: string[] }
      return Array.isArray(parsed.filePaths) ? parsed.filePaths : null
    } catch {
      return null
    }
  }

  /** 每会话只保留最近 keepN 个 checkpoint 目录，删除更旧的。keepIds 为当前有效的 checkpointId（按新→旧）。 */
  async prune(sessionId: string, keepIds: string[]): Promise<void> {
    const dir = this.sessionDir(sessionId)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const keep = new Set(keepIds.map(sanitizeId))
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (keep.has(entry.name)) continue
      try {
        await rm(join(dir, entry.name), { recursive: true, force: true })
      } catch (err) {
        log.warn('checkpoint prune failed', { dir: entry.name, error: errMsg(err) })
      }
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
