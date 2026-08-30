import type { IpcMainInvokeEvent } from 'electron'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { TeamP1Backend } from './teamP1Backend.js'

export function registerTeamP1Ipc(options: { backend?: Pick<TeamP1Backend, 'getSnapshot' | 'mutate'>; authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean } = {}): void {
  const backend = options.backend ?? new TeamP1Backend({ db: getDatabase() })
  const authorize = options.authorizeRenderer ?? ((event: IpcMainInvokeEvent) => {
    const window = getMainWindow()
    return window != null && !window.isDestroyed() && event.sender === window.webContents
  })
  const assertTrusted = (event: IpcMainInvokeEvent) => { if (!authorize(event)) throw new SparkError('PERMISSION_DENIED', 'Team P1 仅允许主应用窗口访问。') }
  typedIpcHandle('team-p1:get', async (request, event) => { assertTrusted(event); return backend.getSnapshot(request.sessionId) })
  typedIpcHandle('team-p1:mutate', async (request, event) => { assertTrusted(event); return { snapshot: backend.mutate(request) } })
}
