import { MediaTaskRuntimeService, recoverMediaTask } from '@spark/agent-runtime'
import type { MediaTaskPollingDescriptor } from '@spark/agent-runtime'
import type {
  CanvasMediaTaskRepollRequest,
  CanvasMediaTaskRepollResponse,
  ProviderProfile,
} from '@spark/protocol'
import type { MediaTaskRecord } from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'

const log = createLogger('canvas:media-task-recovery')

type Dependencies = {
  getProfile: (id: string) => Promise<ProviderProfile | undefined>
  getApiKey: (id: string) => Promise<string>
  getRuntime: () => MediaTaskRuntimeService
}

/**
 * Restore a persisted provider query loop. The request's canvas identifiers
 * are authorization inputs, never the source of stream routing truth.
 */
export function registerCanvasMediaRepollIpc(dependencies: Dependencies): void {
  typedIpcHandle('canvas:task:repoll-media', async (request) => {
    const runtime = dependencies.getRuntime()
    const record = request.runtimeTaskId
      ? runtime.inquire(request.runtimeTaskId)
      : runtime.inquireByRequestId(request.providerProfileId, request.providerTaskId)
    if (!record) return unavailable('找不到原始媒体 runtime 任务，无法恢复轮询')
    if (!record.projectId || !record.clientTaskId) {
      return unavailable('历史任务没有保存画布归属，已拒绝恢复轮询')
    }
    if (record.projectId !== request.projectId || record.clientTaskId !== request.clientTaskId) {
      return unavailable('画布任务归属不一致，已拒绝恢复轮询')
    }
    if (record.providerProfileId !== request.providerProfileId) {
      return unavailable('Provider Profile 与原始任务不一致，已拒绝恢复轮询')
    }
    if (record.providerTaskId !== request.providerTaskId) {
      return unavailable('Provider Task ID 与原始任务不一致，已拒绝恢复轮询')
    }
    if (record.assets.length > 0) return responseFromRecord(record)
    if (record.status === 'cancelled') return unavailable('原任务已取消，不能重新轮询')
    if (record.status === 'succeeded') return responseFromRecord(record)
    if (record.status === 'running') {
      return responseFromRecord(record, {
        status: 'running',
        message: '该任务已经在轮询中',
        assets: [],
      })
    }
    if (record.status !== 'failed')
      return unavailable(`任务当前状态 ${record.status} 不允许恢复轮询`)

    const profile = await dependencies.getProfile(request.providerProfileId)
    if (!profile) return unavailable('Provider Profile 不存在，无法恢复轮询')
    const descriptor = record.polling ?? legacyPollingDescriptor(record, profile)
    if (!descriptor) return unavailable('该历史任务没有可安全重建的渠道轮询协议')
    if (profile.managedType !== 'newapi' && profile.mediaProvider !== descriptor.providerKind) {
      return unavailable('Provider 类型已变化，无法安全恢复原任务轮询')
    }
    const apiKey = await dependencies.getApiKey(request.providerProfileId)
    if (!apiKey) return unavailable('Provider API Key 不可用，无法恢复轮询')

    const recovery = runtime.beginRecovery(record.id, request.providerTaskId)
    if (!recovery) return unavailable('原始 runtime 任务已不存在，无法恢复轮询')
    if (!recovery.started) {
      if (recovery.record.status === 'cancelled') return unavailable('原任务已取消，不能重新轮询')
      if (recovery.record.assets.length > 0 || recovery.record.status === 'succeeded') {
        return responseFromRecord(recovery.record)
      }
      return responseFromRecord(recovery.record, {
        status: 'running',
        message: '该任务已经在轮询中',
        assets: [],
      })
    }

    const started = recovery.record
    log.info(
      `event=poll-resume-requested projectId=${started.projectId} clientTaskId=${started.clientTaskId} ` +
        `runtimeTaskId=${started.id} providerTaskId=${started.providerTaskId} strategy=${descriptor.strategy}`,
    )
    void runRecovery({
      request,
      record: started,
      descriptor,
      profile,
      apiKey,
      runtime,
    })
    return responseFromRecord(started, {
      status: 'running',
      message: '已重新进入 Provider 任务轮询',
      assets: [],
      provider: descriptor.providerKind,
      model: descriptor.modelId ?? '',
      pollingAvailable: true,
    })
  })
}

