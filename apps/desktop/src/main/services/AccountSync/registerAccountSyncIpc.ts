import { getDatabase } from '../../db.js'
import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { getAuthService } from '../Auth/AuthService.js'
import { AccountSyncService } from './AccountSyncService.js'

let service: AccountSyncService | null = null

function getAccountSyncService(): AccountSyncService {
  service ??= new AccountSyncService(getDatabase(), getAuthService())
  return service
}

export function registerAccountSyncIpc(): void {
  typedIpcHandle('account-sync:get-preferences', async () =>
    getAccountSyncService().getPreferences(),
  )
  typedIpcHandle('account-sync:update-preferences', async (request) =>
    getAccountSyncService().updatePreferences(request),
  )
  typedIpcHandle('account-sync:execute', async (request) =>
    getAccountSyncService().execute(request),
  )
  typedIpcHandle('account-sync:preview', async (request) =>
    getAccountSyncService().preview(request),
  )
  typedIpcHandle('account-sync:list-history', async (request) =>
    getAccountSyncService().listHistory(request.page, request.pageSize),
  )
}

export function __resetAccountSyncServiceForTesting(): void {
  service = null
}
