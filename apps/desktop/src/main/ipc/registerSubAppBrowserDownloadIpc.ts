import { app, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { isDownloadsPreviewMediaPath, toSafeFileUrl } from '../services/SafeFileProtocol.js'
import { typedIpcHandle } from './typed-ipc.js'

function isInsideDownloads(filePath: string): boolean {
  const downloadsDir = path.resolve(app.getPath('downloads'))
  const targetPath = path.resolve(filePath)
  const relative = path.relative(downloadsDir, targetPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function registerSubAppBrowserDownloadIpc(): void {
  typedIpcHandle('browser:sub-app-reveal-download', async (request) => {
    const resolved = path.resolve(request.filePath)
    if (!isInsideDownloads(resolved)) {
      return { revealed: false, error: '只能在系统 Downloads 目录中定位已下载文件。' }
    }
    shell.showItemInFolder(resolved)
    return { revealed: true }
  })

  typedIpcHandle('browser:sub-app-preview-download', async (request) => {
    const resolved = path.resolve(request.filePath)
    if (!isInsideDownloads(resolved)) {
      return { error: '只能预览系统 Downloads 目录中的已下载文件。' }
    }
    if (!existsSync(resolved)) {
      return { error: '文件不存在，可能已被移动或删除。' }
    }
    if (!isDownloadsPreviewMediaPath(resolved)) {
      return { error: '该文件类型不支持站内预览，请使用“打开查看”。' }
    }
    return { url: toSafeFileUrl(resolved) }
  })
}
