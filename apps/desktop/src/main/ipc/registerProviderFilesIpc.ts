import {
  BailianFilesClient,
  MinimaxHailuoFilesClient,
  VolcengineArkFilesClient,
  XaiFilesClient,
  type MinimaxFileObject,
} from '@spark/agent-runtime'
import type { ProviderFileObject, ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { typedIpcHandle } from './typed-ipc.js'

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
  const hostname = endpointHostname(profile.apiEndpoint)
  if (hostname === 'api.x.ai') return 'xai'
  if (hostname === 'ark.cn-beijing.volces.com') return 'volcengine-ark'
  if (hostname === 'dashscope.aliyuncs.com') return 'bailian'
  if (hostname === 'api.minimaxi.com') return 'minimax-hailuo'
  return null
}

function endpointHostname(endpoint: string | undefined): string | null {
  if (!endpoint?.trim()) return null
  try {
    return new URL(endpoint).hostname.toLowerCase()
  } catch {
    return null
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

  typedIpcHandle('provider:files:get', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    if (resolved.kind === 'xai') {
      throw new SparkError('VALIDATION_FAILED', '当前渠道尚未开放单文件查询')
    }
    if (resolved.kind === 'minimax-hailuo') {
      const minimaxFile = await resolved.client.retrieve(request.fileId)
      return { providerKind: 'minimax-hailuo', file: toMinimaxProviderFile(minimaxFile) }
    }
    return { providerKind: resolved.kind, file: await resolved.client.get(request.fileId) }
  })

  typedIpcHandle('provider:files:upload', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
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

  typedIpcHandle('provider:files:delete', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    if (resolved.kind === 'minimax-hailuo') {
      await resolved.client.delete({ fileId: request.fileId, purpose: MINIMAX_DELETE_PURPOSE })
      return { deleted: true, id: request.fileId }
    }
    return resolved.client.delete(request.fileId)
  })
}
