/**
 * 画布图片探测与尺寸压缩 IPC。
 *
 * 图片处理逻辑集中在 imageProcessHandler；这里仅负责注册请求通道并把处理进度
 * 关联到 requestId 后推送给渲染进程。
 */
import { handleImageProcess } from '../services/imageProcessHandler.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

export function registerImageProcessIpc(): void {
  typedIpcHandle('image:process', async (request) => {
    return handleImageProcess(request, (progress) => {
      pushStreamEvent('stream:image:process-progress', {
        requestId: request.requestId,
        percent: progress.percent,
        stage: progress.stage,
      })
    })
  })

  typedIpcHandle('image:probe', async (request) => handleImageProcess(request))
}
