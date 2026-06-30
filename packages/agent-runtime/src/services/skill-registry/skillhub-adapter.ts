/**
 * @module skill-registry/skillhub-adapter
 *
 * SkillHub Adapter — 对接 skillhub.cn（腾讯云 SkillHub，国内首选 Skills 源）
 *
 * SkillHub 是面向中国用户的 AI Skills 社区（6 万+ Skills），内容存于腾讯云 COS 全球加速节点，
 * 解决 GitHub 直连在国内访问困难的问题。
 *
 * 真实 API（host: api.skillhub.cn，无需鉴权即可读；网页 host skillhub.cn 只有 SPA，没有 JSON API）：
 *   GET /api/v1/showcase/recommended              推荐精选（=网页 sortBy=curated_score）
 *   GET /api/skills?sortBy=downloads&order=desc   下载热榜（pageSize 由调用方传）
 *   GET /api/v1/categories                        分类列表
 *   GET /api/v1/skills/{slug}                     单技能详情（含 latestVersion / 安全报告）
 *   GET /api/v1/skills/{slug}/files?version=      文件清单
 *   GET /api/v1/skills/{slug}/file?path=&version= 单文件（302 → cos.accelerate.myqcloud.com）
 *   GET /api/v1/download?slug=                    zip 整包（302 → cos.accelerate.myqcloud.com）
 *   GET /api/v1/search?page=&pageSize=&q=         关键词搜索（按相关度过滤；返回 {results:[]}）
 *   GET /api/skills?page=&pageSize=               技能列表（热门排序；注意 q 参数被服务端忽略，不能用于搜索）
 */

import type { RemoteSkillItem, SkillHubShowcaseSection } from '@spark/protocol'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { createRemoteSkillItem } from './adapter.js'

// ─── API Response Types ─────────────────────────────────────────────────

interface SkillHubSubCategory {
  key: string
  name: string
}

interface SkillHubSkillSummary {
  slug: string
  name: string
  displayName?: string
  description?: string
  description_zh?: string
  version?: string
  // camelCase（featured/showcase 接口）
  ownerName?: string
  iconUrl?: string
  // snake_case（/api/v1/search 接口）
  owner_name?: string
  icon_url?: string
  downloads?: number
  installs?: number
  stars?: number
  score?: number
  category?: string
  subCategories?: SkillHubSubCategory[]
  tags?: string[] | Record<string, unknown> | null
  labels?: { requires_api_key?: string } | null
  homepage?: string
  source?: string
  verified?: boolean
}

interface SkillHubShowcaseResponse {
  section?: string
  skills?: SkillHubSkillSummary[]
}

// /api/v1/search 返回 { results: [...] }（无 total；pageSize 被忽略，固定返回约 10 条）
interface SkillHubSearchResponse {
  results?: SkillHubSkillSummary[]
  total?: number
}

interface SkillHubCategoryItem {
  key: string
  name: string
  nameEn?: string
}

interface SkillHubCategoriesResponse {
  count?: number
  items?: SkillHubCategoryItem[]
}

interface SkillHubSkillDetail {
  skill?: SkillHubSkillSummary & {
    summary?: string
    summary_zh?: string
    stats?: { downloads?: number; installs?: number; stars?: number }
  }
  latestVersion?: { version?: string; changelog?: string }
  owner?: { displayName?: string; handle?: string }
}

// ─── Adapter ─────────────────────────────────────────────────────────────

export class SkillHubAdapter implements SkillRegistryAdapter {
  readonly registryId: string
  readonly registryName = 'SkillHub'
  private readonly apiBaseUrl: string
  private readonly headers: Record<string, string>

