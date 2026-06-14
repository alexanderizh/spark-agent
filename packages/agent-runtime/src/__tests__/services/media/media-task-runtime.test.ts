import { describe, expect, it } from 'vitest'
import type {
  CreateMediaGenerationTaskParams,
  MediaGenerationTaskRepository,
  MediaGenerationTaskRow,
  UpdateMediaGenerationTaskParams,
} from '@spark/storage'
import { MediaTaskRuntimeService } from '../../../services/media/media-task-runtime.service.js'
import type { MediaTaskRouterLike } from '../../../services/media/media-task-runtime.service.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'

describe('MediaTaskRuntimeService', () => {
  it('persists a succeeded submit result and materializes assets', async () => {
    const repo = createRepo()
    const router: MediaTaskRouterLike = {
      async invoke() {
        return {
          providerProfileId: 'provider-1',
          output: {
            provider: 'apimart',
            model: 'gpt-image-2',
            mode: 'sync',
            requestId: 'req-1',
            assets: [{ type: 'image', filePath: '/tmp/out.png', mimeType: 'image/png' }],
            rawResponse: { id: 'req-1' },
          },
        }
      },
    }
    const service = new MediaTaskRuntimeService(repo, router)

    const record = await service.submit(
      { operation: 'text_to_image', prompt: 'hello', outputDir: '/tmp/media' },
      { providers: [], providerProfileId: 'provider-1' },
    )

    expect(record.status).toBe('succeeded')
    expect(record.providerKind).toBe('apimart')
    expect(record.modelId).toBe('gpt-image-2')
    expect(service.inquire(record.id)?.requestId).toBe('req-1')
    expect(service.materialize(record.id)?.[0]?.filePath).toBe('/tmp/out.png')
  })

  it('persists provider errors as failed tasks', async () => {
    const service = new MediaTaskRuntimeService(createRepo(), {
      async invoke() {
        throw new MediaProviderError('task_timeout', 'Timed out')
      },
    })

    const record = await service.submit(
      { operation: 'text_to_video', prompt: 'hello', outputDir: '/tmp/media' },
      { providers: [] },
    )

    expect(record.status).toBe('failed')
    expect(record.error).toMatchObject({ code: 'task_timeout', message: 'Timed out' })
    expect(service.materialize(record.id)).toBeNull()
  })

  it('returns immediately for background submit and emits completion updates', async () => {
    const service = new MediaTaskRuntimeService(createRepo(), {
      async invoke() {
        return {
          providerProfileId: 'provider-1',
          output: {
            provider: 'apimart',
            model: 'gpt-image-2',
            mode: 'sync',
            requestId: 'req-bg',
            assets: [{ type: 'image', filePath: '/tmp/bg.png', mimeType: 'image/png' }],
          },
        }
      },
    })
    const statuses: string[] = []
    const completed = new Promise<void>((resolve) => {
      service.submitBackground(
        { operation: 'text_to_image', prompt: 'hello', outputDir: '/tmp/media' },
        { providers: [], providerProfileId: 'provider-1' },
        (record) => {
          statuses.push(record.status)
          if (record.status === 'succeeded') resolve()
        },
      )
    })

    const running = service.inquire('media-task-1')
    expect(running?.status).toBe('running')

    await completed

    expect(statuses).toEqual(['running', 'succeeded'])
    expect(service.inquire('media-task-1')?.requestId).toBe('req-bg')
  })

  it('cancels pending or running tasks', () => {
    const repo = createRepo()
    const row = repo.create({
      operation: 'text_to_image',
      status: 'running',
      outputDir: '/tmp/media',
      submittedAt: new Date().toISOString(),
    })
    const service = new MediaTaskRuntimeService(repo, {
      async invoke() {
        throw new Error('not used')
      },
    })

    const cancelled = service.cancel(row.id)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.completedAt).toBeTruthy()
  })

  it('keeps background tasks cancelled when provider completes later', async () => {
    const repo = createRepo()
    let finishProvider!: () => void
    const providerDone = new Promise<void>((resolve) => {
      finishProvider = resolve
    })
    const service = new MediaTaskRuntimeService(repo, {
      async invoke() {
        await providerDone
        return {
          providerProfileId: 'provider-1',
          output: {
            provider: 'apimart',
            model: 'gpt-image-2',
            mode: 'sync',
            requestId: 'req-late',
            assets: [{ type: 'image', filePath: '/tmp/late.png', mimeType: 'image/png' }],
          },
        }
      },
    })
    const statuses: string[] = []
    const completed = new Promise<void>((resolve) => {
      service.submitBackground(
        { operation: 'text_to_image', prompt: 'hello', outputDir: '/tmp/media' },
        { providers: [], providerProfileId: 'provider-1' },
        (record) => {
          statuses.push(record.status)
          if (record.status === 'cancelled') resolve()
        },
      )
    })

    expect(service.cancel('media-task-1')?.status).toBe('cancelled')
    finishProvider()
    await completed

    expect(statuses).toEqual(['running', 'cancelled'])
    expect(service.inquire('media-task-1')?.status).toBe('cancelled')
    expect(service.materialize('media-task-1')).toBeNull()
  })
})

