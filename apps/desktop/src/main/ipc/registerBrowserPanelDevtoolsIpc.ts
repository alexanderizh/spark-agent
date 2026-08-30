import { app } from 'electron'
import { getBrowserPanelDevtoolsService } from '../services/BrowserPanelDevtoolsService.js'
import { typedIpcHandle } from './typed-ipc.js'

let registered = false

export function registerBrowserPanelDevtoolsIpc(): void {
  if (registered) return
  registered = true

  const service = getBrowserPanelDevtoolsService()
  typedIpcHandle('browser-panel:devtools-open', async (request, event) =>
    service.open(event.sender, request),
  )
  typedIpcHandle('browser-panel:devtools-update-bounds', async (request, event) => ({
    success: service.updateBounds(event.sender, request.bounds),
  }))
  typedIpcHandle('browser-panel:devtools-close', async (_request, event) => ({
    success: service.close(event.sender),
  }))

  app.on('before-quit', () => service.closeAll())
}