  constructor(config: SkillRegistryAdapterConfig) {
    this.registryId = config.registryId
    // 兼容历史配置：老库 / ensureDefaults 早期写的是网页 host https://skillhub.cn（无 JSON API）。
    // 真正的 API host 是 https://api.skillhub.cn；这里强制纠正，避免再次静默失败。
    const raw = (config.apiBaseUrl || 'https://api.skillhub.cn').replace(/\/+$/, '')
    this.apiBaseUrl = raw === 'https://skillhub.cn' || raw === 'https://www.skillhub.cn'
      ? 'https://api.skillhub.cn'
      : raw

    this.headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // 从 configJson 解析额外配置（API Key 等，目前公共读接口用不到，预留）
    try {
      const parsed = JSON.parse(config.configJson || '{}')
      if (parsed.apiKey && typeof parsed.apiKey === 'string') {
        this.headers.Authorization = `Bearer ${parsed.apiKey}`
      }
    } catch {
      // ignore parse errors
    }
  }

  // ─── search ───────────────────────────────────────────────────────────

  async search(
    query: string,
    options?: { category?: string; limit?: number; offset?: number },
  ): Promise<{ skills: RemoteSkillItem[]; total: number }> {
    const term = query.trim()
    // 空关键词走列表接口（/api/skills），有关键词走真正的搜索接口（/api/v1/search）。
    // 注意：/api/skills 也接受 q 参数，但服务端不按 q 过滤（总是返回热门列表），
    // 必须用 /api/v1/search 才会按相关度过滤。
    // 两个端点都接受 category=<key>（如 office-efficiency），与 sortBy/order 自由组合。
    const limit = options?.limit ?? 20
    const page = Math.floor((options?.offset ?? 0) / limit) + 1
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(limit))
    if (options?.category) params.set('category', options.category)

