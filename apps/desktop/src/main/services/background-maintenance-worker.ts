import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('main:background-maintenance')

type MaintenanceWorkerMessage = {
  type: 'transient-event-cleanup-complete'
  deleted: number
  terminalTurnRequestsDeleted: number
}

export interface BackgroundMaintenanceWorker {
  dispose(): void
}

export function startBackgroundMaintenanceWorker(dbPath: string): BackgroundMaintenanceWorker {
  const worker = new Worker(join(__dirname, 'background-maintenance-worker.js'), {
    workerData: { dbPath },
  })
  let disposed = false

  worker.on('message', (message: MaintenanceWorkerMessage) => {
    if (
      message.type === 'transient-event-cleanup-complete' &&
      (message.deleted > 0 || message.terminalTurnRequestsDeleted > 0)
    ) {
      log.info('Background database maintenance completed off the main thread', {
        transientEventsDeleted: message.deleted,
        terminalTurnRequestsDeleted: message.terminalTurnRequestsDeleted,
      })
    }
  })
  worker.on('error', (error) => {
    if (!disposed) log.warn('Background maintenance worker failed', { error: error.message })
  })

  return {
    dispose() {
      if (disposed) return
      disposed = true
      void worker.terminate()
    },
  }
}
