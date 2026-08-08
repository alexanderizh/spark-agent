import {
  BailianVideoTaskClient,
  MinimaxVideoTaskClient,
  VolcengineArkVideoTaskClient,
  type MediaProviderError,
} from '@spark/agent-runtime'
import {
  isVideoChannelTaskQueryableProvider,
  resolveVideoChannelTaskProviderKind,
  type ProviderProfile,
  type VideoChannelTask,
} from '@spark/protocol'
import { type ErrorCode, SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

type Dependencies = {
  getProfile: (id: string) => Promise<ProviderProfile | undefined>
  getApiKey: (id: string) => Promise<string>
}

function isMediaProviderError(error: unknown): error is MediaProviderError {
  return error instanceof Error && error.name === 'MediaProviderError'
}

function resolveVideoTaskErrorCode(error: MediaProviderError): ErrorCode {
  if (error.code === 'invalid_input') return 'VALIDATION_FAILED'
  if (error.code === 'api_key_missing' || error.code === 'auth_required')
    return 'PROVIDER_AUTH_FAILED'
  if (error.statusCode === 401 || error.statusCode === 403) return 'PROVIDER_AUTH_FAILED'
  if (error.statusCode === 429) return 'PROVIDER_RATE_LIMITED'
  return 'PROVIDER_UNAVAILABLE'
}

async function runVideoTask<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (isMediaProviderError(error)) {
      throw new SparkError(
        resolveVideoTaskErrorCode(error),
        `${error.message}${error.statusCode ? `（HTTP ${error.statusCode}）` : ''}`,
      )
    }
    throw error
  }
}

export function registerVideoChannelTaskIpc(dependencies: Dependencies): void {
  const clientFor = async (providerProfileId: string) => {
    const profile = await dependencies.getProfile(providerProfileId)
    if (!profile) throw new SparkError('NOT_FOUND', 'Provider 不存在或已删除')
    if (profile.enabled === false) {
      throw new SparkError('VALIDATION_FAILED', '当前 Provider 已停用')
    }
    const endpoint = profile.mediaApiEndpoint ?? profile.apiEndpoint
    const providerKind = resolveVideoChannelTaskProviderKind(endpoint)
    if (!providerKind) {
      throw new SparkError(
        'VALIDATION_FAILED',
        '当前 Provider Endpoint 不是受支持的官方视频渠道接口',
      )
    }
    if (!isVideoChannelTaskQueryableProvider(profile, endpoint)) {
      throw new SparkError(
        'VALIDATION_FAILED',
        '当前 Provider 暂不支持分页视频任务查询，请选择支持任务列表的官方视频 Provider',
      )
    }
    if (
      profile.modelType !== 'video' &&
      !profile.mediaCapabilities?.some((capability) => capability.startsWith('video.'))
    ) {
      throw new SparkError('VALIDATION_FAILED', '当前 Provider 不是视频渠道配置')
    }
    const apiKey = await dependencies.getApiKey(providerProfileId)
    if (!apiKey) throw new SparkError('PROVIDER_AUTH_FAILED', '当前渠道 API Key 未配置')
    return {
      profile,
      client:
        providerKind === 'volcengine-ark'
          ? new VolcengineArkVideoTaskClient({
              apiKey,
              ...((profile.mediaApiEndpoint ?? profile.apiEndpoint)
                ? { apiEndpoint: profile.mediaApiEndpoint ?? profile.apiEndpoint }
                : {}),
            })
          : providerKind === 'bailian'
            ? new BailianVideoTaskClient({
                apiKey,
                ...((profile.mediaApiEndpoint ?? profile.apiEndpoint)
                  ? { apiEndpoint: profile.mediaApiEndpoint ?? profile.apiEndpoint }
                  : {}),
              })
            : new MinimaxVideoTaskClient({
                apiKey,
                ...((profile.mediaApiEndpoint ?? profile.apiEndpoint)
                  ? { apiEndpoint: profile.mediaApiEndpoint ?? profile.apiEndpoint }
                  : {}),
              }),
    }
  }

  const withProfileName = (task: VideoChannelTask, profile: ProviderProfile): VideoChannelTask => ({
    ...task,
    providerName: profile.name,
  })

  typedIpcHandle('canvas:video-tasks:list', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runVideoTask(async () => {
      const response = await resolved.client.list(request)
      return {
        ...response,
        providerName: resolved.profile.name,
        tasks: response.tasks.map((task) => withProfileName(task, resolved.profile)),
      }
    })
  })

  typedIpcHandle('canvas:video-tasks:get', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runVideoTask(async () => ({
      providerKind: resolved.client.kind,
      task: withProfileName(
        await resolved.client.get(request.taskId, { providerProfileId: request.providerProfileId }),
        resolved.profile,
      ),
    }))
  })

  typedIpcHandle('canvas:video-tasks:delete', async (request) => {
    const resolved = await clientFor(request.providerProfileId)
    return runVideoTask(() => resolved.client.delete(request.taskId, request.providerProfileId))
  })
}
