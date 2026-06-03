/**
 * @module skill-registry/skillhub-adapter
 *
 * SkillHub Adapter — 对接 skillhub.cn (OpenClaw 兼容 API)
 *
 * SkillHub 是面向中国用户的 AI Skills 社区，包含 71k+ Skills。
 * API 文档参考：https://github.com/iflytek/skillhub
 *
 * 端点：
 *   GET /api/v1/search?q=<query>&page=<n>&limit=<n>
 *   GET /api/v1/skills/{slug}
 *   GET /api/v1/download/{slug}
 */

import type { RemoteSkillItem } from '@spark/protocol'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { createRemoteSkillItem } from './adapter.js'

// ─── API Response Types ─────────────────────────────────────────────────

interface SkillHubAuthor {
  handle: string
  displayName?: string
}

interface SkillHubSkill {
  slug: string
  name: string
  description: string
  author: SkillHubAuthor | string
  version: string
  downloadCount?: number
  starCount?: number
  category?: string
  tags?: string[]
  iconUrl?: string
  homepageUrl?: string
  createdAt?: string
  updatedAt?: string
}

interface SkillHubSearchResult {
  slug: string
  name: string
  description: string
  author: SkillHubAuthor | string
  version: string
  downloadCount?: number
  starCount?: number
  category?: string
  tags?: string[]
  iconUrl?: string
  homepageUrl?: string
}

interface SkillHubSearchResponse {
  results: SkillHubSearchResult[]
  total: number
  page: number
  limit: number
}

interface SkillHubSkillDetail {
  slug: string
  name: string
  description: string
  author: SkillHubAuthor | string
  version: string
  downloadCount?: number
  starCount?: number
  category?: string
  tags?: string[]
  iconUrl?: string
  homepageUrl?: string
  content?: string
  manifest?: Record<string, unknown>
}

// ─── Adapter ─────────────────────────────────────────────────────────────

export class SkillHubAdapter implements SkillRegistryAdapter {
  readonly registryId: string
  readonly registryName = 'SkillHub'
  private readonly apiBaseUrl: string
  private readonly headers: Record<string, string>

  constructor(config: SkillRegistryAdapterConfig) {
    this.registryId = config.registryId
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '')

