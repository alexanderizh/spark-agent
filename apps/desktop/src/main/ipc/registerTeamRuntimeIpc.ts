import type { IpcMainInvokeEvent } from 'electron'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { TeamRuntimeBackend } from './teamRuntimeBackend.js'

export function registerTeamRuntimeIpc(options: { backend?: Pick<TeamRuntimeBackend, 'getTaskGraph' | 'mutateTaskGraph' | 'getDeliberation' | 'mutateDeliberation'>; authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean } = {}): void {
  const backend = options.backend ?? new TeamRuntimeBackend({ db: getDatabase() })
  const authorize = options.authorizeRenderer ?? ((event: IpcMainInvokeEvent) => { const window = getMainWindow(); return window != null && !window.isDestroyed() && event.sender === window.webContents })
  const assertTrusted = (event: IpcMainInvokeEvent) => { if (!authorize(event)) throw new SparkError('PERMISSION_DENIED', 'Team Runtime 仅允许主应用窗口访问。') }
  typedIpcHandle('task-graph:get', async (request, event) => { assertTrusted(event); return backend.getTaskGraph(request.sessionId) })
  typedIpcHandle('task-graph:mutate', async (request, event) => { assertTrusted(event); return backend.mutateTaskGraph(request) })
  typedIpcHandle('deliberation:get', async (request, event) => { assertTrusted(event); return backend.getDeliberation(request.sessionId) })
  typedIpcHandle('deliberation:mutate', async (request, event) => { assertTrusted(event); return backend.mutateDeliberation(request) })
}
