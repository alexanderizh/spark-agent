import {
  BailianFilesClient,
  type MediaProviderError,
  MinimaxHailuoFilesClient,
  VolcengineArkFilesClient,
  XaiFilesClient,
  type MinimaxFileObject,
} from '@spark/agent-runtime'
import type { ProviderFileObject, ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'
import { type ErrorCode, createLogger, SparkError } from '@spark/shared'
import { readFile, unlink } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { typedIpcHandle } from './typed-ipc.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'

const log = createLogger('ipc:provider-files')

type ProviderFilesClient =
  | { kind: 'xai'; client: XaiFilesClient }
  | { kind: 'volcengine-ark'; client: VolcengineArkFilesClient }
  | { kind: 'bailian'; client: BailianFilesClient }
  | { kind: 'minimax-hailuo'; client: MinimaxHailuoFilesClient }

/** MiniMax 画布 Files tab 固定的 purpose：聚焦 H3 视频素材（来源 files-api.md §2）。 */
const MINIMAX_FILES_PURPOSE = 'video_generation_input' as const
/**
 * delete 接口的 purpose 枚举不含 video_generation_input（与 upload/list 不一致，见 files-api.md §6/§9）。
 * 视频生成素材删除时用 video_generation（delete enum 最接近的值）；此为文档矛盾点的工程处理，需联调确认。
 */
const MINIMAX_DELETE_PURPOSE = 'video_generation' as const

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
}

function mimeFromPath(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

/** MiniMax file 对象 → 通用 ProviderFileObject（id 用 file_id 字符串透传防精度丢失）。 */
export function toMinimaxProviderFile(file: MinimaxFileObject): ProviderFileObject {
  const mimeType = file.filename ? mimeFromPath(file.filename) : undefined
  return {
    id: file.fileId,
    filename: file.filename ?? file.fileId,
    bytes: file.bytes ?? 0,
    createdAt: file.createdAt ?? 0,
    purpose: file.purpose ?? MINIMAX_FILES_PURPOSE,
    object: 'file' as const,
    providerKind: 'minimax-hailuo' as const,
    status: 'active',
    ...(mimeType && mimeType !== 'application/octet-stream' ? { mimeType } : {}),
  }
}

export function resolveProviderFilesApiKind(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): ProviderFilesApiKind | null {
  if (profile.mediaProvider === 'xai') return 'xai'
  if (profile.mediaProvider === 'volcengine-ark') return 'volcengine-ark'
  if (profile.mediaProvider === 'bailian') return 'bailian'
  if (profile.mediaProvider === 'minimax-hailuo') return 'minimax-hailuo'
  // 不再凭 apiEndpoint 域名推断渠道：火山方舟等域名聊天与多媒体共用端点，
  // 仅凭 hostname 会把纯聊天渠道（如「火山 claude」）误判为多媒体渠道。
  return null
}

function resolveFilesErrorCode(error: MediaProviderError): ErrorCode {
  if (error.code === 'invalid_input') return 'VALIDATION_FAILED'
  if (error.code === 'api_key_missing' || error.code === 'auth_required') {
    return 'PROVIDER_AUTH_FAILED'
  }
  if (error.statusCode === 401 || error.statusCode === 403) return 'PROVIDER_AUTH_FAILED'
  if (error.statusCode === 429) return 'PROVIDER_RATE_LIMITED'
  if (error.statusCode === 402) return 'PROVIDER_QUOTA_EXCEEDED'
  return 'PROVIDER_UNAVAILABLE'
}

/**
 * MediaProviderError 跨打包/模块实例时 instanceof 不可靠（vitest 与源码解析到的模块实例可能不同），
 * 用 name 收窄更稳健，同时兼容生产环境。
 */
function isMediaProviderError(error: unknown): error is MediaProviderError {
  return error instanceof Error && error.name === 'MediaProviderError'
}

/**
 * 渠道 Files client 失败抛的是 MediaProviderError（携带真实 HTTP 状态码与归一错误摘要），
 * 但 IPC 公共错误处理只识别 SparkError/ZodError，会把 MediaProviderError 当未知 Error 吞成
 * 「操作未完成，请稍后重试」固定文案，真实原因无从排查。这里统一捕获并转成 SparkError 透传。
 */
export async function runFilesTask<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (isMediaProviderError(error)) {
      // 仅透传真实错误摘要 + HTTP 状态码标记；渠道前缀与 401/403/429 友好归类
      // 统一交给前端 filesErrorMessage 处理，避免与前端兜底叠加成双重前缀。
      throw new SparkError(
        resolveFilesErrorCode(error),
        `${error.message}${error.statusCode ? `（HTTP ${error.statusCode}）` : ''}`,
      )
    }
    throw error
  }
}

