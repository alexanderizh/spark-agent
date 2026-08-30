import path from 'node:path'

import type { FileSavePastedImageRequest } from '@spark/protocol'

/**
 * 粘贴图片落盘目录决策（file:save-pasted-image 的存储位置规则）。
 *
 * 无项目根 / 非 canvas 场景必须落在 userData/attachments/pasted-images，
 * 不能使用系统 temp：消息记录长期引用附件绝对路径，历史会话可能在数周后
 * 继续回看（与 pastedTextStorage 的 pasted-texts 同一理由）。早期版本落
 * $TMPDIR/spark-agent-pasted-images，文件被 TempMediaFilesMaintenance 与
 * macOS 周期清理后，消息里的图片全部退化为占位框。
 */
export function resolvePastedImageRootDir(
  request: Pick<FileSavePastedImageRequest, 'projectRootPath' | 'storageScope'>,
  paths: {
    /** app.getPath('userData') */
    userDataPath: string
    /** canvas 媒体默认目录（getDefaultCanvasMediaDir()） */
    canvasMediaDir: string
  },
): string {
  const projectRootPath = request.projectRootPath?.trim()
  if (projectRootPath) {
    return path.join(path.resolve(projectRootPath), 'assets', 'images')
  }
  if (request.storageScope === 'canvas') {
    return paths.canvasMediaDir
  }
  return path.join(paths.userDataPath, 'attachments', 'pasted-images')
}
