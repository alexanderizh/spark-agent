/**
 * TempMediaFilesMaintenance — 桌面临时媒体目录周期清理。
 *
 * 覆盖 app.getPath('temp') 下三类只写不清的目录（粘贴媒体、图片预览副本）：
 *   - spark-agent-pasted-images / spark-agent-pasted-audio / spark-agent-pasted-video
 *     （无项目根时的粘贴落盘；有项目根的落在项目 assets/，不在此清理范围）
 *   - spark-agent-image-previews（复制出的预览副本）
 *
 * 按 mtime 超过保留期（默认 7 天，对齐 SessionImageOptimizer 的临时文件口径）删除；
 * 目录清空后顺手移除空目录。6 小时一跑（对齐 SnapshotVaultMaintenance 节奏），
 * 单实例去重防并发。失败只记日志，下次再试。
 */

import { app } from 'electron'
import type { Dirent } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000
/** 临时媒体保留 7 天：粘贴/预览文件 7 天未被消费即可视为废弃。 */
export const TEMP_MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const TEMP_MEDIA_DIR_NAMES = [
  'spark-agent-pasted-images',
  'spark-agent-pasted-audio',
  'spark-agent-pasted-video',
  'spark-agent-image-previews',
] as const

const log = createLogger('temp-media-maintenance')

export interface TempMediaCleanupResult {
  filesDeleted: number
  bytesFreed: number
}

export class TempMediaFilesMaintenance {
  private readonly intervalMs: number
  private readonly retentionMs: number
  private readonly now: () => number
  private interval: NodeJS.Timeout | null = null
  private activeRun: Promise<TempMediaCleanupResult> | null = null

  constructor(options?: { intervalMs?: number; retentionMs?: number; now?: () => number }) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS
    this.retentionMs = options?.retentionMs ?? TEMP_MEDIA_RETENTION_MS
    this.now = options?.now ?? Date.now
  }

  start(): void {
    if (this.interval != null) return
    this.runScheduled()
    this.interval = setInterval(() => this.runScheduled(), this.intervalMs)
    this.interval.unref()
  }

  stop(): void {
    if (this.interval != null) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  runOnce(): Promise<TempMediaCleanupResult> {
    if (this.activeRun != null) return this.activeRun
    const run = this.execute()
    this.activeRun = run
    run.then(
      () => {
        if (this.activeRun === run) this.activeRun = null
      },
      () => {
        if (this.activeRun === run) this.activeRun = null
      },
    )
    return run
  }

  private async execute(): Promise<TempMediaCleanupResult> {
    const tempRoot = app.getPath('temp')
    const cutoff = this.now() - this.retentionMs
    let filesDeleted = 0
    let bytesFreed = 0
    for (const dirName of TEMP_MEDIA_DIR_NAMES) {
      const dirPath = join(tempRoot, dirName)
      let entries: Dirent[]
      try {
        entries = await readdir(dirPath, { withFileTypes: true })
      } catch {
        // 目录不存在（尚未产生过此类临时文件）视为正常
        continue
      }
      let remaining = 0
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = join(dirPath, entry.name)
        try {
          const info = await stat(filePath)
          if (info.mtimeMs >= cutoff) {
            remaining += 1
            continue
          }
          await rm(filePath, { force: true })
          filesDeleted += 1
          bytesFreed += info.size
        } catch {
          // 单个文件删除失败不影响其余条目；下次运行重试
          remaining += 1
        }
      }
      if (remaining === 0) {
        // 目录已空则移除；失败无害（下次再试）
        await rm(dirPath, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    return { filesDeleted, bytesFreed }
  }

  private runScheduled(): void {
    void this.runOnce().then(
      (result) => {
        if (result.filesDeleted > 0) {
          log.info(
            `Temp media maintenance completed: deleted=${result.filesDeleted} freedBytes=${result.bytesFreed}`,
          )
        }
      },
      () => {
        log.warn('Temp media maintenance failed and will be retried')
      },
    )
  }
}
