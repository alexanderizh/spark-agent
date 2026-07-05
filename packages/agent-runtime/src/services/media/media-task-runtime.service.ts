/**
 * @module media-task-runtime.service
 *
 * 多媒体任务生命周期 facade。
 *
 * Phase 2 首版把现有 MediaRouterService.invoke 包成 submit/inquire/cancel/materialize
 * 四段接口，并把每次调用持久化为 media_generation_tasks。后续可以把 submit 改为
 * 真正后台 runner，而调用方协议不需要变化。
 */

import type {
  MediaGenerationTaskRepository,
  MediaGenerationTaskRow,
  MediaGenerationTaskStatus,
} from '@spark/storage'
import type { MediaCapabilityId, MediaRequestCall } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'
import type {
  MediaGeneratedAsset,
  MediaGenerateInput,
  MediaGenerateOutput,
} from './media-adapter.types.js'
import { MediaRouterService } from './media-router.service.js'
import type { InvokeOptions, MediaProviderProfile } from './media-router.service.js'

const log = createLogger('canvas:media-task-runtime')

export interface MediaTaskRecord {
  id: string
  providerProfileId: string | null
  providerKind: string | null
  manifestId: string | null
  modelId: string | null
  operation: string
  capability: string | null
  status: MediaGenerationTaskStatus
  mode: 'sync' | 'async' | null
  prompt: string | null
  negativePrompt: string | null
  inputFiles: MediaGenerateInput['inputFiles']
  modelParams: Record<string, unknown>
  outputDir: string
  requestId: string | null
  assets: MediaGeneratedAsset[]
  rawResponse: unknown
  /** 实际发给 provider 的请求摘要（method + url + 已截断 body），来自 router 的 fetch 捕获。 */
  requestCall: MediaRequestCall | null
  error: { code: string; message: string } | null
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  completedAt: string | null
}

export interface MediaTaskSubmitOptions {
  providers: MediaProviderProfile[]
  providerProfileId?: string | null
  manifestId?: string | null
  modelId?: string | null
  capability?: MediaCapabilityId
  extraParams?: Record<string, unknown>
  fetch?: typeof fetch
}

export interface MediaTaskRouterLike {
  invoke(input: MediaGenerateInput, options: InvokeOptions): Promise<{
    output: MediaGenerateOutput
    providerProfileId: string
  }>
}

export type MediaTaskUpdateHandler = (record: MediaTaskRecord) => void | Promise<void>

export class MediaTaskRuntimeService {
  constructor(
    private readonly repo: MediaGenerationTaskRepository,
    private readonly router: MediaTaskRouterLike = new MediaRouterService(),
  ) {
    this.repo.ensureSchema()
  }

  async submit(input: MediaGenerateInput, options: MediaTaskSubmitOptions): Promise<MediaTaskRecord> {
    const row = this.createRunningTask(input, options)
    log.info(
      `media task submitted (sync): id=${row.id} op=${row.operation} provider=${row.provider_profile_id ?? '(none)'} model=${row.model_id ?? '(auto)'}`,
    )
    return this.execute(row, input, options)
  }

  submitBackground(
    input: MediaGenerateInput,
    options: MediaTaskSubmitOptions,
    onUpdate?: MediaTaskUpdateHandler,
  ): MediaTaskRecord {
    const row = this.createRunningTask(input, options)
    const started = rowToRecord(row)
    log.info(
      `media task submitted (background): id=${row.id} op=${row.operation} provider=${row.provider_profile_id ?? '(none)'} model=${row.model_id ?? '(auto)'}`,
    )
    void Promise.resolve(onUpdate?.(started)).catch(() => {})
    queueMicrotask(() => {
      void this.execute(row, input, options)
        .then((record) => {
          log.info(
            `media task finished (background): id=${record.id} op=${record.operation} status=${record.status}`,
          )
          return onUpdate?.(record)
        })
        .catch((err) => {
          log.warn(
            `media task callback failed after execute (background): id=${row.id} err=${err instanceof Error ? err.message : String(err)}`,
          )
        })
    })
    return started
  }

  private createRunningTask(input: MediaGenerateInput, options: MediaTaskSubmitOptions): MediaGenerationTaskRow {
    const submittedAt = new Date().toISOString()
    return this.repo.create({
      providerProfileId: options.providerProfileId ?? null,
      manifestId: options.manifestId ?? null,
      operation: input.operation,
      capability: options.capability ?? input.capability ?? null,
      status: 'running',
      prompt: input.prompt ?? null,
      negativePrompt: input.negativePrompt ?? null,
      inputFilesJson: JSON.stringify(input.inputFiles ?? []),
      modelParamsJson: JSON.stringify(input.modelParams ?? {}),
      outputDir: input.outputDir,
      submittedAt,
    })
  }

