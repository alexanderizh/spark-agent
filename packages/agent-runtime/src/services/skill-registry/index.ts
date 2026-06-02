/**
 * @module skill-registry/service
 *
 * Skill Registry Service — Skill 市场源管理 + 搜索/安装/卸载
 */

import crypto from 'node:crypto'
import type {
  RemoteSkillItem,
  SkillItem,
  SkillRegistry,
} from '@spark/protocol'
import type { SparkDatabase } from '@spark/storage'
import {
  SkillRegistryRepository,
  SkillRepository,
} from '@spark/storage'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { MockSkillRegistryAdapter } from './mock-adapter.js'
import { SkillHubAdapter } from './skillhub-adapter.js'
import { SkillsMPAdapter } from './skillsmp-adapter.js'

export class SkillRegistryService {
  private registryRepo: SkillRegistryRepository
  private skillRepo: SkillRepository
  private adapters = new Map<string, SkillRegistryAdapter>()

  constructor(private readonly db: SparkDatabase) {
    this.registryRepo = new SkillRegistryRepository(db)
    this.skillRepo = new SkillRepository(db)
  }

  /**
   * 初始化：确保默认市场源存在，并创建 Adapter 实例
   */
  initialize(): void {
    this.registryRepo.ensureDefaults()
    const registries = this.registryRepo.listEnabled()
    for (const reg of registries) {
      if (!this.adapters.has(reg.id)) {
        this.adapters.set(reg.id, this.createAdapter({
          registryId: reg.id,
          apiBaseUrl: reg.api_base_url,
          configJson: reg.config_json,
        }))
      }
    }
  }

  // ─── Registry CRUD ─────────────────────────────────────────────────

  listRegistries(): SkillRegistry[] {
    return this.registryRepo.list().map(toSkillRegistry)
  }

  updateRegistry(id: string, fields: { enabled?: boolean; configJson?: string }): SkillRegistry {
    const updateFields: Record<string, unknown> = {}
    if (fields.enabled !== undefined) updateFields.enabled = fields.enabled
    if (fields.configJson !== undefined) updateFields.configJson = fields.configJson

    const row = this.registryRepo.update(id, updateFields)
    if (row == null) throw new Error(`Registry not found: ${id}`)

    // 如果禁用，移除 adapter；如果启用，重新创建
    if (fields.enabled === false) {
      this.adapters.delete(id)
    } else if (fields.enabled === true && !this.adapters.has(id)) {
      this.adapters.set(id, this.createAdapter({
        registryId: row.id,
        apiBaseUrl: row.api_base_url,
        configJson: row.config_json,
      }))
    }

    return toSkillRegistry(row)
  }

  // ─── Search & Browse ───────────────────────────────────────────────

  /**
   * 跨市场搜索 Skill
   * 如果指定了 registryId，只搜索该市场；否则搜索所有启用的市场
   */
  async search(params: {
    query: string
    registryId?: string
    category?: string
    limit?: number
    offset?: number
  }): Promise<{ skills: RemoteSkillItem[]; total: number }> {
    const installedMap = this.buildInstalledMap()

    if (params.registryId) {
      const adapter = this.getAdapterOrThrow(params.registryId)
      const searchOptions: { category?: string; limit?: number; offset?: number } = {}
      if (params.category !== undefined) searchOptions.category = params.category
      if (params.limit !== undefined) searchOptions.limit = params.limit
      if (params.offset !== undefined) searchOptions.offset = params.offset
      const result = await adapter.search(params.query, searchOptions)
      return {
        skills: result.skills.map((s) => this.enrichWithInstallStatus(s, installedMap)),
        total: result.total,
      }
    }

    // 聚合所有市场
    const allAdapters = Array.from(this.adapters.values())
    const results = await Promise.allSettled(
      allAdapters.map((a) => {
        const searchOptions: { category?: string; limit?: number; offset?: number } = {}
        if (params.category !== undefined) searchOptions.category = params.category
        if (params.limit !== undefined) searchOptions.limit = params.limit
        if (params.offset !== undefined) searchOptions.offset = params.offset
        return a.search(params.query, searchOptions).catch(() => ({ skills: [] as RemoteSkillItem[], total: 0 }))
      }),
    )

    const allSkills: RemoteSkillItem[] = []
    let total = 0
    for (const r of results) {
      if (r.status === 'fulfilled') {
        allSkills.push(...r.value.skills)
        total += r.value.total
      }
    }

    // 按评分排序
    allSkills.sort((a, b) => b.rating - a.rating)

    const offset = params.offset ?? 0
    const limit = params.limit ?? 20
    const paged = allSkills.slice(offset, offset + limit)

    return {
      skills: paged.map((s) => this.enrichWithInstallStatus(s, installedMap)),
      total,
    }
  }

  /**
   * 获取热门/推荐 Skill
   */
  async featured(params: { registryId?: string; limit?: number }): Promise<RemoteSkillItem[]> {
    const installedMap = this.buildInstalledMap()

    if (params.registryId) {
      const adapter = this.getAdapterOrThrow(params.registryId)
      const skills = await adapter.featured(params.limit)
      return skills.map((s) => this.enrichWithInstallStatus(s, installedMap))
    }

    // 聚合所有市场
    const allAdapters = Array.from(this.adapters.values())
    const results = await Promise.allSettled(
      allAdapters.map((a) => a.featured(params.limit).catch(() => [] as RemoteSkillItem[])),
    )

    const allSkills: RemoteSkillItem[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') allSkills.push(...r.value)
    }

    allSkills.sort((a, b) => b.downloadCount - a.downloadCount)
    return allSkills.slice(0, params.limit ?? 12).map((s) => this.enrichWithInstallStatus(s, installedMap))
  }

