import type { IpcMainInvokeEvent } from 'electron'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { SubAppBackend } from './subAppBackend.js'

export interface RegisterSubAppIpcOptions {
  backend?: SubAppBackend
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

export function registerSubAppIpc(options: RegisterSubAppIpcOptions = {}): void {
  const backend = options.backend ?? new SubAppBackend(getDatabase())
  const authorize =
    options.authorizeRenderer ??
    ((event: IpcMainInvokeEvent) => {
      const window = getMainWindow()
      return window != null && !window.isDestroyed() && event.sender === window.webContents
    })
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    if (!authorize(event)) {
      throw new SparkError('PERMISSION_DENIED', '子应用管理接口仅允许主应用窗口访问。')
    }
  }

  typedIpcHandle('sub-app:list', async (request, event) => {
    assertTrusted(event)
    return backend.list(request)
  })
  typedIpcHandle('sub-app:get', async (request, event) => {
    assertTrusted(event)
    return backend.get(request)
  })
  typedIpcHandle('sub-app:create', async (request, event) => {
    assertTrusted(event)
    return backend.create(request)
  })
  typedIpcHandle('sub-app:update-draft', async (request, event) => {
    assertTrusted(event)
    return backend.updateDraft(request)
  })
  typedIpcHandle('sub-app:publish', async (request, event) => {
    assertTrusted(event)
    return backend.publish(request)
  })
  typedIpcHandle('sub-app:set-enabled', async (request, event) => {
    assertTrusted(event)
    return backend.setEnabled(request)
  })
  typedIpcHandle('sub-app:archive', async (request, event) => {
    assertTrusted(event)
    return backend.archive(request)
  })
  typedIpcHandle('sub-app:rollback', async (request, event) => {
    assertTrusted(event)
    return backend.rollback(request)
  })
  typedIpcHandle('sub-app:releases:list', async (request, event) => {
    assertTrusted(event)
    return backend.listReleases(request)
  })
  typedIpcHandle('sub-app:delete', async (request, event) => {
    assertTrusted(event)
    return backend.delete(request)
  })
  typedIpcHandle('sub-app:data:get', async (request, event) => {
    assertTrusted(event)
    return backend.dataGet(request)
  })
  typedIpcHandle('sub-app:data:list', async (request, event) => {
    assertTrusted(event)
    return backend.dataList(request)
  })
  typedIpcHandle('sub-app:data:upsert', async (request, event) => {
    assertTrusted(event)
    return backend.dataUpsert(request)
  })
  typedIpcHandle('sub-app:data:delete', async (request, event) => {
    assertTrusted(event)
    return backend.dataDelete(request)
  })
}