    this.headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }

    // 从 configJson 解析额外配置（API Key 等）
    try {
      const parsed = JSON.parse(config.configJson || '{}')
      if (parsed.apiKey && typeof parsed.apiKey === 'string') {
        this.headers['Authorization'] = `Bearer ${parsed.apiKey}`
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
    const limit = options?.limit ?? 20
    const page = Math.floor((options?.offset ?? 0) / limit) + 1

    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (options?.category && options.category !== '全部') {
      params.set('category', options.category)
    }

    const url = `${this.apiBaseUrl}/api/v1/search?${params.toString()}`

    try {
      const res = await this.fetchJson<SkillHubSearchResponse>(url)

      const skills = (res.results ?? []).map((s) => this.toRemoteSkillItem(s))
      return {
        skills,
        total: res.total ?? skills.length,
      }
    } catch (err) {
      // If the API is unreachable, return empty results instead of throwing
      console.warn(`[SkillHub] search failed: ${err instanceof Error ? err.message : err}`)
      return { skills: [], total: 0 }
    }
  }

  // ─── featured ─────────────────────────────────────────────────────────

  async featured(limit?: number): Promise<RemoteSkillItem[]> {
    const params = new URLSearchParams()
    params.set('limit', String(limit ?? 12))
    params.set('page', '1')
    // Sort by star count for featured results
    params.set('sort', 'stars')

    const url = `${this.apiBaseUrl}/api/v1/search?${params.toString()}`

    try {
      const res = await this.fetchJson<SkillHubSearchResponse>(url)
      return (res.results ?? []).map((s) => this.toRemoteSkillItem(s))
    } catch (err) {
      console.warn(`[SkillHub] featured failed: ${err instanceof Error ? err.message : err}`)
      return []
    }
  }

  // ─── categories ───────────────────────────────────────────────────────

  async categories(): Promise<string[]> {
    return [
      '全部',
      '代码生成',
      '代码审查',
      '测试',
      '文档',
      '数据分析',
      'Web 开发',
      'API 开发',
      'DevOps',
      '安全',
      'AI/ML',
      '自动化',
      '数据库',
      '前端',
      '后端',
      'Prompt 工程',
    ]
  }

  // ─── fetchManifest ────────────────────────────────────────────────────

  async fetchManifest(manifestUrl: string): Promise<string> {
    // manifestUrl is the skill detail URL or download URL
    // Try fetching the skill detail first
    try {
      const slug = this.extractSlug(manifestUrl)
      if (slug) {
        const detailUrl = `${this.apiBaseUrl}/api/v1/skills/${slug}`
        const detail = await this.fetchJson<SkillHubSkillDetail>(detailUrl)

        // If the detail contains content (SKILL.md body), wrap it
        if (detail.content) {
          return JSON.stringify({
            name: detail.name,
            version: detail.version,
            description: detail.description,
            author: typeof detail.author === 'string' ? detail.author : detail.author.displayName ?? detail.author.handle,
            format: 'skill-md',
            content: detail.content,
            category: detail.category,
            tags: detail.tags,
            tools: [],
          })
        }

        // If manifest exists, return it
        if (detail.manifest) {
          return JSON.stringify(detail.manifest)
        }
      }
    } catch {
      // Fall through to direct fetch
    }

    // Direct fetch as fallback
    const res = await globalThis.fetch(manifestUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`)
    }
    const text = await res.text()

    // If it's SKILL.md (Markdown), wrap as JSON manifest
    if (text.startsWith('#') || text.startsWith('---')) {
      return JSON.stringify({
        name: 'skillhub-skill',
        version: '1.0.0',
        description: text.slice(0, 200),
        author: 'SkillHub',
        format: 'skill-md',
        content: text,
        tools: [],
      })
    }

    return text
  }

  // ─── healthCheck ──────────────────────────────────────────────────────

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    try {
      const url = `${this.apiBaseUrl}/api/v1/search?limit=1`
      const res = await globalThis.fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      })
      const latencyMs = Date.now() - start

      if (!res.ok) {
        return { healthy: false, latencyMs, error: `HTTP ${res.status}` }
      }

      return { healthy: true, latencyMs }
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private toRemoteSkillItem(skill: SkillHubSearchResult | SkillHubSkill): RemoteSkillItem {
    const authorName = typeof skill.author === 'string'
      ? skill.author
      : skill.author.displayName ?? skill.author.handle

    // Estimate rating from starCount: min(5.0, max(1.0, 3.0 + starCount/50))
    const stars = skill.starCount ?? 0
    const normalizedRating = Math.min(5.0, Math.max(1.0, 3.0 + stars / 50))

    const slug = skill.slug
    const detailUrl = `${this.apiBaseUrl}/api/v1/skills/${slug}`
    const homepageUrl = skill.homepageUrl ?? `${this.apiBaseUrl.replace('/api/v1', '')}/skills/${slug}`

    return createRemoteSkillItem({
      id: `${this.registryId}:${slug}`,
      name: skill.name,
      description: skill.description || '',
      version: skill.version ?? '1.0.0',
      author: authorName,
      registryId: this.registryId,
      registryName: this.registryName,
      category: skill.category ?? '代码生成',
      tags: skill.tags ?? this.inferTags(skill),
      rating: Math.round(normalizedRating * 10) / 10,
      downloadCount: skill.downloadCount ?? stars * 8,
      homepageUrl,
      manifestUrl: detailUrl,
      ...(skill.iconUrl != null ? { iconUrl: skill.iconUrl } : {}),
    })
  }

  private extractSlug(url: string): string | null {
    // Try to extract slug from URLs like:
    // https://skillhub.cn/api/v1/skills/my-skill
    // https://skillhub.cn/skills/my-skill
    const match = url.match(/\/skills\/([^/?#]+)/)
    return match?.[1] ?? null
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await globalThis.fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('SkillHub API rate limit exceeded.')
      }
      throw new Error(`SkillHub API error: ${res.status} ${res.statusText}`)
    }

    return res.json() as Promise<T>
  }

  /** Infer tags from skill name/description when tags are not provided */
  private inferTags(skill: { name: string; description: string }): string[] {
    const tags: string[] = []
    const text = `${skill.name} ${skill.description}`.toLowerCase()

    if (text.includes('code') || text.includes('代码')) tags.push('code')
    if (text.includes('review') || text.includes('审查')) tags.push('review')
    if (text.includes('test') || text.includes('测试')) tags.push('testing')
    if (text.includes('doc') || text.includes('文档')) tags.push('documentation')
    if (text.includes('api')) tags.push('api')
    if (text.includes('deploy') || text.includes('部署')) tags.push('deployment')
    if (text.includes('security') || text.includes('安全')) tags.push('security')
    if (text.includes('data') || text.includes('数据')) tags.push('data')
    if (text.includes('ai') || text.includes('人工智能')) tags.push('ai')
    if (text.includes('prompt')) tags.push('prompt')

    if (tags.length === 0) tags.push('skill')
    return tags.slice(0, 5)
  }
}
