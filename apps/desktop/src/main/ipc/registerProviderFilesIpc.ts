import { XaiFilesClient } from '@spark/agent-runtime'
import type { ProviderProfile } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

export function registerProviderFilesIpc(dependencies: {
  getProfile: (id: string) => Promise<ProviderProfile | undefined>
  getApiKey: (id: string) => Promise<string>
}): void {
  const clientFor = async (providerProfileId: string): Promise<XaiFilesClient> => {
    const profile = await dependencies.getProfile(providerProfileId)
    if (!profile) throw new SparkError('NOT_FOUND', 'Provider 不存在或已删除')
    if (profile.mediaProvider !== 'xai') {
      throw new SparkError('VALIDATION_FAILED', '文件管理仅支持 xAI Provider')
    }
    const apiKey = await dependencies.getApiKey(providerProfileId)
    if (!apiKey) throw new SparkError('PROVIDER_AUTH_FAILED', 'xAI API Key 未配置')
    return new XaiFilesClient({
      apiKey,
      apiEndpoint: profile.apiEndpoint ?? 'https://api.x.ai/v1',
    })
  }

  typedIpcHandle('provider:files:list', async (request) => {
    const page = await (await clientFor(request.providerProfileId)).list({
      limit: request.limit ?? 50,
      order: request.order ?? 'desc',
      sortBy: request.sortBy ?? 'created_at',
      ...(request.paginationToken ? { paginationToken: request.paginationToken } : {}),
    })
    return {
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

  typedIpcHandle('provider:files:delete', async (request) =>
    (await clientFor(request.providerProfileId)).delete(request.fileId),
  )
}
