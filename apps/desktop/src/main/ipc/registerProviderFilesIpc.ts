import { VolcengineArkFilesClient, XaiFilesClient } from '@spark/agent-runtime'
import type { ProviderFilesApiKind, ProviderProfile } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

type ProviderFilesClient =
  | { kind: 'xai'; client: XaiFilesClient }
  | { kind: 'volcengine-ark'; client: VolcengineArkFilesClient }

export function resolveProviderFilesApiKind(
  profile: Pick<ProviderProfile, 'apiEndpoint' | 'mediaProvider'>,
): ProviderFilesApiKind | null {
  if (profile.mediaProvider === 'xai') return 'xai'
  if (profile.mediaProvider === 'volcengine-ark') return 'volcengine-ark'
  const hostname = endpointHostname(profile.apiEndpoint)
  if (hostname === 'api.x.ai') return 'xai'
  if (hostname === 'ark.cn-beijing.volces.com') return 'volcengine-ark'
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
    return kind === 'xai'
      ? {
          kind,
          client: new XaiFilesClient({
            apiKey,
            apiEndpoint: profile.apiEndpoint ?? 'https://api.x.ai/v1',
          }),
        }
      : {
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
        purpose: request.purpose ?? 'user_data',
        ...((request.after ?? request.paginationToken)
          ? { after: request.after ?? request.paginationToken }
          : {}),
        ...(request.scopeId ? { scopeId: request.scopeId } : {}),
      })
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
      })),
      ...(page.pagination_token ? { paginationToken: page.pagination_token } : {}),
    }
  })

  typedIpcHandle('provider:files:get', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    if (resolved.kind !== 'volcengine-ark') {
      throw new SparkError('VALIDATION_FAILED', '当前渠道尚未开放单文件查询')
    }
    return { providerKind: resolved.kind, file: await resolved.client.get(request.fileId) }
  })

  typedIpcHandle('provider:files:upload', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    if (resolved.kind !== 'volcengine-ark') {
      throw new SparkError('VALIDATION_FAILED', '当前渠道尚未开放文件上传')
    }
    const file = await resolved.client.upload({
      ...(request.filePath ? { filePath: request.filePath } : {}),
      ...(request.url ? { url: request.url } : {}),
      purpose: request.purpose ?? 'user_data',
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
    return resolved.client.delete(request.fileId)
  })
}
