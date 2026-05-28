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
  const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
  return {
    id: row.id,
    name: row.name,
    provider: normalizeProviderType(row.provider_type),
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
    supportsMillionContext: config.supportsMillionContext === true,
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
    defaultModel?: string
    modelIds?: string[]
    model?: string
    apiEndpoint?: string
    codexApiKind?: 'chat' | 'responses'
    supportsMillionContext?: boolean
    apiKey: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const id = crypto.randomUUID()
    const providerType = normalizeProviderType(params.provider)
    const defaultModel = params.defaultModel ?? params.model
    if (defaultModel == null || defaultModel.trim().length === 0) {
      throw new Error('Provider defaultModel is required')
    }
    const ref = keystore.makeKeystoreRef(providerType, id)
    await keystore.setSecret(ref, params.apiKey)
    log.info(`Stored API key for provider=${providerType} id=${id} key=${keystore.maskSecret(params.apiKey)}`)

    if (params.isDefault) {
      // clear existing defaults first
      this.repo.listAll().forEach((r) => {
        if (r.is_default) this.repo.update(r.id, {})
      })
    }

    const row = this.repo.create({
      id,
      providerType,
      name: params.name,
      config: normalizeProviderConfig({
        defaultModel,
        ...(params.modelIds !== undefined && { modelIds: params.modelIds }),
        ...(params.apiEndpoint !== undefined && { apiEndpoint: params.apiEndpoint }),
        ...(params.codexApiKind !== undefined && { codexApiKind: params.codexApiKind }),
        ...(params.supportsMillionContext !== undefined && { supportsMillionContext: params.supportsMillionContext }),
      }),
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
    defaultModel?: string
    modelIds?: string[]
    model?: string
    apiEndpoint?: string | null
    codexApiKind?: 'chat' | 'responses'
    supportsMillionContext?: boolean
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

    const existingConfig = normalizeProviderConfig(JSON.parse(existing.config_json) as ProviderConfig)
    const nextDefaultModel = params.defaultModel ?? params.model
    const newConfig =
      nextDefaultModel !== undefined || params.modelIds !== undefined || params.apiEndpoint !== undefined || params.codexApiKind !== undefined || params.supportsMillionContext !== undefined
        ? { ...existingConfig }
        : undefined

    if (newConfig !== undefined && nextDefaultModel !== undefined) {
      newConfig.defaultModel = nextDefaultModel
      if (params.modelIds === undefined) {
        newConfig.modelIds = normalizeModelIds(nextDefaultModel, newConfig.modelIds)
      }
    }
    if (newConfig !== undefined && params.modelIds !== undefined) {
      newConfig.modelIds = normalizeModelIds(
        nextDefaultModel ?? newConfig.defaultModel,
        params.modelIds,
      )
    }
    if (newConfig !== undefined && params.apiEndpoint !== undefined) {
      if (params.apiEndpoint === null) {
        delete newConfig.apiEndpoint
      } else {
        newConfig.apiEndpoint = params.apiEndpoint
      }
    }
    if (newConfig !== undefined && params.codexApiKind !== undefined) {
      newConfig.codexApiKind = params.codexApiKind
    }
    if (newConfig !== undefined && params.supportsMillionContext !== undefined) {
      newConfig.supportsMillionContext = params.supportsMillionContext
    }

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

    const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
    const start = Date.now()
    const providerType = normalizeProviderType(row.provider_type)

    try {
      const res = providerType === 'anthropic'
        ? await fetch(getAnthropicMessagesEndpoint(config.apiEndpoint), {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.defaultModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(5000),
        })
        : await fetch(getHealthCheckEndpoint(providerType, config.apiEndpoint), {
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

interface ProviderConfig {
  defaultModel?: string
  model?: string
  modelIds?: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  maxTokens?: number
  temperature?: number
}

function normalizeProviderType(providerType: string): 'anthropic' | 'openai' {
  return providerType === 'anthropic' ? 'anthropic' : 'openai'
}

function normalizeModelIds(defaultModel: string, modelIds?: string[]): string[] {
  const normalized = [defaultModel, ...(modelIds ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set(normalized)]
}

function normalizeProviderConfig(config: ProviderConfig): Required<Pick<ProviderConfig, 'defaultModel' | 'modelIds'>> & Omit<ProviderConfig, 'defaultModel' | 'modelIds'> {
  const defaultModel = (config.defaultModel ?? config.model ?? '').trim()
  return {
    ...config,
    defaultModel,
    modelIds: normalizeModelIds(defaultModel, config.modelIds),
  }
}

function getHealthCheckEndpoint(providerType: string, apiEndpoint?: string): string {
  if (apiEndpoint !== undefined) {
    const trimmed = apiEndpoint.replace(/\/+$/, '')
    return trimmed.endsWith('/models') ? trimmed : `${trimmed}/models`
  }
  return getDefaultEndpoint(providerType)
}

function getDefaultEndpoint(providerType: string): string {
  switch (providerType) {
    case 'anthropic': return 'https://api.anthropic.com/v1/models'
    case 'openai': return 'https://api.openai.com/v1/models'
    default: return 'https://api.openai.com/v1/models'
  }
}

function getAnthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}
