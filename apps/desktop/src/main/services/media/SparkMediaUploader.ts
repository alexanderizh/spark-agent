import type { MediaUploadInput, MediaUploadResult, MediaUploader } from '@spark/agent-runtime'
import type { MediaProviderKind } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { getAuthService } from '../Auth/AuthService.js'

export class SparkMediaUploader implements MediaUploader {
  canHandle(provider: MediaProviderKind): boolean {
    // 仅覆盖无官方 Files API、且 input resolver 直接查询 fallbackUploader 的渠道：
    //   xai / volcengine-ark / bailian / apimart（各自的 *-media-input 均查询 canHandle）。
    // 不含 minimax-hailuo：它走独立 MinimaxHailuoFilesClient，从不查询 fallbackUploader，开启即死代码。
    // 不含 tencent-tokenhub：开启会把原本免登录的本地图片(base64 inline)切到强制登录的平台上传，
    //   且 uploadPublicUrl 失败直接 throw 不回退 base64，构成登录回归（tencent 亦不支持参考视频/音频）。
    return (
      provider === 'xai' ||
      provider === 'volcengine-ark' ||
      provider === 'bailian' ||
      provider === 'apimart'
    )
  }

  async upload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const auth = getAuthService()
    if (!auth.getCurrentUserId()) {
      throw new SparkError('PROVIDER_AUTH_FAILED', 'Spark 平台文件上传需要先登录或注册')
    }
    // 优先 filePath 直传（主进程 readFile 后 multipart），避免大视频 base64 膨胀；
    // adapter 仅传 buffer 时退回 buffer→dataUrl 路径。
    const uploaded = await auth.uploadFile(
      input.filePath
        ? {
            filePath: input.filePath,
            fileName: input.filename,
            ...(input.mimeType ? { mimeType: input.mimeType } : {}),
          }
        : {
            dataUrl: `data:${input.mimeType ?? 'application/octet-stream'};base64,${input.buffer.toString('base64')}`,
            fileName: input.filename,
            ...(input.mimeType ? { mimeType: input.mimeType } : {}),
          },
    )
    return {
      provider: input.targetProvider ?? 'xai',
      publicUrl: uploaded.aiUrl,
      url: uploaded.aiUrl,
    }
  }
}

export const sparkMediaUploader = new SparkMediaUploader()