async function runRecovery(input: {
  request: CanvasMediaTaskRepollRequest
  record: MediaTaskRecord
  descriptor: MediaTaskPollingDescriptor
  profile: ProviderProfile
  apiKey: string
  runtime: MediaTaskRuntimeService
}): Promise<void> {
  const { request, record, profile, apiKey, runtime } = input
  const shouldContinue = (): boolean => {
    const current = runtime.inquire(record.id)
    return Boolean(
      current &&
      current.status === 'running' &&
      current.providerTaskId === record.providerTaskId &&
      current.projectId === record.projectId &&
      current.clientTaskId === record.clientTaskId,
    )
  }

  const providerTaskId = record.providerTaskId
  if (!providerTaskId) return

  try {
    const result = await recoverMediaTask({
      descriptor: input.descriptor,
      taskId: providerTaskId,
      apiKey,
      ...((profile.mediaApiEndpoint ?? profile.apiEndpoint)
        ? { apiEndpoint: profile.mediaApiEndpoint ?? profile.apiEndpoint }
        : {}),
      input: {
        operation: record.operation as never,
        ...(record.capability ? { capability: record.capability as never } : {}),
        ...(record.prompt != null ? { prompt: record.prompt } : {}),
        ...(record.negativePrompt != null ? { negativePrompt: record.negativePrompt } : {}),
        inputFiles: record.inputFiles as never,
        modelParams: {
          ...record.modelParams,
          ...(readString(record.submitResponse, 'video_id')
            ? { videoId: readString(record.submitResponse, 'video_id') }
            : {}),
        },
        outputDir: record.outputDir,
      },
      shouldContinue,
    })

    if (result.status === 'stopped') return
    if (result.status === 'succeeded') {
      if (!shouldContinue()) return
      const recovered = runtime.markRecovered(record.id, {
        provider: result.provider,
        model: result.model,
        assets: result.assets,
        rawResponse: result.rawResponse,
      })
      if (!recovered || recovered.status !== 'succeeded') return
      log.info(
        `event=poll-resumed runtimeTaskId=${record.id} providerTaskId=${record.providerTaskId} ` +
          `status=succeeded assets=${recovered.assets.length}`,
      )
      emitFinal(request, recovered, {
        status: 'succeeded',
        rawResponse: result.rawResponse,
        pollingAvailable: true,
      })
      return
    }

    if (result.status === 'failed') {
      const failed = runtime.markRecoveryFailed(
        record.id,
        result.error ?? {
          code: 'task_failed',
          message: 'Provider task failed',
        },
      )
      if (!failed || failed.status !== 'failed') return
      log.warn(
        `event=poll-resume-failed runtimeTaskId=${record.id} providerTaskId=${record.providerTaskId} ` +
          `source=provider code=${result.error?.code ?? 'task_failed'}`,
      )
      emitFinal(request, failed, {
        status: 'failed',
        assets: [],
        rawResponse: result.rawResponse,
        ...(result.error ? { error: result.error } : {}),
        pollingAvailable: false,
        repollUnavailableReason: 'Provider 任务已经进入终态，请使用重新提交任务',
      })
    }
  } catch (error) {
    if (!shouldContinue()) return
    const code = isRepollError(error) ? error.code : 'provider_http_error'
    const message = error instanceof Error ? error.message : String(error)
    const failed = runtime.markRecoveryFailed(record.id, { code, message })
    if (!failed || failed.status !== 'failed') return
    log.warn(
      `event=poll-resume-failed runtimeTaskId=${record.id} providerTaskId=${record.providerTaskId} ` +
        `source=local code=${code}`,
    )
    emitFinal(request, failed, {
      status: 'failed',
      assets: [],
      error: { code, message },
      pollingAvailable: true,
    })
  }
}

