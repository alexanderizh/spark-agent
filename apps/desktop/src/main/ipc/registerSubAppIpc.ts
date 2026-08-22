import type { IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import path from 'node:path'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow, sendToMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { SubAppBackend } from './subAppBackend.js'

export interface RegisterSubAppIpcOptions {
  backend?: SubAppBackend
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

export function registerSubAppIpc(options: RegisterSubAppIpcOptions = {}): void {
  const backend =
    options.backend ??
    new SubAppBackend(getDatabase(), path.join(app.getPath('userData'), 'sub-app-files'))
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
  /** 目录变化广播：变更类操作成功后通知 renderer 刷新侧栏菜单与胶囊启动器。
   *  本文件只覆盖渲染进程 IPC 入口（管理页/运行页 UI 操作）；Agent MCP 工具
   *  （spark_app_publish 等）走 platform-bridge 的 subapp.* RPC，由其经
   *  onConfigChanged('sub-app') 在 apps/desktop/src/main/ipc/index.ts 转发为
   *  同一条流，两个入口最终都触发 renderer 的目录刷新事件。 */
  const notifyDirectoryChanged = <T>(result: T): T => {
    const window = getMainWindow()
    if (window != null && !window.isDestroyed()) {
      sendToMainWindow('stream:subapp:directory-changed', {})
    }
    return result
  }

  typedIpcHandle('sub-app:create', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.create(request))
  })
  typedIpcHandle('sub-app:update-draft', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.updateDraft(request))
  })
  typedIpcHandle('sub-app:publish', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.publish(request))
  })
  typedIpcHandle('sub-app:set-enabled', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.setEnabled(request))
  })
  typedIpcHandle('sub-app:archive', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.archive(request))
  })
  typedIpcHandle('sub-app:rollback', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.rollback(request))
  })
  typedIpcHandle('sub-app:releases:list', async (request, event) => {
    assertTrusted(event)
    return backend.listReleases(request)
  })
  typedIpcHandle('sub-app:releases:delete', async (request, event) => {
    assertTrusted(event)
    return backend.deleteRelease(request)
  })
  typedIpcHandle('sub-app:delete', async (request, event) => {
    assertTrusted(event)
    return notifyDirectoryChanged(await backend.delete(request))
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
  typedIpcHandle('sub-app:file:read', async (request, event) => {
    assertTrusted(event)
    return backend.fileRead(request)
  })
  typedIpcHandle('sub-app:file:write', async (request, event) => {
    assertTrusted(event)
    return backend.fileWrite(request)
  })
  typedIpcHandle('sub-app:file:list', async (request, event) => {
    assertTrusted(event)
    return backend.fileList(request)
  })
  typedIpcHandle('sub-app:file:delete', async (request, event) => {
    assertTrusted(event)
    return backend.fileDelete(request)
  })

  typedIpcHandle('sub-app:runtime:put-doc', async (request, event) => {
    assertTrusted(event)
    return backend.putRuntimeDoc(request)
  })

  typedIpcHandle('sub-app:runtime:release-doc', async (request, event) => {
    assertTrusted(event)
    return backend.releaseRuntimeDoc(request)
  })
}
