import type { IpcMainInvokeEvent } from 'electron'
import { SparkError } from '@spark/shared'
import { getMainWindow } from '../windows/index.js'
import {
  putHtmlRenderRuntimeDoc,
  releaseHtmlRenderRuntimeDoc,
} from '../services/HtmlRenderRuntimeDocs.js'
import { typedIpcHandle } from './typed-ipc.js'

/**
 * 内容区 HTML 渲染块的沙箱文档登记 IPC。
 *
 * renderer（RenderHtmlBlock）在文档挂载/重建时 put、卸载时 release，文档经
 * `capability-asset://html-render/<token>` 加载（机制见
 * services/RuntimeDocRegistry.ts）。信任边界与 registerSubAppIpc 一致：
 * 仅允许主应用窗口调用。
 */
export function registerHtmlRuntimeDocIpc(): void {
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    const window = getMainWindow()
    if (!(window != null && !window.isDestroyed() && event.sender === window.webContents)) {
      throw new SparkError('PERMISSION_DENIED', 'HTML 渲染文档接口仅允许主应用窗口访问。')
    }
  }

  typedIpcHandle('html:put-runtime-doc', async (request, event) => {
    assertTrusted(event)
    return putHtmlRenderRuntimeDoc(request)
  })

  typedIpcHandle('html:release-runtime-doc', async (request, event) => {
    assertTrusted(event)
    return releaseHtmlRenderRuntimeDoc(request)
  })
}
