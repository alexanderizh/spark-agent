import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface SkillRegistryRow {
  id: string
  name: string
  description: string
  icon_url: string | null
  api_base_url: string
  enabled: number
  type: 'remote' | 'local'
  local_path: string | null
  last_sync_at: string | null
  config_json: string
  created_at: string
  updated_at: string
}

export class SkillRegistryRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'skill_registries')
  }

  list(): SkillRegistryRow[] {
    return this.raw
      .prepare('SELECT * FROM skill_registries ORDER BY created_at ASC')
      .all() as SkillRegistryRow[]
  }

  listEnabled(): SkillRegistryRow[] {
    return this.raw
      .prepare('SELECT * FROM skill_registries WHERE enabled = 1 ORDER BY created_at ASC')
      .all() as SkillRegistryRow[]
  }

  get(id: string): SkillRegistryRow | undefined {
    return this.findById<SkillRegistryRow>(id) ?? undefined
  }

  create(params: {
    id: string
    name: string
    description?: string
    iconUrl?: string
    apiBaseUrl: string
    enabled?: boolean
    type?: 'remote' | 'local'
    localPath?: string
    configJson?: string
  }): SkillRegistryRow {
    const now = new Date().toISOString()
    this.raw.prepare(`
      INSERT INTO skill_registries (id, name, description, icon_url, api_base_url, enabled, type, local_path, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.name,
      params.description ?? '',
      params.iconUrl ?? null,
      params.apiBaseUrl,
      params.enabled !== false ? 1 : 0,
      params.type ?? 'remote',
      params.localPath ?? null,
      params.configJson ?? '{}',
      now,
      now,
    )
    return this.get(params.id)!
  }

  update(id: string, fields: Partial<{
    name: string
    description: string
    iconUrl: string | null
    apiBaseUrl: string
    enabled: boolean
    localPath: string | null
    configJson: string
    lastSyncAt: string
  }>): SkillRegistryRow | undefined {
    const sets: string[] = []
    const vals: unknown[] = []

    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name) }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description) }
    if (fields.iconUrl !== undefined) { sets.push('icon_url = ?'); vals.push(fields.iconUrl) }
    if (fields.apiBaseUrl !== undefined) { sets.push('api_base_url = ?'); vals.push(fields.apiBaseUrl) }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0) }
    if (fields.localPath !== undefined) { sets.push('local_path = ?'); vals.push(fields.localPath) }
    if (fields.configJson !== undefined) { sets.push('config_json = ?'); vals.push(fields.configJson) }
    if (fields.lastSyncAt !== undefined) { sets.push('last_sync_at = ?'); vals.push(fields.lastSyncAt) }

    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    vals.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE skill_registries SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  override deleteById(id: string): boolean {
    return super.deleteById(id)
  }

  /**
   * 回填默认市场源。逐行按 id 幂等：仅当某条源不存在时才插入，
   * 已存在的行（含用户自定义 / 旧版本写入）一律保留不动。
   * 早期实现用「表里有任意行就整体跳过」做幂等，导致后续新增的默认源
   * 永远无法回填到老库（例如 skillhub），改为逐行 INSERT OR IGNORE。
   */
  ensureDefaults(): void {
    const defaults: Array<{
      id: string
      name: string
      description: string
      apiBaseUrl: string
      type: 'remote' | 'local'
    }> = [
      {
        id: 'skillhub',
        name: 'SkillHub',
        description: '面向中国用户的 AI Skills 社区，国内首选 Skills 源，内容走腾讯云 COS 加速',
        apiBaseUrl: 'https://api.skillhub.cn',
        type: 'remote',
      },
      {
        id: 'skillsmp',
        name: 'SkillsMP',
        description: 'Agent Skills 聚合市场，支持 Claude/Codex/ChatGPT Skills',
        apiBaseUrl: 'https://api.skillsmp.com/v1',
        type: 'remote',
      },
      {
        id: 'mcp-market',
        name: 'MCP Market',
        description: 'MCP Server 发现平台，含 AI Skill Store',
        apiBaseUrl: 'https://mcp.market/api/v1',
        type: 'remote',
      },
      {
        id: 'coze',
        name: '扣子 Coze',
        description: '字节跳动旗下，国内最大的 AI Skill 商店',
        apiBaseUrl: 'https://www.coze.com/api/v1',
        type: 'remote',
      },
      {
        id: 'claude-skills',
        name: 'Claude Skills',
        description: 'Anthropic 官方 Skills 规范',
        apiBaseUrl: 'https://api.anthropic.com/skills/v1',
        type: 'remote',
      },
    ]

    for (const d of defaults) {
      // 已存在的行保留不动；只补齐缺失项（含老库从未写入的 skillhub）。
      const existing = this.get(d.id)
      if (existing) continue
      this.create({
        id: d.id,
        name: d.name,
        description: d.description,
        apiBaseUrl: d.apiBaseUrl,
        type: d.type,
      })
    }
  }
}
