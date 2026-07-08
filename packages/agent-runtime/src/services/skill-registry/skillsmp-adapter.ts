/**
 * @module skill-registry/skillsmp-adapter
 *
 * SkillsMP Adapter — 对接 skillsmp.com 公开 API
 *
 * SkillsMP 是最大的 Agent Skills 聚合市场，索引了 GitHub 上 1.2M+ Skills。
 * API 文档：https://skillsmp.com/api/v1
 *
 * 速率限制：
 *   - 匿名：50 次/天
 *   - 认证：500 次/天
 *   - 频率：10-30 次/分钟
 */

import type { RemoteSkillItem } from '@spark/protocol'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { createRemoteSkillItem } from './adapter.js'

// ─── API Response Types ─────────────────────────────────────────────────

interface SkillsMPSkill {
  id: string
  name: string
  author: string
  description: string
  githubUrl: string
  skillUrl: string
  stars: number
  updatedAt: string
  /** 可能存在的额外字段 */
  category?: string
  tags?: string[]
  version?: string
  iconUrl?: string
}

interface SkillsMPPagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

interface SkillsMPSearchResponse {
  success: boolean
  data: {
    skills: SkillsMPSkill[]
    pagination: SkillsMPPagination
    filters?: Record<string, unknown>
    meta?: Record<string, unknown>
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────

export class SkillsMPAdapter implements SkillRegistryAdapter {
  readonly registryId: string
  readonly registryName = 'SkillsMP'
  private readonly apiBaseUrl: string
  private readonly apiKey: string
  private readonly headers: Record<string, string>

  constructor(config: SkillRegistryAdapterConfig) {
    this.registryId = config.registryId
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '')

    // 从 configJson 解析 API Key（可选）
    let parsedConfig: Record<string, unknown> = {}
    try {
      parsedConfig = JSON.parse(config.configJson || '{}')
    } catch {
      // ignore parse errors
    }
    this.apiKey = (parsedConfig.apiKey as string) ?? ''

    this.headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      this.headers['Authorization'] = `Bearer ${this.apiKey}`
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
    params.set('sortBy', 'stars')
    if (options?.category && options.category !== '全部') {
      params.set('category', options.category)
    }

    const url = `${this.apiBaseUrl}/skills/search?${params.toString()}`
    const res = await this.fetchJson<SkillsMPSearchResponse>(url)

    if (!res.success || !res.data) {
      return { skills: [], total: 0 }
    }

    const skills = res.data.skills.map((s) => this.toRemoteSkillItem(s))
    return {
      skills,
      total: res.data.pagination?.total ?? skills.length,
    }
  }

  // ─── featured ─────────────────────────────────────────────────────────

  async featured(limit?: number, _section?: unknown): Promise<RemoteSkillItem[]> {
    const params = new URLSearchParams()
    params.set('sortBy', 'stars')
    params.set('limit', String(limit ?? 12))
    params.set('page', '1')

    const url = `${this.apiBaseUrl}/skills/search?${params.toString()}`
    const res = await this.fetchJson<SkillsMPSearchResponse>(url)

    if (!res.success || !res.data) {
      return []
    }

    return res.data.skills.map((s) => this.toRemoteSkillItem(s))
  }

  // ─── categories ───────────────────────────────────────────────────────

  async categories(): Promise<Array<{ key: string; name: string }>> {
    // SkillsMP 已知分类列表（API 可能不提供单独的分类端点）
    // 使用搜索结果的 filters 或硬编码已知分类
    return [
      { key: 'all', name: '全部' },
      'code-generation',
      'code-review',
      'testing',
      'documentation',
      'data-analysis',
      'web-development',
      'api-development',
      'devops',
      'security',
      'ai-ml',
      'automation',
      'database',
      'frontend',
      'backend',
    ].map((c) => (typeof c === 'string' ? { key: c, name: c } : c))
  }

  // ─── fetchManifest ────────────────────────────────────────────────────

  async fetchManifest(manifestUrl: string): Promise<string> {
    // SkillsMP Skills 基于 SKILL.md 标准
    // manifestUrl 指向 skill 详情页或 GitHub raw 内容
    const res = await globalThis.fetch(manifestUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    // 如果返回的是 SKILL.md (Markdown)，包装为 JSON manifest
    if (text.startsWith('#') || text.startsWith('---')) {
      return JSON.stringify({
        name: 'skillsmp-skill',
        version: '1.0.0',
        description: text.slice(0, 200),
        author: 'SkillsMP',
        format: 'skill-md',
        content: text,
        tools: [],
      })
    }
    // 如果已经是 JSON，直接返回
    return text
  }

  // ─── healthCheck ──────────────────────────────────────────────────────

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    try {
      const url = `${this.apiBaseUrl}/skills/search?limit=1`
      const res = await globalThis.fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      })
      const latencyMs = Date.now() - start

      if (!res.ok) {
        return { healthy: false, latencyMs, error: `HTTP ${res.status}` }
      }

      const data = await res.json() as { success?: boolean }
      if (data.success === false) {
        return { healthy: false, latencyMs, error: 'API returned success=false' }
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

  private toRemoteSkillItem(skill: SkillsMPSkill): RemoteSkillItem {
    // SkillsMP 没有 rating 和 downloadCount 的直接映射
    // 用 stars 近似：rating = min(5.0, 3.0 + stars/100)，downloadCount ≈ stars * 10
    const normalizedRating = Math.min(5.0, Math.max(1.0, 3.0 + skill.stars / 100))
    const estimatedDownloads = skill.stars * 10

    return createRemoteSkillItem({
      id: `${this.registryId}:${skill.id}`,
      name: skill.name,
      description: skill.description || '',
      version: skill.version ?? '1.0.0',
      author: skill.author || 'Unknown',
      registryId: this.registryId,
      registryName: this.registryName,
      category: skill.category ?? this.inferCategoryFromUrl(skill.githubUrl),
      tags: skill.tags ?? this.inferTagsFromSkill(skill),
      rating: Math.round(normalizedRating * 10) / 10,
      downloadCount: estimatedDownloads,
      homepageUrl: skill.githubUrl || skill.skillUrl,
      manifestUrl: skill.skillUrl || skill.githubUrl,
      ...(skill.iconUrl != null ? { iconUrl: skill.iconUrl } : {}),
    })
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await globalThis.fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('SkillsMP API rate limit exceeded. Consider adding an API key.')
      }
      throw new Error(`SkillsMP API error: ${res.status} ${res.statusText}`)
    }

    return res.json() as Promise<T>
  }

