import type { ModelProfileRepository, ModelProfileRow, ProviderProfileRepository, ProviderProfileRow } from '@spark/storage'
import type { ModelProfile } from '@spark/protocol'
import * as keystore from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'

const log = createLogger('model.service')

const DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.1', 'codellama'],
  'openai-compatible': [],
}

const EMBED_HTTP_TIMEOUT_MS = 15_000

// ─── Embedding 类型 ───────────────────────────────────────────────────────

/** embed 能力探测失败/暂不可用（不抛异常，上层据此降级 FTS-only） */
export interface EmbedUnavailable {
  available: false
  reason: string
}

export interface EmbedSuccess {
  available: true
  vectors: number[][]
  dimension: number
  model: string
}

export type EmbedResult = EmbedUnavailable | EmbedSuccess

export class ModelService {
  constructor(
    private readonly repo: ModelProfileRepository,
    /** embedding 能力所需（可选，不传则 embed() 始终返回不可用） */
    private readonly providerRepo?: ProviderProfileRepository,
    /** 读取 settings（memory.embeddingProviderId / memory.embeddingModel） */
    private readonly settingsGet?: (category: string, key: string) => unknown | null,
  ) {
    this.repo.ensureSchema()
  }

  // ─── Embedding ─────────────────────────────────────────────────────────

  /**
   * 批量文本向量化 — OpenAI 兼容 /embeddings 端点。
   *
   * 能力探测：settings 未配置 embedding 模型（memory.embeddingProviderId +
   * memory.embeddingModel）、provider 不存在、API key 缺失时返回
   * { available: false }，永不抛异常 —— 上层据此降级 FTS-only。
   *
   * 禁止直接 new SDK client：这里用 fetch 直调 HTTP 端点（与 provider.service
   * 的健康检查/模型列表同一模式）。
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    try {
      if (texts.length === 0) return { available: false, reason: 'empty input' }
      if (this.providerRepo == null || this.settingsGet == null) {
        return { available: false, reason: 'embedding dependencies not wired' }
      }

      const providerId = this.settingsGet('memory', 'embeddingProviderId')
      const model = this.settingsGet('memory', 'embeddingModel')
      if (typeof providerId !== 'string' || providerId.length === 0 || typeof model !== 'string' || model.length === 0) {
        return { available: false, reason: 'no embedding model configured' }
      }

      const provider: ProviderProfileRow | null = this.providerRepo.get(providerId)
      if (provider == null) {
        return { available: false, reason: `embedding provider not found: ${providerId}` }
      }

      let apiKey = ''
      if (provider.keystore_ref != null && provider.keystore_ref.length > 0) {
        apiKey = (await keystore.getSecret(provider.keystore_ref as keystore.KeystoreRef))?.trim() ?? ''
      }

      let apiEndpoint: string | undefined
      try {
        const config = JSON.parse(provider.config_json) as { apiEndpoint?: string }
        apiEndpoint = config.apiEndpoint
      } catch {
        // config 解析失败按无自定义端点处理
      }

      const url = getEmbeddingsEndpoint(apiEndpoint)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(EMBED_HTTP_TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { available: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` }
      }

      const json = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> }
      const data = json.data
      if (!Array.isArray(data) || data.length !== texts.length) {
        return { available: false, reason: 'malformed embeddings response' }
      }

      // 按 index 排序对齐输入顺序（OpenAI 规范 data 有 index 字段）
      const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const vectors: number[][] = []
      for (const item of sorted) {
        if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
          return { available: false, reason: 'malformed embedding vector in response' }
        }
        vectors.push(item.embedding)
      }

      return { available: true, vectors, dimension: vectors[0]!.length, model }
    } catch (err) {
      // 网络/超时等一切异常都归入"暂不可用"，绝不上抛阻塞主流程
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`embed failed (degrading to unavailable): ${msg}`)
      return { available: false, reason: msg }
    }
  }

  list(filters?: { providerId?: string }): ModelProfile[] {
    return this.repo.list(filters).map(toModelProfile)
  }

  create(params: { providerId: string; name: string; configJson?: string }): ModelProfile {
    const row = this.repo.create(params)
    return toModelProfile(row)
  }

  update(id: string, fields: { name?: string; configJson?: string; enabled?: boolean }): ModelProfile {
    const row = this.repo.update(id, fields)
    if (!row) throw new Error(`Model not found: ${id}`)
    return toModelProfile(row)
  }

  delete(id: string): boolean {
    return this.repo.deleteById(id)
  }

  seedDefaultModels(providers: Array<{ id: string; provider: string }>): ModelProfile[] {
    const seeded: ModelProfile[] = []
    for (const p of providers) {
      const names = DEFAULT_MODELS[p.provider] ?? []
      for (const name of names) {
        const existing = this.repo.findByProviderAndName(p.id, name)
        if (!existing) {
          seeded.push(this.create({ providerId: p.id, name }))
        }
      }
    }
    return seeded
  }
}

/**
 * 从 provider 配置的 base endpoint 推导 /embeddings URL。
 * 端点归一化规则与 provider.service 的 chat/models 端点推导一致：
 * 已带版本段（/v1、/v2…）直接拼；否则补 /v1。
 */
function getEmbeddingsEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  if (base.endsWith('/embeddings')) return base
  if (/\/v\d+$/.test(base)) return `${base}/embeddings`
  return `${base}/v1/embeddings`
}

function toModelProfile(row: ModelProfileRow): ModelProfile {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    configJson: row.config_json,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
