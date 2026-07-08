import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type MediaGenerationTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface MediaGenerationTaskRow {
  id: string
  provider_profile_id: string | null
  provider_kind: string | null
  manifest_id: string | null
  model_id: string | null
  operation: string
  capability: string | null
  status: MediaGenerationTaskStatus
  mode: string | null
  prompt: string | null
  negative_prompt: string | null
  input_files_json: string
  model_params_json: string
  output_dir: string
  request_id: string | null
  assets_json: string
  raw_response_json: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  completed_at: string | null
}

export interface CreateMediaGenerationTaskParams {
  id?: string
  providerProfileId?: string | null
  providerKind?: string | null
  manifestId?: string | null
  modelId?: string | null
  operation: string
  capability?: string | null
  status?: MediaGenerationTaskStatus
  mode?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  inputFilesJson?: string
  modelParamsJson?: string
  outputDir: string
  requestId?: string | null
  assetsJson?: string
  rawResponseJson?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  submittedAt?: string | null
  completedAt?: string | null
}

export interface UpdateMediaGenerationTaskParams {
  providerProfileId?: string | null
  providerKind?: string | null
  manifestId?: string | null
  modelId?: string | null
  capability?: string | null
  status?: MediaGenerationTaskStatus
  mode?: string | null
  requestId?: string | null
  assetsJson?: string
  rawResponseJson?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  submittedAt?: string | null
  completedAt?: string | null
}

export interface ListMediaGenerationTasksParams {
  providerProfileId?: string
  status?: MediaGenerationTaskStatus
  limit?: number
  offset?: number
}

export class MediaGenerationTaskRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'media_generation_tasks')
  }

  ensureSchema(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS media_generation_tasks (
        id TEXT PRIMARY KEY,
        provider_profile_id TEXT,
        provider_kind TEXT,
        manifest_id TEXT,
        model_id TEXT,
        operation TEXT NOT NULL,
        capability TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        mode TEXT,
        prompt TEXT,
        negative_prompt TEXT,
        input_files_json TEXT NOT NULL DEFAULT '[]',
        model_params_json TEXT NOT NULL DEFAULT '{}',
        output_dir TEXT NOT NULL,
        request_id TEXT,
        assets_json TEXT NOT NULL DEFAULT '[]',
        raw_response_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        submitted_at TEXT,
        completed_at TEXT
      );
    `)
  }

  create(params: CreateMediaGenerationTaskParams): MediaGenerationTaskRow {
    const now = new Date().toISOString()
    const id = params.id ?? randomUUID()
    this.raw.prepare(`
      INSERT INTO media_generation_tasks
        (id, provider_profile_id, provider_kind, manifest_id, model_id, operation, capability, status, mode,
         prompt, negative_prompt, input_files_json, model_params_json, output_dir, request_id, assets_json,
         raw_response_json, error_code, error_message, created_at, updated_at, submitted_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.providerProfileId ?? null,
      params.providerKind ?? null,
      params.manifestId ?? null,
      params.modelId ?? null,
      params.operation,
      params.capability ?? null,
      params.status ?? 'pending',
      params.mode ?? null,
      params.prompt ?? null,
      params.negativePrompt ?? null,
      params.inputFilesJson ?? '[]',
      params.modelParamsJson ?? '{}',
      params.outputDir,
      params.requestId ?? null,
      params.assetsJson ?? '[]',
      params.rawResponseJson ?? null,
      params.errorCode ?? null,
      params.errorMessage ?? null,
      now,
      now,
      params.submittedAt ?? null,
      params.completedAt ?? null,
    )
    return this.getById(id)!
  }

  getById(id: string): MediaGenerationTaskRow | null {
    return this.findById<MediaGenerationTaskRow>(id)
  }

  list(params?: ListMediaGenerationTasksParams): MediaGenerationTaskRow[] {
    const where: string[] = []
    const values: unknown[] = []
    if (params?.providerProfileId !== undefined) {
      where.push('provider_profile_id = ?')
      values.push(params.providerProfileId)
    }
    if (params?.status !== undefined) {
      where.push('status = ?')
      values.push(params.status)
    }
    values.push(params?.limit ?? 100, params?.offset ?? 0)
    return this.raw.prepare(`
      SELECT * FROM media_generation_tasks
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...values) as MediaGenerationTaskRow[]
  }

  update(id: string, params: UpdateMediaGenerationTaskParams): MediaGenerationTaskRow | null {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (params.providerProfileId !== undefined) add('provider_profile_id', params.providerProfileId)
    if (params.providerKind !== undefined) add('provider_kind', params.providerKind)
    if (params.manifestId !== undefined) add('manifest_id', params.manifestId)
    if (params.modelId !== undefined) add('model_id', params.modelId)
    if (params.capability !== undefined) add('capability', params.capability)
    if (params.status !== undefined) add('status', params.status)
    if (params.mode !== undefined) add('mode', params.mode)
    if (params.requestId !== undefined) add('request_id', params.requestId)
    if (params.assetsJson !== undefined) add('assets_json', params.assetsJson)
    if (params.rawResponseJson !== undefined) add('raw_response_json', params.rawResponseJson)
    if (params.errorCode !== undefined) add('error_code', params.errorCode)
    if (params.errorMessage !== undefined) add('error_message', params.errorMessage)
    if (params.submittedAt !== undefined) add('submitted_at', params.submittedAt)
    if (params.completedAt !== undefined) add('completed_at', params.completedAt)
    if (sets.length === 0) return this.getById(id)
    add('updated_at', new Date().toISOString())
    values.push(id)
    this.raw.prepare(`UPDATE media_generation_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.getById(id)
  }

  cancel(id: string): MediaGenerationTaskRow | null {
    const row = this.getById(id)
    if (!row || row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled') return row
    return this.update(id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    })
  }
}
