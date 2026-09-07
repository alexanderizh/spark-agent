import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WorkflowBundleVerificationStatus = 'unverified' | 'passed' | 'warned' | 'failed'

export interface WorkflowBundleRow {
  id: string
  name: string
  version: string
  author: string | null
  description: string | null
  manifest_json: string
  source: string | null
  verification_status: WorkflowBundleVerificationStatus
  created_at: string
  updated_at: string
}

export interface CreateWorkflowBundleParams {
  id?: string
  name: string
  version?: string
  author?: string | null
  description?: string | null
  manifestJson: string
  source?: string | null
  verificationStatus?: WorkflowBundleVerificationStatus
}

export interface UpdateWorkflowBundleParams {
  name?: string
  version?: string
  author?: string | null
  description?: string | null
  manifestJson?: string
  verificationStatus?: WorkflowBundleVerificationStatus
}

export class WorkflowBundleRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'workflow_bundles')
  }

  list(): WorkflowBundleRow[] {
    return this.raw
      .prepare('SELECT * FROM workflow_bundles ORDER BY created_at DESC')
      .all() as WorkflowBundleRow[]
  }

  get(id: string): WorkflowBundleRow | null {
    return this.findById<WorkflowBundleRow>(id)
  }

  create(params: CreateWorkflowBundleParams): WorkflowBundleRow {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO workflow_bundles (
          id, name, version, author, description, manifest_json, source,
          verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.version ?? '1.0.0',
        params.author ?? null,
        params.description ?? null,
        params.manifestJson,
        params.source ?? null,
        params.verificationStatus ?? 'unverified',
        now,
        now,
      )
    return this.get(id)!
  }

  update(id: string, fields: UpdateWorkflowBundleParams): WorkflowBundleRow | null {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      values.push(value)
    }

    if (fields.name !== undefined) add('name', fields.name)
    if (fields.version !== undefined) add('version', fields.version)
    if (fields.author !== undefined) add('author', fields.author)
    if (fields.description !== undefined) add('description', fields.description)
    if (fields.manifestJson !== undefined) add('manifest_json', fields.manifestJson)
    if (fields.verificationStatus !== undefined)
      add('verification_status', fields.verificationStatus)

    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE workflow_bundles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }
}
