import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ProviderProfileRow {
  id: string
  provider_type: string
  name: string
  config_json: string
  enabled: number
  keystore_ref: string | null
  is_default: number
  created_at: string
  updated_at: string
}

export interface CreateProviderParams {
  id: string
  providerType: string
  name: string
  config: { defaultModel: string; modelIds: string[]; providerIcon?: { id: string; style: 'avatar' | 'mono' }; apiEndpoint?: string; codexApiKind?: 'chat' | 'responses' | 'embedding'; supportsMillionContext?: boolean; contextWindow?: number; maxTokens?: number; temperature?: number; modelType?: string; imageProvider?: string | null; imageApiType?: 'sync' | 'async' | 'auto' | null; mediaModelRefs?: unknown[]; managed?: boolean; managedType?: 'newapi'; managedOwnerUserId?: string; credentialState?: string }
  keystoreRef: string
  isDefault?: boolean
}

export class ProviderProfileRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'provider_profiles')
  }

  create(params: CreateProviderParams): ProviderProfileRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO provider_profiles (id, provider_type, name, config_json, enabled, keystore_ref, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.providerType,
        params.name,
        this.toJson(params.config),
        params.keystoreRef,
        params.isDefault ? 1 : 0,
        now,
        now,
      )
    return this.findById<ProviderProfileRow>(params.id)!
  }

  get(id: string): ProviderProfileRow | null {
    return this.findById<ProviderProfileRow>(id)
  }

  listAll(): ProviderProfileRow[] {
    return this.findAll<ProviderProfileRow>(1000)
  }

  findByProviderType(type: string): ProviderProfileRow[] {
    return this.raw
      .prepare(`SELECT * FROM provider_profiles WHERE provider_type = ?`)
      .all(type) as ProviderProfileRow[]
  }

  update(
    id: string,
    fields: Partial<{
      providerType: string
      name: string
      config: Record<string, unknown>
      enabled: boolean
      keystoreRef: string
    }>,
  ): void {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (fields.providerType !== undefined) { sets.push('provider_type = ?'); values.push(fields.providerType) }
    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name) }
    if (fields.config !== undefined) { sets.push('config_json = ?'); values.push(this.toJson(fields.config)) }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0) }
    if (fields.keystoreRef !== undefined) { sets.push('keystore_ref = ?'); values.push(fields.keystoreRef) }

    values.push(id)
    this.raw.prepare(`UPDATE provider_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  setDefault(id: string): void {
    this.raw.transaction(() => {
      this.raw.prepare(`UPDATE provider_profiles SET is_default = 0`).run()
      this.raw.prepare(`UPDATE provider_profiles SET is_default = 1 WHERE id = ?`).run(id)
    })()
  }

  getDefault(): ProviderProfileRow | null {
    return (
      (this.raw
        .prepare(`SELECT * FROM provider_profiles WHERE is_default = 1 LIMIT 1`)
        .get() as ProviderProfileRow | undefined) ?? null
    )
  }
}
