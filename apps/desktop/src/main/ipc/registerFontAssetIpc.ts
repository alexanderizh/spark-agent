import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import {
  getManagedFontAssetStatus,
  installManagedFontAssets,
  subscribeManagedFontAssetStatus,
} from '../services/FontAssetService.js'

let unsubscribeStatus: (() => void) | null = null

export function registerFontAssetIpc(): void {
  unsubscribeStatus?.()
  unsubscribeStatus = subscribeManagedFontAssetStatus((status) => {
    pushStreamEvent('stream:font-assets:status', status)
  })

  typedIpcHandle('font-assets:status', async () => getManagedFontAssetStatus())
  typedIpcHandle('font-assets:install', async (request) =>
    installManagedFontAssets({ force: request.force ?? true }),
  )
}