  private async execute(
    row: MediaGenerationTaskRow,
    input: MediaGenerateInput,
    options: MediaTaskSubmitOptions,
  ): Promise<MediaTaskRecord> {
    try {
      const invokeOptions: InvokeOptions = {
        providers: options.providers,
        ...(options.providerProfileId !== undefined ? { providerProfileId: options.providerProfileId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
        ...(options.manifestId !== undefined ? { manifestId: options.manifestId } : {}),
        ...(options.capability !== undefined ? { capability: options.capability } : {}),
        ...(options.extraParams !== undefined ? { extraParams: options.extraParams } : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      }
      const { output, providerProfileId } = await this.router.invoke(input, invokeOptions)
      const latest = this.repo.getById(row.id)
      if (latest?.status === 'cancelled') {
        log.info(`media task cancelled during execute: id=${row.id} op=${row.operation}`)
        return rowToRecord(latest)
      }
      const completed = this.repo.update(row.id, {
        providerProfileId,
        providerKind: output.provider,
        modelId: output.model,
        status: 'succeeded',
        mode: output.mode,
        requestId: output.requestId ?? null,
        assetsJson: JSON.stringify(output.assets),
        rawResponseJson: output.rawResponse === undefined ? null : JSON.stringify(output.rawResponse),
        completedAt: new Date().toISOString(),
      })
      const record = rowToRecord(completed ?? this.repo.getById(row.id) ?? row)
      // requestCall 仅存在于内存的 router output 中（不落 media_generation_tasks 表），
      // 在此处挂到 record 上，经 IPC 传给画布任务，由画布快照负责持久化。
      record.requestCall = output.requestCall ?? null
      log.info(
        `media task succeeded: id=${record.id} op=${record.operation} provider=${providerProfileId} model=${output.model} assets=${output.assets.length}`,
      )
      return record
    } catch (err) {
      const latest = this.repo.getById(row.id)
      if (latest?.status === 'cancelled') {
        log.info(`media task cancelled during execute (err path): id=${row.id} op=${row.operation}`)
        return rowToRecord(latest)
      }
      const code = err instanceof MediaProviderError ? err.code : 'provider_http_error'
      const message = err instanceof Error ? err.message : String(err)
      const failed = this.repo.update(row.id, {
        status: 'failed',
        errorCode: code,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      })
      const record = rowToRecord(failed ?? this.repo.getById(row.id) ?? row)
      // 失败任务也带上请求摘要（router 已挂到 error 上），方便在详情里排查 422/参数错误。
      record.requestCall = err instanceof MediaProviderError ? err.requestCall ?? null : null
      log.warn(
        `media task failed: id=${record.id} op=${record.operation} code=${code} msg=${message}`,
      )
      return record
    }
  }

  inquire(taskId: string): MediaTaskRecord | null {
    const row = this.repo.getById(taskId)
    if (!row) {
      log.warn(`media task inquire miss: id=${taskId}`)
      return null
    }
    return rowToRecord(row)
  }

  cancel(taskId: string): MediaTaskRecord | null {
    const row = this.repo.cancel(taskId)
    if (!row) {
      log.warn(`media task cancel miss: id=${taskId}`)
      return null
    }
    const wasAlreadyTerminal = row.status === 'cancelled' || row.status === 'failed' || row.status === 'succeeded'
    log.info(
      `media task cancel: id=${row.id} status=${row.status}${wasAlreadyTerminal ? ' (already terminal)' : ''}`,
    )
    return rowToRecord(row)
  }

  materialize(taskId: string): MediaGeneratedAsset[] | null {
    const row = this.repo.getById(taskId)
    if (!row || row.status !== 'succeeded') {
      log.warn(
        `media task materialize miss: id=${taskId} status=${row?.status ?? 'not_found'}`,
      )
      return null
    }
    const assets = parseJson(row.assets_json, []) as MediaGeneratedAsset[]
    log.info(
      `media task materialize: id=${taskId} assets=${assets.length}`,
    )
    return assets
  }
}

function rowToRecord(row: MediaGenerationTaskRow): MediaTaskRecord {
  return {
    id: row.id,
    providerProfileId: row.provider_profile_id,
    providerKind: row.provider_kind,
    manifestId: row.manifest_id,
    modelId: row.model_id,
    operation: row.operation,
    capability: row.capability,
    status: row.status,
    mode: row.mode === 'sync' || row.mode === 'async' ? row.mode : null,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    inputFiles: parseJson(row.input_files_json, []),
    modelParams: parseJson(row.model_params_json, {}),
    outputDir: row.output_dir,
    requestId: row.request_id,
    assets: parseJson(row.assets_json, []),
    rawResponse: parseJson(row.raw_response_json, null),
    // requestCall 不落 DB，仅由 execute() 从内存 output 挂载；rowToRecord 给 null 兜底。
    requestCall: null,
    error: row.error_code || row.error_message
      ? { code: row.error_code ?? 'unknown', message: row.error_message ?? 'Unknown media task error' }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
  }
}

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (json == null || json.length === 0) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
