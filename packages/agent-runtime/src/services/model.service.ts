import type { ModelProfileRepository, ModelProfileRow, ProviderProfileRepository, ProviderProfileRow } from '@spark/storage'
import type { ModelProfile } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { resolveProviderApiKey } from './provider-credential-resolver.js'

const log = createLogger('model.service')

const DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.1', 'codellama'],
  'openai-compatible': [],
}

const EMBED_HTTP_TIMEOUT_MS = 15_000
const COMPLETE_HTTP_TIMEOUT_MS = 30_000

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

// ─── Completion 类型（记忆抽取/演化决策等小模型文本补全） ─────────────────

export interface CompleteUnavailable {
  available: false
  reason: string
}

export interface CompleteSuccess {
  available: true
  text: string
}

export type CompleteResult = CompleteUnavailable | CompleteSuccess

/**
 * 抽取模型未在 settings 显式配置时回退到当前会话 agent 对话的 provider/model。
 * 由 SessionService 在每 turn 之初写入（含 @mention 切换、team 主持 agent）。
 */
export interface ActiveChatModel {
  providerId: string
  model: string
}

export class ModelService {
  constructor(
    private readonly repo: ModelProfileRepository,
    /** embedding 能力所需（可选，不传则 embed() 始终返回不可用） */
    private readonly providerRepo?: ProviderProfileRepository,
    /** 读取 settings（memory.embeddingProviderId / memory.embeddingModel） */
    private readonly settingsGet?: (category: string, key: string) => unknown | null,
    /**
     * 当 settings 未配 memory.extractionProviderId/extractionModel 时，
     * complete() 用此钩子拿到当前会话 / @mention agent 的实际对话模型。
     * 返回 null 表示无回退（最终 unavailable，不抛异常）。
     */
    private readonly getActiveChatModel?: () => ActiveChatModel | null,
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

      const apiKey = await resolveProviderApiKey(provider)

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

      // 兼容两种 embeddings 响应格式：
      //   - OpenAI 标准：{ data: [{ embedding: number[], index: number }] }
      //   - 智谱原生（embedding-3 较新后端）：{ vectors: number[][], base_resp?: { status_code, status_msg } }
      // 同一端点在不同请求来源/负载下可能返回任一种，故两侧都识别。
      const json = (await res.json()) as {
        data?: Array<{ index?: number; embedding?: number[] }>
        vectors?: unknown
        base_resp?: { status_code?: number; status_msg?: string }
      }

      const vectors: number[][] = []

      if (Array.isArray(json.data)) {
        // OpenAI 格式：按 index 排序对齐输入顺序（规范要求 data 有 index 字段）
        const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        for (const item of sorted) {
          if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
            return { available: false, reason: 'malformed embedding vector in response (OpenAI data[].embedding)' }
          }
          vectors.push(item.embedding)
        }
      } else if (Array.isArray(json.vectors)) {
        // 智谱原生格式：vectors 是 number[][]，顺序天然对应输入，无 index 字段
        for (const v of json.vectors) {
          if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number')) {
            return { available: false, reason: 'malformed embedding vector in response (zhipu vectors[])' }
          }
          vectors.push(v as number[])
        }
        // base_resp 携带业务状态码：非成功视为软失败（HTTP 已是 200，但智谱用 base_resp 表达错误）
        const code = json.base_resp?.status_code
        if (code != null && code !== 0 && code !== 200) {
          return {
            available: false,
            reason: `embedding provider error: ${code} ${json.base_resp?.status_msg ?? ''}`.trim(),
          }
        }
      } else {
        // 既不是 OpenAI 也不是智谱格式 —— 把响应摘要透到 reason 方便定位
        const topKeys = typeof json === 'object' && json != null ? Object.keys(json).join(',') : typeof json
        return {
          available: false,
          reason: `malformed embeddings response (expected data[] or vectors[], topKeys=[${topKeys}])`,
        }
      }

      if (vectors.length !== texts.length) {
        return {
          available: false,
          reason: `embeddings count mismatch (expected ${texts.length}, got ${vectors.length})`,
        }
      }

      return { available: true, vectors, dimension: vectors[0]!.length, model }
    } catch (err) {
      // 网络/超时等一切异常都归入"暂不可用"，绝不上抛阻塞主流程
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`embed failed (degrading to unavailable): ${msg}`)
      return { available: false, reason: msg }
    }
  }

  // ─── Completion（小模型文本补全：记忆抽取 / 演化决策） ──────────────────

  /**
   * 单轮文本补全 — OpenAI 兼容 /chat/completions 端点。
   *
   * 服务于记忆系统的写入路径（抽取候选、演化 ADD/UPDATE/DELETE/NOOP 决策、
   * 整合 job）：settings 未配置抽取模型（memory.extractionProviderId +
   * memory.extractionModel）→ 回退到当前会话 / @mention agent 的对话模型
   * （团队主持 agent 用会话默认）；provider 不存在、key 缺失、网络超时等情况
   * 一律返回 { available: false }，永不抛异常 —— 上层据此把 callLLM 降级
   * 为 '[]' 或 skip，记忆写入静默跳过，绝不阻塞主对话。
   *
   * 支持两类 provider（按 provider_type 分流）：
   *   - anthropic：原生 /v1/messages（x-api-key + anthropic-version），claude 模型可做抽取
   *   - 其它（deepseek/openrouter/openai/vLLM 等）：OpenAI 兼容 /chat/completions
   * embedding 仍仅 OpenAI 兼容（anthropic 不提供 embedding 模型，纯 claude 配置走 FTS-only）。
   */
  async complete(prompt: string, opts?: { maxTokens?: number }): Promise<CompleteResult> {
    // 记录开始时间，用于算 HTTP 耗时（让"1 秒返回是真调了还是短路"可验证）
    const t0 = Date.now()
    try {
      if (prompt.length === 0) {
        log.info('【抽取LLM调用】跳过：prompt 为空')
        return { available: false, reason: 'empty prompt' }
      }
      if (this.providerRepo == null || this.settingsGet == null) {
        log.info('【抽取LLM调用】跳过：依赖未注入（providerRepo/settingsGet 缺失）')
        return { available: false, reason: 'completion dependencies not wired' }
      }

      const providerIdRaw = this.settingsGet('memory', 'extractionProviderId')
      const modelRaw = this.settingsGet('memory', 'extractionModel')
      let providerId = typeof providerIdRaw === 'string' ? providerIdRaw : ''
      let model = typeof modelRaw === 'string' ? modelRaw : ''
      let source = 'settings'

      // settings 未配时回退到当前会话 / @mention agent 的对话模型。
      // 仅当 settings 完全没配才回退；settings 给空字符串被视为"显式禁用"不触发回退。
      const settingsAbsent =
        (providerIdRaw == null || providerIdRaw === undefined) &&
        (modelRaw == null || modelRaw === undefined)
      if (settingsAbsent && this.getActiveChatModel != null) {
        const active = this.getActiveChatModel()
        if (active != null && typeof active.providerId === 'string' && active.providerId.length > 0
            && typeof active.model === 'string' && active.model.length > 0) {
          providerId = active.providerId
          model = active.model
          source = 'fallback(会话对话模型)'
        }
      }

      if (typeof providerId !== 'string' || providerId.length === 0 || typeof model !== 'string' || model.length === 0) {
        log.info(`【抽取LLM调用】跳过：未配置抽取模型（settings 未配且无回退）。providerId="${providerId}" model="${model}"`)
        return { available: false, reason: 'no extraction model configured' }
      }

      const provider: ProviderProfileRow | null = this.providerRepo.get(providerId)
      if (provider == null) {
        log.info(`【抽取LLM调用】跳过：provider 不存在 providerId=${providerId}`)
        return { available: false, reason: `extraction provider not found: ${providerId}` }
      }

      const apiKey = await resolveProviderApiKey(provider)

      let apiEndpoint: string | undefined
      try {
        const config = JSON.parse(provider.config_json) as { apiEndpoint?: string }
        apiEndpoint = config.apiEndpoint
      } catch {
        // config 解析失败按无自定义端点处理
      }

      const isAnthropic = provider.provider_type === 'anthropic'
      const maxTokens = opts?.maxTokens ?? 1024
      // URL 提前算（让"开始"日志就含接口地址，测试时一眼能看到请求打到哪里）
      const url = isAnthropic ? getAnthropicMessagesEndpoint(apiEndpoint) : getChatEndpoint(apiEndpoint)
      // 【入口日志】让"用谁、调哪个接口、有没有 key"全可见。脱敏 key 只显示前 4 位 + 长度。
      const keyDesc = apiKey.length > 0 ? `key=${apiKey.slice(0, 4)}***(${apiKey.length}字符)` : 'key=(空，本地CLI/免key)'
      log.info(
        `【抽取LLM调用】开始：source=${source} provider=${provider.name}(${providerId}) ` +
        `model=${model} 接口=${url} ${keyDesc} ` +
        `provider_type=${provider.provider_type} isAnthropic=${isAnthropic} prompt=${prompt.length}字符 maxTokens=${maxTokens}`,
      )
      let res: Response
      if (isAnthropic) {
        // anthropic 原生 /v1/messages：x-api-key + anthropic-version；max_tokens 必填
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey.length > 0 ? { 'x-api-key': apiKey } : {}),
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(COMPLETE_HTTP_TIMEOUT_MS),
        })
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(COMPLETE_HTTP_TIMEOUT_MS),
        })
      }
      const elapsedMs = Date.now() - t0

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        log.warn(
          `【抽取LLM调用】HTTP 失败：${res.status} ${res.statusText} 耗时=${elapsedMs}ms url=${url} ` +
          `body=${body.slice(0, 300)}`,
        )
        return { available: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` }
      }

      const json = await res.json()
      let text: string | undefined
      if (isAnthropic) {
        const data = json as { content?: Array<{ type?: string; text?: string }> }
        text = data.content?.find((c) => c.type === 'text')?.text
      } else {
        const data = json as { choices?: Array<{ message?: { content?: string } }> }
        text = data.choices?.[0]?.message?.content
      }
      // 【响应日志】让"真调了 + 返回什么 + 多快"全可见，打消"接口没真调"的怀疑。
      log.info(
        `【抽取LLM调用】成功：HTTP ${res.status} 耗时=${elapsedMs}ms ` +
        `返回 text=${text?.length ?? 0}字符 预览=${(text ?? '(空)').slice(0, 150).replace(/\s+/g, ' ')}`,
      )
      if (typeof text !== 'string' || text.length === 0) {
        log.warn(`【抽取LLM调用】响应解析为空：HTTP 200 但无 text 字段。原始响应=${JSON.stringify(json).slice(0, 300)}`)
        return { available: false, reason: 'malformed completion response' }
      }
      return { available: true, text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const elapsedMs = Date.now() - t0
      log.warn(`【抽取LLM调用】异常（已降级 unavailable）：耗时=${elapsedMs}ms 错误=${msg}`)
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

/**
 * 从 provider 配置的 base endpoint 推导 /chat/completions URL（记忆抽取用）。
 * 规则与 getEmbeddingsEndpoint 一致。
 */
function getChatEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

/**
 * anthropic 原生 /v1/messages 端点（记忆抽取用）。
 * 默认 https://api.anthropic.com；与 getChatEndpoint 同规则归一化。
 */
function getAnthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.anthropic.com').trim().replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/messages')) return `${base.slice(0, -'/messages'.length)}/v1/messages`
  if (/\/v\d+$/.test(base)) return `${base}/messages`
  return `${base}/v1/messages`
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
