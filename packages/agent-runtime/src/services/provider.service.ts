import type {
  ProviderProfile,
  ProviderHealthCheckResponse,
  ProviderExportPayload,
  ProviderExportProfile,
  ProviderImportMode,
  ProviderImportResult,
} from '@spark/protocol'
import { PROVIDER_EXPORT_VERSION } from '@spark/protocol'
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
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
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
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
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
        ...(params.haikuModel !== undefined && params.haikuModel.trim().length > 0 && { haikuModel: params.haikuModel.trim() }),
        ...(params.sonnetModel !== undefined && params.sonnetModel.trim().length > 0 && { sonnetModel: params.sonnetModel.trim() }),
        ...(params.opusModel !== undefined && params.opusModel.trim().length > 0 && { opusModel: params.opusModel.trim() }),
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
    /** null 清除该档自定义；string 设置；undefined 不修改 */
    haikuModel?: string | null
    sonnetModel?: string | null
    opusModel?: string | null
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
    const tierTouched =
      params.haikuModel !== undefined ||
      params.sonnetModel !== undefined ||
      params.opusModel !== undefined
    const newConfig =
      nextDefaultModel !== undefined ||
      params.modelIds !== undefined ||
      params.apiEndpoint !== undefined ||
      params.codexApiKind !== undefined ||
      params.supportsMillionContext !== undefined ||
      tierTouched
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
    if (newConfig !== undefined && params.haikuModel !== undefined) {
      const v = params.haikuModel?.trim()
      if (v != null && v.length > 0) newConfig.haikuModel = v
      else delete newConfig.haikuModel
    }
    if (newConfig !== undefined && params.sonnetModel !== undefined) {
      const v = params.sonnetModel?.trim()
      if (v != null && v.length > 0) newConfig.sonnetModel = v
      else delete newConfig.sonnetModel
    }
    if (newConfig !== undefined && params.opusModel !== undefined) {
      const v = params.opusModel?.trim()
      if (v != null && v.length > 0) newConfig.opusModel = v
      else delete newConfig.opusModel
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

  /**
   * 导出 provider 配置为 ExportPayload（不含 apiKey）。
   *
   * - ids 为空时导出全部
   * - id 不存在时静默跳过（不抛错），方便前端多选时无需严格校验
   */
  async exportProviders(ids: string[] = []): Promise<ProviderExportPayload> {
    const rows = this.repo.listAll()
    const idSet = ids.length > 0 ? new Set(ids) : null
    const profiles: ProviderExportProfile[] = []
    for (const row of rows) {
      if (idSet !== null && !idSet.has(row.id)) continue
      profiles.push(rowToExportProfile(row))
    }
    return {
      version: PROVIDER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: 'spark-agent',
      profiles,
    }
  }

  /**
   * 导入 ExportPayload 到数据库。
   *
   * - 模式 merge：按 name 去重，已存在则跳过（计入 skipped）
   * - 模式 replace：按 name 去重，已存在则更新（保留本地 keystoreRef）
   * - 单个 profile 失败不中断整体流程；错误累加到 errors
   * - 导入新建的 profile 强制 isDefault=false（避免覆盖本地默认）
   * - 导入更新的 profile 保留原 isDefault 标志
   */
  async importProviders(
    payload: ProviderExportPayload,
    mode: ProviderImportMode,
  ): Promise<ProviderImportResult> {
    const result: ProviderImportResult = { imported: 0, skipped: 0, errors: [] }
    if (payload.profiles.length === 0) return result

    const existing = new Map<string, ReturnType<typeof this.repo.listAll>[number]>()
    for (const row of this.repo.listAll()) {
      existing.set(row.name, row)
    }

    for (const profile of payload.profiles) {
      try {
        const match = existing.get(profile.name)
        if (match != null) {
          if (mode === 'merge') {
            result.skipped += 1
            continue
          }
          // replace: 更新已存在的（保留 keystoreRef、本地 isDefault）
          this.repo.update(match.id, {
            name: profile.name,
            config: buildConfigFromExport(profile),
          })
          result.imported += 1
          continue
        }

        // 新建：apiKey 不在 payload 中，本地创建时 keystoreRef 占位空串，
        // 提示用户后续在编辑面板补 API Key
        const newId = crypto.randomUUID()
        const providerType = profile.provider
        const ref = keystore.makeKeystoreRef(providerType, newId)
        // 写入一个空 key 占位（用户需要去编辑面板补 key 才能 healthCheck）
        await keystore.setSecret(ref, '')
        log.info(`Imported provider placeholder keystore for id=${newId} name=${profile.name}`)

        this.repo.create({
          id: newId,
          providerType,
          name: profile.name,
          config: buildConfigFromExport(profile),
          keystoreRef: ref,
          // 导入时强制非默认，避免覆盖本地默认设置
          isDefault: false,
        })
        result.imported += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`[${profile.name}] ${message}`)
        log.warn(`Failed to import provider "${profile.name}": ${message}`)
      }
    }

    return result
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
  /** 档位映射；未配置则回落 defaultModel */
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
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

/* ─── 导入导出辅助 ─────────────────────────────────────────────────────────── */

/**
 * 把数据库行（已含 config_json）转成可导出的 ProviderExportProfile。
 *
 * 故意丢弃：
 *   - keystoreRef（导入时不复用；新建时会生成新 ref）
 *   - createdAt（导入时由 DB 自动生成）
 *   - apiKey（永不出库）
 */
function rowToExportProfile(row: {
  id: string
  provider_type: string
  name: string
  config_json: string
  is_default: number
}): ProviderExportProfile {
  const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
  return {
    id: row.id,
    name: row.name,
    provider: normalizeProviderType(row.provider_type),
    apiEndpoint: config.apiEndpoint ?? null,
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    supportsMillionContext: config.supportsMillionContext === true,
    isDefault: row.is_default === 1,
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
  }
}

/**
 * 从 ProviderExportProfile 重建可写入 config_json 的对象。
 *
 * 字段默认值：import 时 apiEndpoint 是 null 表示"使用默认"，
 * 此时不写入 apiEndpoint 键（保持与 rowToProfile 行为一致）。
 */
function buildConfigFromExport(profile: ProviderExportProfile): {
  defaultModel: string
  modelIds: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
} {
  return {
    defaultModel: profile.defaultModel,
    modelIds: profile.modelIds,
    ...(profile.apiEndpoint != null && { apiEndpoint: profile.apiEndpoint }),
    ...(profile.codexApiKind !== undefined && { codexApiKind: profile.codexApiKind }),
    supportsMillionContext: profile.supportsMillionContext,
    ...(profile.haikuModel != null && profile.haikuModel.length > 0 && { haikuModel: profile.haikuModel }),
    ...(profile.sonnetModel != null && profile.sonnetModel.length > 0 && { sonnetModel: profile.sonnetModel }),
    ...(profile.opusModel != null && profile.opusModel.length > 0 && { opusModel: profile.opusModel }),
  }
}