function legacyPollingDescriptor(
  record: MediaTaskRecord,
  profile: ProviderProfile,
): MediaTaskPollingDescriptor | null {
  const providerKind = record.providerKind ?? profile.mediaProvider
  if (!providerKind) return null
  const strategy: MediaTaskPollingDescriptor['strategy'] | null =
    providerKind === 'omni'
      ? 'google-interactions'
      : providerKind === 'openai-images' && record.operation.includes('video')
        ? 'openai-sora'
        : (
              [
                'apimart',
                'agnes',
                'bailian',
                'google-generative-ai',
                'midjourney',
                'minimax-hailuo',
                'tencent-tokenhub',
                'volcengine-ark',
                'xai',
              ] as string[]
            ).includes(providerKind)
          ? (providerKind as MediaTaskPollingDescriptor['strategy'])
          : null
  if (!strategy) return null
  const outputType: MediaTaskPollingDescriptor['outputType'] = record.operation.includes('video')
    ? 'video'
    : record.operation.includes('audio')
      ? 'audio'
      : record.operation.includes('text')
        ? 'text'
        : 'image'
  return {
    version: 1,
    providerKind,
    strategy,
    capability: record.capability,
    modelId: record.modelId ?? profile.defaultModel ?? null,
    manifestId: record.manifestId,
    outputType,
    manifest: null,
    manifestCapability: null,
    intervalMs: profile.mediaDefaults?.polling?.intervalMs ?? 5_000,
    timeoutMs:
      profile.mediaDefaults?.polling?.timeoutMs ?? (outputType === 'video' ? 1_800_000 : 600_000),
    maxAttempts: null,
  }
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function emitFinal(
  request: CanvasMediaTaskRepollRequest,
  record: MediaTaskRecord,
  overrides: Partial<CanvasMediaTaskRepollResponse>,
): void {
  if (!record.projectId || !record.clientTaskId) return
  pushStreamEvent('stream:canvas:media-task', {
    projectId: record.projectId,
    clientTaskId: record.clientTaskId,
    runtimeTaskId: record.id,
    status: record.status,
    response: responseFromRecord(record, {
      ...overrides,
      requestId: record.providerTaskId ?? record.requestId ?? request.providerTaskId,
      providerTaskId: record.providerTaskId ?? request.providerTaskId,
    }),
  })
}

function responseFromRecord(
  record: MediaTaskRecord,
  overrides: Partial<CanvasMediaTaskRepollResponse> = {},
): CanvasMediaTaskRepollResponse {
  return {
    repoll: true,
    runtimeTaskId: record.id,
    ...(record.requestId ? { requestId: record.requestId } : {}),
    ...(record.providerTaskId ? { providerTaskId: record.providerTaskId } : {}),
    status:
      record.status === 'succeeded'
        ? 'succeeded'
        : record.status === 'cancelled'
          ? 'cancelled'
          : record.status === 'failed'
            ? 'failed'
            : 'running',
    providerProfileId: record.providerProfileId ?? '',
    provider: record.providerKind ?? record.polling?.providerKind ?? '',
    model: record.modelId ?? record.polling?.modelId ?? '',
    mode: record.mode ?? 'async',
    assets: record.assets.map((asset) => ({
      type: asset.type,
      ...(asset.filePath ? { filePath: asset.filePath } : {}),
      ...(asset.url ? { url: asset.url } : {}),
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      ...(asset.width != null ? { width: asset.width } : {}),
      ...(asset.height != null ? { height: asset.height } : {}),
      ...(asset.durationMs != null ? { durationMs: asset.durationMs } : {}),
      ...(asset.contentText ? { contentText: asset.contentText } : {}),
    })),
    pollingAvailable: record.polling != null,
    ...overrides,
  }
}

function unavailable(reason: string): CanvasMediaTaskRepollResponse {
  return {
    repoll: true,
    status: 'failed',
    providerProfileId: '',
    provider: '',
    model: '',
    mode: 'async',
    assets: [],
    pollingAvailable: false,
    repollUnavailableReason: reason,
    error: { code: 'poll_resume_unavailable', message: reason },
  }
}

function isRepollError(error: unknown): error is { code: string } {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string',
  )
}