  /** 从 GitHub URL 推断分类 */
  private inferCategoryFromUrl(githubUrl: string): string {
    const lower = (githubUrl || '').toLowerCase()
    if (lower.includes('test')) return 'testing'
    if (lower.includes('doc')) return 'documentation'
    if (lower.includes('security')) return 'security'
    if (lower.includes('data') || lower.includes('analys')) return 'data-analysis'
    if (lower.includes('deploy') || lower.includes('devops') || lower.includes('docker')) return 'devops'
    if (lower.includes('api')) return 'api-development'
    if (lower.includes('frontend') || lower.includes('react') || lower.includes('vue')) return 'frontend'
    return 'code-generation'
  }

  /** 从 Skill 数据推断标签 */
  private inferTagsFromSkill(skill: SkillsMPSkill): string[] {
    const tags: string[] = []
    const nameDesc = `${skill.name} ${skill.description}`.toLowerCase()

    if (nameDesc.includes('code')) tags.push('code')
    if (nameDesc.includes('review')) tags.push('review')
    if (nameDesc.includes('test')) tags.push('testing')
    if (nameDesc.includes('doc')) tags.push('documentation')
    if (nameDesc.includes('api')) tags.push('api')
    if (nameDesc.includes('deploy')) tags.push('deployment')
    if (nameDesc.includes('security')) tags.push('security')
    if (nameDesc.includes('data')) tags.push('data')

    // 至少保留一个标签
    if (tags.length === 0) tags.push('skill')
    return tags.slice(0, 5)
  }
}
