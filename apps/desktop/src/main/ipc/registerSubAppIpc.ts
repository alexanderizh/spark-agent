import type { IpcMainInvokeEvent } from 'electron'
import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow, sendToMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { SubAppBackend } from './subAppBackend.js'
import { computeBodySha256 } from '../services/SubAppShareService.js'
import { cacheSubAppImportBody, takeCachedSubAppImportBody } from './SubAppImportCache.js'
import { registerSubAppBrowserDownloadIpc } from './registerSubAppBrowserDownloadIpc.js'

export interface RegisterSubAppIpcOptions {
  backend?: SubAppBackend
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

/**
 * 导入包在主进程内存的缓存：preview 解析出的 body 留在主进程，renderer 只拿
 * 摘要与 token。有界（条数上限）+ 有淘汰（TTL），不设永久持有路径。
 */
export function registerSubAppIpc(options: RegisterSubAppIpcOptions = {}): void {
  registerSubAppBrowserDownloadIpc()
  const backend =
    options.backend ??
    new SubAppBackend(getDatabase(), path.join(app.getPath('userData'), 'sub-app-files'), {
      platformVersion: app.getVersion(),
      backupsDir: path.join(app.getPath('userData'), 'sub-app-backups'),
    })
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

  // ─── 分享 / 导入（.sparkapp 单文件 JSON）───────────────────────────────────
  // 大包在主进程打包/解析，renderer 只接触摘要；body 经有界 token 缓存留在
  // 主进程内存，apply 凭 token + sha256 取用。

  typedIpcHandle('sub-app:share:export', async (request, event) => {
    assertTrusted(event)
    const packed = await backend.shareExportPackage(request)
    const base = {
      counts: packed.counts,
      capabilities: packed.capabilities,
      secretWarnings: packed.secretWarnings,
    }
    const result = await dialog.showSaveDialog({
      title: '分享导出子应用',
      defaultPath: path.join(app.getPath('downloads'), `${packed.name}.sparkapp`),
      filters: [{ name: 'SparkWork 子应用分享包', extensions: ['sparkapp'] }],
    })
    if (result.canceled || !result.filePath) {
      return { ...base, saved: false, canceled: true }
    }
    try {
      await fs.writeFile(result.filePath, packed.text, 'utf8')
      return { ...base, saved: true, savedPath: result.filePath }
    } catch (err) {
      return { ...base, saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  typedIpcHandle('sub-app:share:import-preview', async (_request, event) => {
    assertTrusted(event)
    const open = await dialog.showOpenDialog({
      title: '导入子应用分享包',
      properties: ['openFile'],
      filters: [
        { name: 'SparkWork 子应用分享包', extensions: ['sparkapp'] },
        { name: 'JSON 文件', extensions: ['json'] },
      ],
    })
    const filePath = open.filePaths[0]
    if (open.canceled || filePath == null) {
      return { started: false, canceled: true, checks: [], conflict: { kind: 'none' } }
    }
    const preview = await backend.sharePreviewFromFile(filePath)
    const summary = {
      formatVersion: preview.body.formatVersion,
      appId: preview.body.appId,
      exportedAt: preview.body.exportedAt,
      platformVersion: preview.body.platformVersion,
      manifest: preview.body.manifest,
      counts: {
        releases: preview.body.releases.length,
        dataEntries: preview.body.data.length,
        files: preview.body.files.length,
        draftChars: preview.body.draft.source.length,
      },
      capabilities: preview.body.capabilities,
    }
    // 完整性失败不发 token：包不可信，只回报告供 UI 展示拦截原因。
    const token = preview.integrityOk
      ? cacheSubAppImportBody(preview.body, computeBodySha256(preview.body))
      : undefined
    return {
      started: true,
      fileName: preview.fileName,
      byteSize: preview.byteSize,
      ...(token != null ? { importToken: token } : {}),
      packageSummary: summary,
      integrityOk: preview.integrityOk,
      checks: preview.checks,
      conflict: preview.conflict,
    }
  })

  typedIpcHandle('sub-app:share:import-apply', async (request, event) => {
    assertTrusted(event)
    const entry = takeCachedSubAppImportBody(request.importToken)
    if (entry == null) {
      throw new SparkError('VALIDATION_FAILED', '导入会话已过期，请重新选择分享包文件。')
    }
    return notifyDirectoryChanged(await backend.shareApply(entry.body, request.mode, entry.sha256))
  })
}
