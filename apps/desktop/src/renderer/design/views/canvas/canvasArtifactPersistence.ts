/**
 * 画布本地产物的项目目录持久化
 *
 * 背景：本地 ffmpeg 类任务（深度视频转换、尺寸压缩、音频截取/变速等）的产物
 * 固定落在全局产物目录（{userData}/.spark-artifacts/media/…），而云端产物
 * （Hailuo 等）由下载链路直接写进项目 assets/ 目录——导致项目目录里找不到
 * 本地任务产物，违背「画布工程产物都在项目目录下」的既定语义。
 *
 * 本模块把「复制进项目目录」收敛为一个幂等辅助函数：
 *  - 复用主进程 canvas:asset:copy-to-project（源已在项目内时自动跳过）；
 *  - 失败降级返回 null，调用方继续用原路径，不阻断物化/任务完成。
 */
import type { CanvasAssetCopyToProjectResponse } from '@spark/protocol'

export type CanvasLocalArtifactKind = 'image' | 'audio' | 'video' | 'file'

/**
 * 把本地产物文件复制进画布项目目录（assets/<kind>/），返回项目内绝对路径。
 *
 * @returns 项目内路径；源已在项目内时返回源路径本身（幂等）；失败返回 null。
 */
export async function copyLocalArtifactIntoProject(input: {
  projectId: string
  sourcePath: string
  type: CanvasLocalArtifactKind
  /** 产物友好名（作为文件名前缀）；空值时主进程回退用源文件名 */
  suggestedBaseName?: string
  projectRootPath?: string | null
}): Promise<string | null> {
  try {
    const res: CanvasAssetCopyToProjectResponse = await window.spark.invoke(
      'canvas:asset:copy-to-project',
      {
        projectId: input.projectId,
        ...(input.projectRootPath ? { projectRootPath: input.projectRootPath } : {}),
        sourcePath: input.sourcePath,
        ...(input.suggestedBaseName ? { suggestedBaseName: input.suggestedBaseName } : {}),
        type: input.type,
      },
    )
    if (res.error || !res.filePath) {
      console.warn('[canvas-artifact] copy into project failed:', res.error)
      return null
    }
    return res.filePath
  } catch (err) {
    console.warn('[canvas-artifact] copy into project failed:', err)
    return null
  }
}
