import type { ProviderProfile, ProviderHealthCheckResponse } from '@spark/protocol'
import { ProviderProfileRepository } from '@spark/storage'
import * as keystore from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'

const log = createLogger('provider.service')

function rowToProfile(row: {
  id: string
  provider_type: string
  name: string
  config_json: string
  keystore_ref: string | null
  is_default: number
  created_at: string
}): ProviderProfile {
  const config = JSON.parse(row.config_json) as { model?: string }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider_type,
    model: config.model ?? '',
    keystoreRef: row.keystore_ref ?? '',
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  }
}

export class ProviderService {
  constructor(private readonly repo: ProviderProfileRepository) {}

  async listProviders(): Promise<ProviderProfile[]> {
    return this.repo.listAll().map(rowToProfile)
  }

  async createProvider(params: {
    name: string
    provider: string
    model: string
    apiKey: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const id = crypto.randomUUID()
    const ref = keystore.makeKeystoreRef(params.provider, id)
    await keystore.setSecret(ref, params.apiKey)
    log.info(`Stored API key for provider=${params.provider} id=${id} key=${keystore.maskSecret(params.apiKey)}`)

    if (params.isDefault) {
      // clear existing defaults first
      this.repo.listAll().forEach((r) => {
        if (r.is_default) this.repo.update(r.id, {})
      })
    }

    const row = this.repo.create({
      id,
      providerType: params.provider,
      name: params.name,
      config: { model: params.model },
      keystoreRef: ref,
      isDefault: params.isDefault ?? false,
    })

    if (params.isDefault) {
      this.repo.setDefault(id)
    }

    return rowToProfile(row)
  }

  async updateProvider(params: {
    id: string
    name?: string
    model?: string
    apiKey?: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const existing = this.repo.get(params.id)
    if (!existing) throw new Error(`Provider not found: ${params.id}`)

    if (params.apiKey !== undefined) {
      const ref = existing.keystore_ref ?? keystore.makeKeystoreRef(existing.provider_type, params.id)
      await keystore.setSecret(ref as keystore.KeystoreRef, params.apiKey)
      log.info(`Updated API key for id=${params.id} key=${keystore.maskSecret(params.apiKey)}`)
    }

    const existingConfig = JSON.parse(existing.config_json) as { model?: string }
    const newConfig = params.model !== undefined ? { ...existingConfig, model: params.model } : undefined

    this.repo.update(params.id, {
      ...(params.name !== undefined && { name: params.name }),
      ...(newConfig !== undefined && { config: newConfig }),
    })

    if (params.isDefault) {
      this.repo.setDefault(params.id)
    }

    const updated = this.repo.get(params.id)!
    return rowToProfile(updated)
  }

  async deleteProvider(id: string): Promise<void> {
    const row = this.repo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)

    if (row.keystore_ref) {
      await keystore.deleteSecret(row.keystore_ref as keystore.KeystoreRef)
    }
    this.repo.delete(id)
  }

  async healthCheck(id: string): Promise<ProviderHealthCheckResponse> {
    const row = this.repo.get(id)
    if (!row) return { healthy: false, errorMessage: `Provider not found: ${id}` }

    if (!row.keystore_ref) return { healthy: false, errorMessage: 'No API key configured' }

    const apiKey = await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)
    if (!apiKey) return { healthy: false, errorMessage: 'API key not found in keychain' }

    const config = JSON.parse(row.config_json) as { apiEndpoint?: string }
    const start = Date.now()

    try {
      const endpoint = config.apiEndpoint ?? getDefaultEndpoint(row.provider_type)
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      })
      const latencyMs = Date.now() - start
      if (res.ok || res.status === 401) {
        // 401 means key is wrong but endpoint is reachable
        if (res.ok) return { healthy: true, latencyMs }
        return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
      }
      return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, errorMessage: String(err) }
    }
  }
}

function getDefaultEndpoint(providerType: string): string {
  switch (providerType) {
    case 'anthropic': return 'https://api.anthropic.com/v1/models'
    case 'openai': return 'https://api.openai.com/v1/models'
    case 'deepseek': return 'https://api.deepseek.com/v1/models'
    default: return 'https://api.openai.com/v1/models'
  }
}