export function registerProviderFilesIpc(dependencies: {
  getProfile: (id: string) => Promise<ProviderProfile | undefined>
  getApiKey: (id: string) => Promise<string>
}): void {
  const clientFor = async (providerProfileId: string): Promise<ProviderFilesClient> => {
    const profile = await dependencies.getProfile(providerProfileId)
    if (!profile) throw new SparkError('NOT_FOUND', 'Provider 不存在或已删除')
    const kind = resolveProviderFilesApiKind(profile)
    if (!kind) throw new SparkError('VALIDATION_FAILED', '当前 Provider 不支持 Files API')
    const apiKey = await dependencies.getApiKey(providerProfileId)
    if (!apiKey) throw new SparkError('PROVIDER_AUTH_FAILED', 'Provider API Key 未配置')
    if (kind === 'xai') {
      return {
        kind,
        client: new XaiFilesClient({
          apiKey,
          apiEndpoint: profile.apiEndpoint ?? 'https://api.x.ai/v1',
        }),
      }
    }
    if (kind === 'bailian') {
      return {
        kind,
        client: new BailianFilesClient({
          apiKey,
          ...(profile.apiEndpoint ? { apiEndpoint: profile.apiEndpoint } : {}),
        }),
      }
    }
    if (kind === 'minimax-hailuo') {
      return {
        kind,
        client: new MinimaxHailuoFilesClient({
          apiKey,
          apiEndpoint: profile.apiEndpoint ?? 'https://api.minimaxi.com',
        }),
      }
    }
    return {
      kind,
      client: new VolcengineArkFilesClient({
        apiKey,
        ...(profile.apiEndpoint ? { apiEndpoint: profile.apiEndpoint } : {}),
      }),
    }
  }

  typedIpcHandle('provider:files:list', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runFilesTask(async () => {
      if (resolved.kind === 'volcengine-ark') {
        return resolved.client.list({
          limit: request.limit ?? 100,
          order: request.order ?? 'desc',
          purpose: request.purpose === 'user_data' ? request.purpose : 'user_data',
          ...((request.after ?? request.paginationToken)
            ? { after: request.after ?? request.paginationToken }
            : {}),
          ...(request.scopeId ? { scopeId: request.scopeId } : {}),
        })
      }
      if (resolved.kind === 'bailian') {
        const pageNo = request.paginationToken ? Number(request.paginationToken) : 1
        return resolved.client.list({
          pageNo: Number.isInteger(pageNo) && pageNo > 0 ? pageNo : 1,
          pageSize: request.limit ?? 20,
        })
      }
      if (resolved.kind === 'minimax-hailuo') {
        const files = await resolved.client.list(MINIMAX_FILES_PURPOSE)
        return {
          providerKind: 'minimax-hailuo',
          files: files.map(toMinimaxProviderFile),
        }
      }
      const page = await resolved.client.list({
        limit: request.limit ?? 50,
        order: request.order ?? 'desc',
        sortBy: request.sortBy ?? 'created_at',
        ...(request.paginationToken ? { paginationToken: request.paginationToken } : {}),
      })
      return {
        providerKind: 'xai' as const,
        files: page.data.map((file) => ({
          id: file.id,
          filename: file.filename,
          bytes: file.bytes,
          createdAt: file.created_at,
          ...(file.expires_at !== undefined ? { expiresAt: file.expires_at } : {}),
          purpose: file.purpose,
          object: file.object,
          // xAI Files API 无异步处理概念，list 返回的文件均为立即可用，统一标记为 active。
          status: 'active',
        })),
        ...(page.pagination_token ? { paginationToken: page.pagination_token } : {}),
      }
    })
  })

  typedIpcHandle('provider:files:get', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runFilesTask(async () => {
      if (resolved.kind === 'xai') {
        throw new SparkError('VALIDATION_FAILED', '当前渠道尚未开放单文件查询')
      }
      if (resolved.kind === 'minimax-hailuo') {
        const minimaxFile = await resolved.client.retrieve(request.fileId)
        return { providerKind: 'minimax-hailuo', file: toMinimaxProviderFile(minimaxFile) }
      }
      return { providerKind: resolved.kind, file: await resolved.client.get(request.fileId) }
    })
  })

  typedIpcHandle('provider:files:upload', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runFilesTask(async () => {
      if (resolved.kind === 'xai') {
        throw new SparkError('VALIDATION_FAILED', '当前渠道尚未开放文件上传')
      }
      if (resolved.kind === 'bailian') {
        if (!request.filePath) {
          throw new SparkError(
            'VALIDATION_FAILED',
            '百炼 Files 仅支持上传本地文件，不支持 URL 或 TOS 导入',
          )
        }
        if (
          request.purpose !== 'fine-tune' &&
          request.purpose !== 'file-extract' &&
          request.purpose !== 'batch'
        ) {
          throw new SparkError(
            'VALIDATION_FAILED',
            '百炼 Files 必须选择 fine-tune、file-extract 或 batch purpose',
          )
        }
        const file = await resolved.client.upload({
          filePath: request.filePath,
          purpose: request.purpose,
          ...(request.description ? { description: request.description } : {}),
        })
        return { providerKind: resolved.kind, file }
      }
      if (resolved.kind === 'minimax-hailuo') {
        if (!request.filePath) {
          throw new SparkError(
            'VALIDATION_FAILED',
            'MiniMax Files 仅支持上传本地文件，不支持 URL 导入',
          )
        }
        const buffer = await readFile(request.filePath)
        const minimaxFile = await resolved.client.upload({
          buffer,
          filename: basename(request.filePath),
          mimeType: mimeFromPath(request.filePath),
          purpose: MINIMAX_FILES_PURPOSE,
        })
        return { providerKind: 'minimax-hailuo', file: toMinimaxProviderFile(minimaxFile) }
      }
      const file = await resolved.client.upload({
        ...(request.filePath ? { filePath: request.filePath } : {}),
        ...(request.url ? { url: request.url } : {}),
        purpose: request.purpose === 'user_data' ? request.purpose : 'user_data',
        ...(request.expireAt !== undefined ? { expireAt: request.expireAt } : {}),
        ...(request.tos ? { tos: request.tos } : {}),
        ...(request.preprocessVideo ? { preprocessVideo: request.preprocessVideo } : {}),
        ...(request.waitUntilActive !== undefined
          ? { waitUntilActive: request.waitUntilActive }
          : {}),
      })
      return { providerKind: resolved.kind, file }
    })
  })

  // Provider 文件删除的纯 helper：抽出供 `provider:files:delete` 与
  // `canvas:asset:cleanup-files` 共用，避免重复封装客户端解析与错误转换。
  const deleteProviderFile = async (
    request: { providerProfileId: string; fileId: string },
  ): Promise<{ deleted: true; id: string }> => {
    const resolved = await clientFor(request.providerProfileId)
    return runFilesTask(async () => {
      if (resolved.kind === 'minimax-hailuo') {
        await resolved.client.delete({ fileId: request.fileId, purpose: MINIMAX_DELETE_PURPOSE })
        return { deleted: true as const, id: request.fileId }
      }
      await resolved.client.delete(request.fileId)
      return { deleted: true as const, id: request.fileId }
    })
  }

  typedIpcHandle('provider:files:delete', async (request) => {
    return deleteProviderFile(request)
  })

  /**
   * 画布删除节点 / 删除资源时附带清理源文件：
   *  - providerFiles：远端平台文件，调用各渠道 Files API delete
   *  - localPaths：本地磁盘文件，限定允许路径后 fs.unlink
   *
   * 单个文件删除失败不阻塞其它清理，最终聚合 deleted/failed 列表返回给渲染端。
   * 该通道不抛错，避免数据库行已删除却被主进程错误回滚 UI 状态。
   */
  typedIpcHandle('canvas:asset:cleanup-files', async (request) => {
    const providerFiles = Array.isArray(request?.providerFiles) ? request.providerFiles : []
    const localPaths = Array.isArray(request?.localPaths) ? request.localPaths : []
    const providerDeleted: Array<{ providerProfileId: string; fileId: string }> = []
    const providerFailed: Array<{ providerProfileId: string; fileId: string; error: string }> = []
    const localDeleted: string[] = []
    const localFailed: Array<{ path: string; error: string }> = []

    for (const item of providerFiles) {
      if (!item || typeof item.providerProfileId !== 'string' || typeof item.fileId !== 'string') {
        continue
      }
      try {
        await deleteProviderFile({ providerProfileId: item.providerProfileId, fileId: item.fileId })
        providerDeleted.push({ providerProfileId: item.providerProfileId, fileId: item.fileId })
      } catch (error) {
        providerFailed.push({
          providerProfileId: item.providerProfileId,
          fileId: item.fileId,
          error: error instanceof Error ? error.message : String(error),
        })
        log.warn(
          `canvas:asset:cleanup-files failed to delete provider file ${item.providerProfileId}/${item.fileId}: ${String(error)}`,
        )
      }
    }

    for (const candidate of localPaths) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue
      if (!isSafeFilePathAllowed(candidate)) {
        localFailed.push({ path: candidate, error: 'path not allowed' })
        log.warn(`canvas:asset:cleanup-files refused local path outside safe roots: ${candidate}`)
        continue
      }
      try {
        await unlink(candidate)
        localDeleted.push(candidate)
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        // 文件不存在视为已清理（幂等性），不计入失败列表
        if (err?.code === 'ENOENT') {
          localDeleted.push(candidate)
          continue
        }
        localFailed.push({
          path: candidate,
          error: error instanceof Error ? error.message : String(error),
        })
        log.warn(`canvas:asset:cleanup-files failed to unlink ${candidate}: ${String(error)}`)
      }
    }

    return { providerDeleted, providerFailed, localDeleted, localFailed }
  })
}