  /**
   * 获取市场分类列表
   */
  async categories(registryId: string): Promise<string[]> {
    const adapter = this.getAdapterOrThrow(registryId)
    return adapter.categories()
  }

  // ─── Install / Uninstall ────────────────────────────────────────────

  /**
   * 从市场安装 Skill 到本地
   */
  async install(params: { remoteSkillId: string; registryId: string }): Promise<SkillItem> {
    const adapter = this.getAdapterOrThrow(params.registryId)

    // 搜索找到对应的 remote skill
    const searchResult = await adapter.search('')
    const remoteSkill = searchResult.skills.find((s) => s.id === params.remoteSkillId)
    if (!remoteSkill) {
      throw new Error(`Skill not found in registry: ${params.remoteSkillId}`)
    }

    // 检查是否已安装
    const existing = this.skillRepo.list().find(
      (s) => s.registry_id === params.registryId && s.remote_id === params.remoteSkillId,
    )
    if (existing) {
      throw new Error(`Skill already installed: ${existing.name}`)
    }

    // 获取 manifest
    const manifestJson = await adapter.fetchManifest(remoteSkill.manifestUrl)

    // 创建本地 Skill 记录
    const id = `skill:${crypto.randomUUID()}`
    const row = this.skillRepo.create({
      id,
      scope: 'user',
      name: remoteSkill.name,
      version: remoteSkill.version,
      rootPath: `registry://${params.registryId}/${remoteSkill.id}`,
      manifestJson: JSON.stringify({
        ...JSON.parse(manifestJson),
        desc: remoteSkill.description,
        source: remoteSkill.registryName,
        author: remoteSkill.author,
        category: remoteSkill.category,
        tags: remoteSkill.tags,
        homepage: remoteSkill.homepageUrl,
      }),
      enabled: true,
    })

    // 更新扩展字段
    const extendedFields: {
      registryId?: string | null
      remoteId?: string | null
      author?: string
      category?: string
      tagsJson?: string
      rating?: number
      downloadCount?: number
      homepageUrl?: string | null
      iconUrl?: string | null
    } = {
      registryId: params.registryId,
      remoteId: params.remoteSkillId,
      author: remoteSkill.author,
      category: remoteSkill.category,
      tagsJson: JSON.stringify(remoteSkill.tags),
      rating: remoteSkill.rating,
      downloadCount: remoteSkill.downloadCount,
    }
    if (remoteSkill.homepageUrl !== undefined) extendedFields.homepageUrl = remoteSkill.homepageUrl
    if (remoteSkill.iconUrl !== undefined) extendedFields.iconUrl = remoteSkill.iconUrl
    this.skillRepo.updateExtendedFields(id, extendedFields)

    // 更新 registry 的 last_sync_at
    this.registryRepo.update(params.registryId, { lastSyncAt: new Date().toISOString() })

    return toSkillItem(row)
  }

  /**
   * 卸载本地已安装的 Skill
   */
  uninstall(localSkillId: string): boolean {
    return this.skillRepo.deleteById(localSkillId)
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private getAdapterOrThrow(registryId: string): SkillRegistryAdapter {
    const adapter = this.adapters.get(registryId)
    if (!adapter) throw new Error(`Registry not available: ${registryId}`)
    return adapter
  }

  private createAdapter(config: SkillRegistryAdapterConfig): SkillRegistryAdapter {
    // 根据 registryId 分发到对应 Adapter
    switch (config.registryId) {
      case 'skillhub':
        return new SkillHubAdapter(config)
      case 'skillsmp':
        return new SkillsMPAdapter(config)
      default:
        // 未实现的 registry 类型使用 Mock Adapter
        return new MockSkillRegistryAdapter(config)
    }
  }

  private buildInstalledMap(): Map<string, string> {
    const map = new Map<string, string>() // remoteId → localId
    for (const row of this.skillRepo.list()) {
      if (row.remote_id) {
        // key 用 registry_id:remote_id 组合
        const key = `${row.registry_id}:${row.remote_id}`
        map.set(key, row.id)
      }
    }
    return map
  }

  private enrichWithInstallStatus(skill: RemoteSkillItem, installedMap: Map<string, string>): RemoteSkillItem {
    // remote skill 的 id 格式是 "registryId:xxx"
    const localId = installedMap.get(skill.id)
    const enriched: RemoteSkillItem = {
      ...skill,
      installed: localId != null,
    }
    if (localId !== undefined) enriched.localId = localId
    return enriched
  }
}

// ─── Row → Protocol Type Mappers ──────────────────────────────────────

function toSkillRegistry(row: {
  id: string
  name: string
  description: string
  icon_url: string | null
  api_base_url: string
  enabled: number
  type: string
  local_path: string | null
  last_sync_at: string | null
  created_at: string
  updated_at: string
}): SkillRegistry {
  const registry: SkillRegistry = {
    id: row.id,
    name: row.name,
    description: row.description,
    apiBaseUrl: row.api_base_url,
    enabled: row.enabled === 1,
    type: row.type as 'remote' | 'local',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.icon_url !== null) registry.iconUrl = row.icon_url
  if (row.local_path !== null) registry.localPath = row.local_path
  if (row.last_sync_at !== null) registry.lastSyncAt = row.last_sync_at
  return registry
}

function toSkillItem(row: {
  id: string
  scope: string
  name: string
  version: string
  root_path: string
  manifest_json: string
  enabled: number
  created_at: string
  updated_at: string
}): SkillItem {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    version: row.version,
    rootPath: row.root_path,
    manifestJson: row.manifest_json,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
