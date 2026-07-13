import { parentPort, workerData } from 'node:worker_threads'
import { EventRepository, SparkDatabase, TurnRequestRepository } from '@spark/storage'

type MaintenanceWorkerData = {
  dbPath: string
}

type MaintenanceWorkerResult = {
  type: 'transient-event-cleanup-complete'
  deleted: number
  terminalTurnRequestsDeleted: number
}

const data = workerData as MaintenanceWorkerData
const TERMINAL_TURN_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

async function runMaintenance(): Promise<void> {
  const db = new SparkDatabase(data.dbPath)
  const repo = new EventRepository(db)
  let totalDeleted = 0
  let terminalTurnRequestsDeleted = 0

  try {
    while (true) {
      const deleted = repo.deleteTransientDeltasBatch(1000)
      totalDeleted += deleted
      if (deleted === 0) break
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    const turnRequests = new TurnRequestRepository(db)
    const terminalCutoff = new Date(Date.now() - TERMINAL_TURN_REQUEST_RETENTION_MS).toISOString()
    while (true) {
      const deleted = turnRequests.deleteTerminalBeforeBatch(terminalCutoff, 1000)
      terminalTurnRequestsDeleted += deleted
      if (deleted === 0) break
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    parentPort?.postMessage({
      type: 'transient-event-cleanup-complete',
      deleted: totalDeleted,
      terminalTurnRequestsDeleted,
    } satisfies MaintenanceWorkerResult)
  } finally {
    db.close()
  }
}

void runMaintenance()