    try {
      if (term) {
        params.set('q', term)
        const url = `${this.apiBaseUrl}/api/v1/search?${params.toString()}`
        const res = await this.fetchJson<SkillHubSearchResponse>(url)
        const list = res.results ?? []
        const skills = list.map((s) => this.toRemoteSkillItem(s))
        return { skills, total: res.total ?? skills.length }
      }
      const url = `${this.apiBaseUrl}/api/skills?${params.toString()}`
      const res = await this.fetchJson<{ data?: { skills?: SkillHubSkillSummary[]; total?: number } }>(url)
      const env = res.data ?? {}
      const list = env.skills ?? []
      const skills = list.map((s) => this.toRemoteSkillItem(s))
      return { skills, total: env.total ?? skills.length }
    } catch (err) {
      console.warn(`[SkillHub] search failed: ${err instanceof Error ? err.message : err}`)
      return { skills: [], total: 0 }
    }
  }

  // ─── featured（推荐精选 / 下载热榜） ───────────────────────

  async featured(
    limit?: number,
    section?: SkillHubShowcaseSection,
    category?: string,
  ): Promise<RemoteSkillItem[]> {
    return this.showcase(section ?? 'recommended', limit, category)
  }

  // 两个子榜位的真实后端契约：
  //   recommended    → GET /api/v1/showcase/recommended              官方推荐接口（curated，无分类参数时使用）
  //                   ⚠️ 实测：?category=<key> 会被后端忽略，结果不会按分类过滤。
  //                   带 category 时改走 /api/skills?sortBy=score&category=<key> 达到等效的「高分类下评分最高」语义。
  //   hot_downloads  → GET /api/skills?page=1&pageSize=N&sortBy=downloads&order=desc
  //                   走的是技能列表接口 + 按下载量倒序；后端接受 &category=<key> 真实过滤。
  private async showcase(
    section: SkillHubShowcaseSection,
    limit?: number,
    category?: string,
  ): Promise<RemoteSkillItem[]> {
    const pageSize = typeof limit === 'number' && limit > 0 ? limit : 24
    const cat = category?.trim() || ''
    try {
      if (section === 'hot_downloads') {
        // 下载热榜：复用 /api/skills 列表接口，按下载量倒序
        const params = new URLSearchParams({
          page: '1',
          pageSize: String(pageSize),
          sortBy: 'downloads',
          order: 'desc',
        })
        if (cat) params.set('category', cat)
        const url = `${this.apiBaseUrl}/api/skills?${params.toString()}`
        const res = await this.fetchJson<{ data?: { skills?: SkillHubSkillSummary[] } }>(url)
        const list = res.data?.skills ?? []
        return list.map((s) => this.toRemoteSkillItem(s))
      }
      // recommended：未指定分类走官方 showcase；指定分类改走 /api/skills?sortBy=score（showcase 不支持 category 过滤）
      if (cat) {
        const params = new URLSearchParams({
          page: '1',
          pageSize: String(pageSize),
          sortBy: 'score',
          order: 'desc',
          category: cat,
        })
        const url = `${this.apiBaseUrl}/api/skills?${params.toString()}`
        const res = await this.fetchJson<{ data?: { skills?: SkillHubSkillSummary[] } }>(url)
        const list = res.data?.skills ?? []
        return list.map((s) => this.toRemoteSkillItem(s))
      }
      const url = `${this.apiBaseUrl}/api/v1/showcase/recommended`
      const res = await this.fetchJson<SkillHubShowcaseResponse>(url)
      const list = res.skills ?? []
      const sliced = typeof limit === 'number' && limit > 0 ? list.slice(0, limit) : list
      return sliced.map((s) => this.toRemoteSkillItem(s))
    } catch (err) {
      console.warn(
        `[SkillHub] showcase(${section}) failed: ${err instanceof Error ? err.message : err}`,
      )
      return []
    }
  }

  // ─── categories ───────────────────────────────────────────────────────

  async categories(): Promise<Array<{ key: string; name: string }>> {
    const url = `${this.apiBaseUrl}/api/v1/categories`
    try {
      const res = await this.fetchJson<SkillHubCategoriesResponse>(url)
      const items = res.items ?? []
      // 保留原始 order（API 按 sortOrder 升序返回）；过滤掉缺 key/name 的脏数据
      const list = items
        .filter((i): i is { key: string; name: string } =>
          typeof i.key === 'string' && i.key.length > 0 && typeof i.name === 'string' && i.name.length > 0,
        )
        .map((i) => ({ key: i.key, name: i.name }))
      return [{ key: 'all', name: '全部' }, ...list]
    } catch (err) {
      console.warn(`[SkillHub] categories failed: ${err instanceof Error ? err.message : err}`)
      return [{ key: 'all', name: '全部' }]
    }
  }

  // ─── fetchManifest ────────────────────────────────────────────────────

  async fetchManifest(manifestUrl: string): Promise<string> {
    // manifestUrl 约定为 SKILL.md 文件 URL（由 toRemoteSkillItem 生成，含 version）。
    // 直接 fetch（follow 302 到 COS 加速）拿 SKILL.md 正文，包成 manifest JSON。
    try {
      const content = await this.fetchText(manifestUrl)
      if (content.trim()) return JSON.stringify({ format: 'skill-md', content })
    } catch {
      // fall through to slug-based reconstruction
    }
    const slug = this.extractSlug(manifestUrl)
    if (slug) {
      const content = await this.fetchText(this.buildSkillMdUrl(slug))
      return JSON.stringify({ format: 'skill-md', content })
    }
    throw new Error(`SkillHub manifest fetch failed: ${manifestUrl}`)
  }

  // ─── healthCheck ──────────────────────────────────────────────────────

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    try {
      const url = `${this.apiBaseUrl}/api/v1/showcase/recommended`
      const res = await globalThis.fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { healthy: false, latencyMs, error: `HTTP ${res.status}` }
      return { healthy: true, latencyMs }
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }

  // ─── 暴露给 service 层的 URL 构造器（供 installFromSkillHub 使用） ──────

  /** SKILL.md 文件 URL（也用作 RemoteSkillItem.manifestUrl） */
  buildSkillMdUrl(slug: string, version?: string): string {
    const params = new URLSearchParams({ path: 'SKILL.md' })
    if (version) params.set('version', version)
    return `${this.apiBaseUrl}/api/v1/skills/${slug}/file?${params.toString()}`
  }

  /** zip 整包下载入口（302 → COS 加速） */
  buildDownloadUrl(slug: string): string {
    return `${this.apiBaseUrl}/api/v1/download?slug=${encodeURIComponent(slug)}`
  }

  /** 文件清单 */
  buildFilesUrl(slug: string, version?: string): string {
    const params = new URLSearchParams()
    if (version) params.set('version', version)
    const qs = params.toString()
    return `${this.apiBaseUrl}/api/v1/skills/${slug}/files${qs ? '?' + qs : ''}`
  }

  /** 单文件下载 URL（302 → COS 加速） */
  buildFileUrl(slug: string, filePath: string, version?: string): string {
    const params = new URLSearchParams({ path: filePath })
    if (version) params.set('version', version)
    return `${this.apiBaseUrl}/api/v1/skills/${slug}/file?${params.toString()}`
  }

  /** 详情（含 latestVersion / 安全报告） */
  buildDetailUrl(slug: string): string {
    return `${this.apiBaseUrl}/api/v1/skills/${slug}`
  }

  /** 取详情，供 service 解析 latestVersion 等 */
  async fetchDetail(slug: string): Promise<SkillHubSkillDetail> {
    return this.fetchJson<SkillHubSkillDetail>(this.buildDetailUrl(slug))
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private toRemoteSkillItem(skill: SkillHubSkillSummary): RemoteSkillItem {
    const slug = skill.slug
    const version = skill.version ?? '1.0.0'
    const description = skill.description_zh?.trim() || skill.description?.trim() || ''

    // tags：优先 subCategories.name；showcase 的 tags 可能是 null/对象/数组，统一兜底
    const tagNames =
      Array.isArray(skill.subCategories) && skill.subCategories.length > 0
        ? skill.subCategories.map((c) => c.name).filter(Boolean)
        : Array.isArray(skill.tags)
          ? skill.tags.filter((t): t is string => typeof t === 'string')
          : []

    // rating：showcase 接口不返回评分字段；缺数据时落 3.0（featured 中位可信度）。
    // featured 的 score 是热门度（0–100000 量级），search 的 score 是相关度（0–1 小数）。
    // 统一映射：>1 视为百分制除以 20；≤1 视为 0–1 相关度乘以 5；缺数据落 3.0。
    const rawScore = typeof skill.score === 'number' && skill.score > 0 ? skill.score : 0
    const normalized = rawScore > 1 ? Math.min(100, rawScore) / 20 : rawScore > 0 ? rawScore * 5 : 3
    const rating = Math.min(5, Math.max(1, Math.round(normalized * 10) / 10))

    // featured 用 camelCase（iconUrl/ownerName），search 用 snake_case（icon_url/owner_name）+ displayName
    const iconUrl = skill.iconUrl ?? skill.icon_url
    const base = {
      id: `${this.registryId}:${slug}`,
      name: skill.displayName?.trim() || skill.name,
      description,
      version,
      author: skill.ownerName ?? skill.owner_name ?? 'SkillHub',
      registryId: this.registryId,
      registryName: this.registryName,
      category: skill.category ?? '',
      tags: tagNames.slice(0, 5),
      rating,
      downloadCount: skill.downloads ?? 0,
      homepageUrl: `https://www.skillhub.cn/skills/${slug}`,
      manifestUrl: this.buildSkillMdUrl(slug, version),
    }
    return createRemoteSkillItem(iconUrl ? { ...base, iconUrl } : base)
  }

  private extractSlug(url: string): string | null {
    const match = url.match(/\/skills\/([^/?#]+)/)
    return match?.[1] ?? null
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await globalThis.fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      if (res.status === 429) throw new Error('SkillHub API rate limit exceeded.')
      throw new Error(`SkillHub API error: ${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  private async fetchText(url: string): Promise<string> {
    const res = await globalThis.fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`SkillHub fetch failed: ${res.status} ${res.statusText}`)
    return res.text()
  }
}
