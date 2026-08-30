import { app } from 'electron'
import { typedIpcHandle } from './typed-ipc.js'
import { savePastedTextToUserData } from './pastedTextStorage.js'

/** 注册会话粘贴文本的应用级持久化 IPC。 */
export function registerPastedTextIpc(): void {
  typedIpcHandle('file:save-pasted-text', async (request) =>
    savePastedTextToUserData(app.getPath('userData'), request),
  )
}
