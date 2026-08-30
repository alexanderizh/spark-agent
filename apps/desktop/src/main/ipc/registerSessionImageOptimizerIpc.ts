import { app } from 'electron'
import path from 'node:path'
import { SessionImageOptimizer } from '../services/SessionImageOptimizer.js'
import { typedIpcHandle } from './typed-ipc.js'

export function registerSessionImageOptimizerIpc(): void {
  const optimizer = new SessionImageOptimizer({
    outputRoot: path.join(app.getPath('temp'), 'spark-agent-session-images'),
  })

  typedIpcHandle('file:prepare-session-images', async ({ sourcePaths }) => ({
    results: await optimizer.optimizeBatch(sourcePaths),
  }))

  void optimizer.cleanupExpiredFiles()
}
