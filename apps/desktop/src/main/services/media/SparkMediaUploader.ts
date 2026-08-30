import type { MediaUploadInput, MediaUploadResult, MediaUploader } from '@spark/agent-runtime'
import { lookupMediaTransferCache, recordMediaTransferCache } from '@spark/agent-runtime'
import type { MediaProviderKind } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { getAuthService } from '../Auth/AuthService.js'

/** 临时中转用途标识：客户端据此以 ?tmp=1 上传，文件落服务端临时桶（Lifecycle 定期清理）。 */
const MEDIA_TRANSFER_PURPOSE = 'media-transfer'
/** 本地引用缓存 TTL 6 天：需短于服务端临时桶保留期（默认 15 天），保证命中条目始终有效。 */
const SPARK_TRANSFER_CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000

export class SparkMediaUploader implements MediaUploader {
  canHandle(provider: MediaProviderKind): boolean {
    // 覆盖无官方 Files API、且 input resolver 直接查询 fallbackUploader 的渠道：
    //   xai / volcengine-ark / bailian / apimart（各自的 *-media-input 均查询 canHandle）。
    // minimax-hailuo：resolver 仅在「官方 mm_file 上传失败后」才查询 fallbackUploader 做回退，
    //   官方成功路径不受影响（与 tencent 的「主路径切换」性质不同），故放行。
    // 不含 tencent-tokenhub：开启会把原本免登录的本地图片(base64 inline)切到强制登录的平台上传，
    //   且 uploadPublicUrl 失败直接 throw 不回退 base64，构成登录回归（tencent 亦不支持参考视频/音频）。
    return (
      provider === 'xai' ||
      provider === 'volcengine-ark' ||
      provider === 'bailian' ||
      provider === 'apimart' ||
      provider === 'minimax-hailuo'
    )
  }

  async upload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const auth = getAuthService()
    const userId = auth.getCurrentUserId()
    if (!userId) {
      throw new SparkError('PROVIDER_AUTH_FAILED', 'Spark 平台文件上传需要先登录或注册')
    }

    // 同一份素材（画布资源节点）被多个下游任务复用时，直接复用已上传的公网 URL，
    // 避免每次任务都对 Spark 平台重复上传。缓存按用户隔离；TTL 短于服务端保留期。
    const cacheIdentity = { provider: 'spark', scope: `spark#${userId}` }
    const cacheContent = input.filePath
      ? { filePath: input.filePath }
      : input.buffer
        ? { buffer: input.buffer }
        : {}
    const cached = await lookupMediaTransferCache(cacheIdentity, cacheContent)
    if (cached?.kind === 'url' && /^https?:\/\//i.test(cached.url)) {
      return { provider: input.targetProvider ?? 'xai', publicUrl: cached.url, url: cached.url }
    }

    // 优先 filePath 直传（主进程 readFile 后 multipart），免去 buffer→base64 的 33% 体积膨胀；
    // 注意仍是整读（adapter 与主进程各一次），并非流式。adapter 仅传 buffer 时退回 dataUrl 路径。
    const uploaded = await auth.uploadFile(
      input.filePath
        ? {
            filePath: input.filePath,
            fileName: input.filename,
            ...(input.mimeType ? { mimeType: input.mimeType } : {}),
            purpose: MEDIA_TRANSFER_PURPOSE,
          }
        : {
            dataUrl: `data:${input.mimeType ?? 'application/octet-stream'};base64,${input.buffer.toString('base64')}`,
            fileName: input.filename,
            ...(input.mimeType ? { mimeType: input.mimeType } : {}),
            purpose: MEDIA_TRANSFER_PURPOSE,
          },
    )
    const publicUrl = uploaded.aiUrl
    if (/^https?:\/\//i.test(publicUrl)) {
      await recordMediaTransferCache(
        cacheIdentity,
        cacheContent,
        { kind: 'url', url: publicUrl },
        SPARK_TRANSFER_CACHE_TTL_MS,
      )
    }
    return {
      provider: input.targetProvider ?? 'xai',
      publicUrl,
      url: publicUrl,
    }
  }
}

export const sparkMediaUploader = new SparkMediaUploader()
