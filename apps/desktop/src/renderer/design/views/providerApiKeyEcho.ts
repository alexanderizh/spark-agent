import type {
  ProviderGetApiKeyRequest,
  ProviderGetApiKeyResponse,
  ProviderListRequest,
  ProviderListResponse,
  ProviderProfile,
} from '@spark/protocol'

type IpcInvoker<Request, Response> = (request: Request) => Promise<Response>

export interface EditableProviderSnapshot {
  profile: ProviderProfile | undefined
  apiKey: string
  apiKeyError: unknown | null
}

/**
 * 配置与凭据并行读取，但凭据失败不阻断其余配置回显。
 * 明文只作为返回值短暂进入编辑表单状态，不在本模块持久化。
 */
export async function loadEditableProviderSnapshot(
  profileId: string,
  listProviders: IpcInvoker<ProviderListRequest, ProviderListResponse>,
  getProviderApiKey: IpcInvoker<ProviderGetApiKeyRequest, ProviderGetApiKeyResponse>,
): Promise<EditableProviderSnapshot> {
  const [providerResult, apiKeyResult] = await Promise.all([
    listProviders({}),
    getProviderApiKey({ id: profileId }).then(
      ({ apiKey }) => ({ apiKey, error: null }),
      (error: unknown) => ({ apiKey: '', error }),
    ),
  ])

  return {
    profile: providerResult.profiles.find((profile) => profile.id === profileId),
    apiKey: apiKeyResult.apiKey,
    apiKeyError: apiKeyResult.error,
  }
}

/** 已有 Provider 只有在用户实际编辑 Key 后才携带明文；新建时始终携带。 */
export function editableProviderApiKeyPayload(
  profileId: string | null,
  apiKey: string,
  apiKeyDirty: boolean,
): { apiKey?: string } {
  const normalized = apiKey.trim()
  if (!normalized || (profileId && !apiKeyDirty)) return {}
  return { apiKey: normalized }
}
