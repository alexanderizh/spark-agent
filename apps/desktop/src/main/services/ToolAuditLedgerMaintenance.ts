/**
 * ToolAuditLedgerMaintenance — 工具执行审计账本与载荷归档的周期治理
 * （设计方案 §4.5 / P4）。
 *
 * 保留期策略（默认值，暂无 UI 设置项）：
 *   - 账本行：created_at 早于 90 天 → repo.prune 删行；删行后已无任何行引用
 *     的载荷归档 id 经回调返回，本服务一并删除其工作区文件。
 *   - 载荷文件（.spark-agent/audit/tool-payloads/，内容寻址共享）：
 *     mtime 超 30 天删除（行仍保留 sha256/bytes，原文回看降级）；删除后目录
 *     总量仍超 256MB 配额时按 mtime 从旧到新继续删至配额内。
 *
 * 节奏对齐 SnapshotVaultMaintenance / TempMediaFilesMaintenance（6 小时一跑，
 * interval.unref）；失败只记日志，下次再试。审计真值在行与哈希链——本任务
 * 任何失败都不影响审计完整性，只影响磁盘占用。
 */

import type { Dirent, Stats } from 'node:fs'
import { readdir, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import { ToolInvocationRepository, WorkspaceRepository, type SparkDatabase } from '@spark/storage'

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000
/** 账本行保留 90 天（审计回溯窗口）。 */
export const TOOL_AUDIT_LEDGER_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
/** 载荷归档文件保留 30 天（比账本短命：原文是查看数据，行是审计事实）。 */
export const TOOL_AUDIT_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
/** 载荷归档目录配额 256MB（超限从最旧开始删）。 */
export const TOOL_AUDIT_PAYLOAD_QUOTA_BYTES = 256 * 1024 * 1024

const log = createLogger('tool-audit-maintenance')

/** 载荷归档目录段（与 agent-runtime 采集层 AUDIT_PAYLOAD_DIRECTORY 保持一致）。 */
const AUDIT_PAYLOAD_DIR_SEGMENTS = ['.spark-agent', 'audit', 'tool-payloads'] as const

export interface ToolAuditMaintenanceResult {
  ledgerRowsDeleted: number
  payloadFilesDeleted: number
  bytesFreed: number
}

export class ToolAuditLedgerMaintenance {
  private readonly intervalMs: number
  private readonly ledgerRetentionMs: number
  private readonly payloadRetentionMs: number
  private readonly payloadQuotaBytes: number
  private readonly now: () => number
  private interval: NodeJS.Timeout | null = null
  private activeRun: Promise<ToolAuditMaintenanceResult> | null = null

  constructor(
    private readonly db: SparkDatabase,
    options?: {
      intervalMs?: number
      ledgerRetentionMs?: number
      payloadRetentionMs?: number
      payloadQuotaBytes?: number
      now?: () => number
    },
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS
    this.ledgerRetentionMs = options?.ledgerRetentionMs ?? TOOL_AUDIT_LEDGER_RETENTION_MS
    this.payloadRetentionMs = options?.payloadRetentionMs ?? TOOL_AUDIT_PAYLOAD_RETENTION_MS
    this.payloadQuotaBytes = options?.payloadQuotaBytes ?? TOOL_AUDIT_PAYLOAD_QUOTA_BYTES
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

  runOnce(): Promise<ToolAuditMaintenanceResult> {
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

  private async execute(): Promise<ToolAuditMaintenanceResult> {
    const repo = new ToolInvocationRepository(this.db)
    const ledgerCutoff = new Date(this.now() - this.ledgerRetentionMs).toISOString()

    // 1) 账本行保留期 + 无引用载荷回收（repo 回调给的 id 已确认无任何行引用）。
    let unrefIds: string[] = []
    let ledgerRowsDeleted = 0
    try {
      const pruned = repo.prune(ledgerCutoff, (artifactIds) => {
        unrefIds = artifactIds
      })
      ledgerRowsDeleted = pruned.deletedRows
    } catch (error) {
      log.warn('tool audit ledger prune failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // 2) 载荷文件保留期 + 配额（逐工作区）。
    const roots = this.workspaceRoots()
    let payloadFilesDeleted = 0
    let bytesFreed = 0
    for (const root of roots) {
      const dirPath = join(root, ...AUDIT_PAYLOAD_DIR_SEGMENTS)
      let entries: Dirent[]
      try {
        entries = await readdir(dirPath, { withFileTypes: true })
      } catch {
        continue
      }
      const payloadCutoff = this.now() - this.payloadRetentionMs
      const survivors: Array<{ name: string; path: string; mtimeMs: number; size: number }> = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const filePath = join(dirPath, entry.name)
        let info: Stats
        try {
          info = await stat(filePath)
        } catch {
          continue
        }
        if (info.mtimeMs < payloadCutoff || unrefIds.includes(stripJsonExt(entry.name))) {
          try {
            await rm(filePath, { force: true })
            payloadFilesDeleted += 1
            bytesFreed += info.size
          } catch {
            /* 单文件失败下次再试 */
          }
        } else {
          survivors.push({
            name: entry.name,
            path: filePath,
            mtimeMs: info.mtimeMs,
            size: info.size,
          })
        }
      }
      // 3) 配额：从最旧开始继续删到配额内。
      let totalBytes = survivors.reduce((sum, item) => sum + item.size, 0)
      if (totalBytes > this.payloadQuotaBytes) {
        for (const item of [...survivors].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
          if (totalBytes <= this.payloadQuotaBytes) break
          try {
            await unlink(item.path)
            payloadFilesDeleted += 1
            bytesFreed += item.size
            totalBytes -= item.size
          } catch {
            /* 下次再试 */
          }
        }
      }
    }
    return { ledgerRowsDeleted, payloadFilesDeleted, bytesFreed }
  }

  private workspaceRoots(): string[] {
    try {
      return new WorkspaceRepository(this.db)
        .listAll(500, 0)
        .flatMap((workspace) =>
          workspace.root_path != null && workspace.root_path !== '' ? [workspace.root_path] : [],
        )
    } catch {
      return []
    }
  }

  private runScheduled(): void {
    void this.runOnce().then(
      (result) => {
        if (result.ledgerRowsDeleted > 0 || result.payloadFilesDeleted > 0) {
          log.info(
            `Tool audit maintenance completed: ledgerRowsDeleted=${result.ledgerRowsDeleted} payloadFilesDeleted=${result.payloadFilesDeleted} bytesFreed=${result.bytesFreed}`,
          )
        }
      },
      () => {
        log.warn('Tool audit maintenance failed and will be retried')
      },
    )
  }
}

function stripJsonExt(name: string): string {
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name
}
