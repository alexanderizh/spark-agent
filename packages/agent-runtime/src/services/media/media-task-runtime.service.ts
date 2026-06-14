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
import type { MediaCapabilityId } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'
import type {
  MediaGeneratedAsset,
  MediaGenerateInput,
  MediaGenerateOutput,
} from './media-adapter.types.js'
import { MediaRouterService } from './media-router.service.js'
import type { InvokeOptions, MediaProviderProfile } from './media-router.service.js'

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
    return this.execute(row, input, options)
  }

  submitBackground(
    input: MediaGenerateInput,
    options: MediaTaskSubmitOptions,
    onUpdate?: MediaTaskUpdateHandler,
  ): MediaTaskRecord {
    const row = this.createRunningTask(input, options)
    const started = rowToRecord(row)
    void Promise.resolve(onUpdate?.(started)).catch(() => {})
    queueMicrotask(() => {
      void this.execute(row, input, options)
        .then((record) => onUpdate?.(record))
        .catch(() => {})
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
        ...(options.capability !== undefined ? { capability: options.capability } : {}),
        ...(options.extraParams !== undefined ? { extraParams: options.extraParams } : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      }
      const { output, providerProfileId } = await this.router.invoke(input, invokeOptions)
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
      return rowToRecord(completed ?? this.repo.getById(row.id) ?? row)
    } catch (err) {
      const code = err instanceof MediaProviderError ? err.code : 'provider_http_error'
      const message = err instanceof Error ? err.message : String(err)
      const failed = this.repo.update(row.id, {
        status: 'failed',
        errorCode: code,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      })
      return rowToRecord(failed ?? this.repo.getById(row.id) ?? row)
    }
  }

  inquire(taskId: string): MediaTaskRecord | null {
    const row = this.repo.getById(taskId)
    return row ? rowToRecord(row) : null
  }

  cancel(taskId: string): MediaTaskRecord | null {
    const row = this.repo.cancel(taskId)
    return row ? rowToRecord(row) : null
  }

  materialize(taskId: string): MediaGeneratedAsset[] | null {
    const row = this.repo.getById(taskId)
    if (!row || row.status !== 'succeeded') return null
    return parseJson(row.assets_json, []) as MediaGeneratedAsset[]
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