function createRepo(): MediaGenerationTaskRepository {
  const rows = new Map<string, MediaGenerationTaskRow>()
  let seq = 0
  const now = () => new Date().toISOString()

  const repo = {
    ensureSchema(): void {},
    create(params: CreateMediaGenerationTaskParams): MediaGenerationTaskRow {
      const timestamp = now()
      const row: MediaGenerationTaskRow = {
        id: params.id ?? `media-task-${++seq}`,
        provider_profile_id: params.providerProfileId ?? null,
        provider_kind: params.providerKind ?? null,
        manifest_id: params.manifestId ?? null,
        model_id: params.modelId ?? null,
        operation: params.operation,
        capability: params.capability ?? null,
        status: params.status ?? 'pending',
        mode: params.mode ?? null,
        prompt: params.prompt ?? null,
        negative_prompt: params.negativePrompt ?? null,
        input_files_json: params.inputFilesJson ?? '[]',
        model_params_json: params.modelParamsJson ?? '{}',
        output_dir: params.outputDir,
        request_id: params.requestId ?? null,
        assets_json: params.assetsJson ?? '[]',
        raw_response_json: params.rawResponseJson ?? null,
        error_code: params.errorCode ?? null,
        error_message: params.errorMessage ?? null,
        created_at: timestamp,
        updated_at: timestamp,
        submitted_at: params.submittedAt ?? null,
        completed_at: params.completedAt ?? null,
      }
      rows.set(row.id, row)
      return row
    },
    getById(id: string): MediaGenerationTaskRow | null {
      return rows.get(id) ?? null
    },
    update(id: string, params: UpdateMediaGenerationTaskParams): MediaGenerationTaskRow | null {
      const existing = rows.get(id)
      if (!existing) return null
      const row: MediaGenerationTaskRow = {
        ...existing,
        provider_profile_id: params.providerProfileId !== undefined ? params.providerProfileId : existing.provider_profile_id,
        provider_kind: params.providerKind !== undefined ? params.providerKind : existing.provider_kind,
        manifest_id: params.manifestId !== undefined ? params.manifestId : existing.manifest_id,
        model_id: params.modelId !== undefined ? params.modelId : existing.model_id,
        capability: params.capability !== undefined ? params.capability : existing.capability,
        status: params.status ?? existing.status,
        mode: params.mode !== undefined ? params.mode : existing.mode,
        request_id: params.requestId !== undefined ? params.requestId : existing.request_id,
        assets_json: params.assetsJson ?? existing.assets_json,
        raw_response_json: params.rawResponseJson !== undefined ? params.rawResponseJson : existing.raw_response_json,
        error_code: params.errorCode !== undefined ? params.errorCode : existing.error_code,
        error_message: params.errorMessage !== undefined ? params.errorMessage : existing.error_message,
        submitted_at: params.submittedAt !== undefined ? params.submittedAt : existing.submitted_at,
        completed_at: params.completedAt !== undefined ? params.completedAt : existing.completed_at,
        updated_at: now(),
      }
      rows.set(id, row)
      return row
    },
    cancel(id: string): MediaGenerationTaskRow | null {
      const row = rows.get(id)
      if (!row || row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled') return row ?? null
      return this.update(id, { status: 'cancelled', completedAt: now() })
    },
  }
  return repo as unknown as MediaGenerationTaskRepository
}
