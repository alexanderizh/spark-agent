import type { IpcMainInvokeEvent } from 'electron'
import { SparkError } from '@spark/shared'
import { SessionRepository, TeamDiscussionRepository, RoomLedgerService } from '@spark/storage'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { OutcomeRoomBackend } from './outcomeRoomBackend.js'

export interface RegisterOutcomeRoomIpcOptions {
  backend?: Pick<OutcomeRoomBackend, 'getSnapshot' | 'mutate'>
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

export function registerOutcomeRoomIpc(options: RegisterOutcomeRoomIpcOptions = {}): void {
  const db = getDatabase()
  const backend =
    options.backend ??
    new OutcomeRoomBackend({
      sessionRepository: new SessionRepository(db),
      discussionRepository: new TeamDiscussionRepository(db),
      ledger: RoomLedgerService.forUser(db, 'desktop-user'),
    })
  const authorizeRenderer = options.authorizeRenderer ?? isTrustedRenderer
  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (!authorizeRenderer(event)) {
      throw new SparkError('PERMISSION_DENIED', 'Outcome Room 仅允许主应用窗口访问。')
    }
  }

  typedIpcHandle('outcome-room:get', async (request, event) => {
    assertTrusted(event)
    return backend.getSnapshot(request.sessionId)
  })
  typedIpcHandle('outcome-room:mutate', async (request, event) => {
    assertTrusted(event)
    return backend.mutate(request)
  })
}

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow()
  return mainWindow != null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}
