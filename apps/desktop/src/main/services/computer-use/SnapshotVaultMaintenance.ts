import { app } from 'electron'
import { join } from 'node:path'
import { ApplicationSnapshotRepository, type SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import {
  SnapshotVault,
  type SnapshotVaultCleanupRepository,
  type SnapshotVaultCleanupResult,
} from './SnapshotVault.js'
import { SnapshotVaultKeyProvider } from './SnapshotVaultKeyProvider.js'

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000
const CLEANUP_BATCH_SIZE = 200
const log = createLogger('snapshot-vault-maintenance')

interface SnapshotRetentionRepository extends SnapshotVaultCleanupRepository {
  listExpired(nowIso: string, limit?: number): Array<{ id: string }>
  delete(id: string): unknown
}

interface SnapshotVaultCleanupRunner {
  cleanup(repository: SnapshotVaultCleanupRepository): Promise<SnapshotVaultCleanupResult>
}

export interface SnapshotVaultMaintenanceResult extends SnapshotVaultCleanupResult {
  expiredSnapshotsDeleted: number
}

export class SnapshotVaultMaintenance {
  private readonly repository: SnapshotRetentionRepository
  private readonly vault: SnapshotVaultCleanupRunner
  private readonly intervalMs: number
  private readonly now: () => Date
  private interval: NodeJS.Timeout | null = null
  private activeRun: Promise<SnapshotVaultMaintenanceResult> | null = null

  constructor(options: {
    repository: SnapshotRetentionRepository
    vault: SnapshotVaultCleanupRunner
    intervalMs?: number
    now?: () => Date
  }) {
    this.repository = options.repository
    this.vault = options.vault
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.now = options.now ?? (() => new Date())
  }

  start(): void {
    if (this.interval != null) return
    this.runScheduled()
    this.interval = setInterval(() => this.runScheduled(), this.intervalMs)
    this.interval.unref()
  }

  runOnce(): Promise<SnapshotVaultMaintenanceResult> {
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

  async dispose(): Promise<void> {
    if (this.interval != null) {
      clearInterval(this.interval)
      this.interval = null
    }
    await this.activeRun?.catch(() => undefined)
  }

  private async execute(): Promise<SnapshotVaultMaintenanceResult> {
    const expired = this.repository.listExpired(this.now().toISOString(), CLEANUP_BATCH_SIZE)
    let expiredSnapshotsDeleted = 0
    for (const snapshot of expired) {
      this.repository.delete(snapshot.id)
      expiredSnapshotsDeleted += 1
    }
    const cleanup = await this.vault.cleanup(this.repository)
    return { expiredSnapshotsDeleted, ...cleanup }
  }

  private runScheduled(): void {
    void this.runOnce().then(
      (result) => {
        if (
          result.expiredSnapshotsDeleted > 0 ||
          result.unreferencedDeleted > 0 ||
          result.orphanFilesDeleted > 0
        ) {
          log.info('Snapshot Vault maintenance completed', result)
        }
      },
      () => {
        // Errors may contain filesystem paths or crypto details, so keep this log intentionally generic.
        log.warn('Snapshot Vault maintenance failed and will be retried')
      },
    )
  }
}

export function startSnapshotVaultMaintenance(database: SparkDatabase): SnapshotVaultMaintenance {
  const maintenance = new SnapshotVaultMaintenance({
    repository: new ApplicationSnapshotRepository(database),
    vault: new SnapshotVault({
      rootDirectory: join(app.getPath('userData'), 'snapshot-vault', 'blobs'),
      keyProvider: new SnapshotVaultKeyProvider(),
    }),
  })
  maintenance.start()
  return maintenance
}
