import type { SkillRepository, SkillRow } from '@spark/storage'
import type { LocalSkillCandidate, SkillItem } from '@spark/protocol'
import { SkillLoader } from '../skills/skill-loader.js'
import { BUILTIN_SKILLS } from '../skills/builtin/index.js'
import { buildSkillSystemPrompt } from '../skills/types.js'
import type { SkillDefinition } from '../skills/types.js'
import {
  detectLocalSkills as detectLocalSkillCandidates,
  importLocalSkillDirectory,
  type LocalSkillSource,
} from './local-skill-importer.js'

export class SkillService {
  private readonly loader: SkillLoader

  constructor(private readonly repo: SkillRepository) {
    this.loader = new SkillLoader(repo)
  }

  /** 获取 SkillLoader 实例（供 SDK executor 集成使用） */
  getLoader(): SkillLoader {
    return this.loader
  }

  listSkills(params?: { scope?: string }): SkillItem[] {
    return this.repo.list(params).map(toSkillItem)
  }

  createSkill(params: { id: string; scope: string; name: string; version: string; rootPath: string; manifestJson: string; enabled?: boolean }): SkillItem {
    return toSkillItem(this.repo.create(params))
  }

  updateSkill(id: string, fields: { name?: string; version?: string; rootPath?: string; manifestJson?: string; enabled?: boolean }): SkillItem {
    const row = this.repo.update(id, fields)
    if (row == null) throw new Error(`Skill not found: ${id}`)
    return toSkillItem(row)
  }

  deleteSkill(id: string): boolean {
    // 不允许删除内置 Skill
    if (id.startsWith('builtin:')) {
      throw new Error('Cannot delete built-in skill')
    }
    return this.repo.deleteById(id)
  }

  detectLocalSkills(searchRoots?: string[]): LocalSkillCandidate[] {
    const installedByRoot = new Map(this.repo.list().map((row) => [row.root_path, row.id]))
    return detectLocalSkillCandidates(searchRoots).map((candidate) => {
      const localSkillId = installedByRoot.get(candidate.rootPath)
      return {
        ...candidate,
        installed: localSkillId !== undefined,
        ...(localSkillId !== undefined ? { localSkillId } : {}),
      }
    })
  }

  importLocalDirectory(directoryPath: string, source?: LocalSkillSource): SkillItem {
    const payload = importLocalSkillDirectory(directoryPath, source)
    const existing = this.repo.get(payload.id) ?? this.repo.list().find((row) => row.root_path === payload.rootPath)
    if (existing != null) {
      const fields: { name: string; version: string; rootPath: string; manifestJson: string; enabled?: boolean } = {
        name: payload.name,
        version: payload.version,
        rootPath: payload.rootPath,
        manifestJson: payload.manifestJson,
      }
      if (payload.enabled !== undefined) fields.enabled = payload.enabled
      const row = this.repo.update(existing.id, fields)
      if (row == null) throw new Error(`Skill not found: ${existing.id}`)
      return toSkillItem(row)
    }

    return toSkillItem(this.repo.create(payload))
  }

  importBatchLocal(candidates: Array<{ rootPath: string; source: LocalSkillSource }>): { skills: SkillItem[]; failed: number; errors: string[] } {
    const skills: SkillItem[] = []
    const errors: string[] = []
    for (const c of candidates) {
      try {
        const skill = this.importLocalDirectory(c.rootPath, c.source)
        skills.push(skill)
      } catch (err) {
        errors.push(`${c.rootPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { skills, failed: errors.length, errors }
  }

  /**
   * 切换 Skill 启用/禁用状态
   */
  toggleSkill(id: string): SkillItem {
    const success = this.loader.toggleSkill(id)
    if (!success) throw new Error(`Skill not found: ${id}`)
    const row = this.repo.get(id)
    if (!row) throw new Error(`Skill not found: ${id}`)
    return toSkillItem(row)
  }

  /**
   * 获取 Skill 详情（包含完整定义）
   */
  getSkillDetail(id: string): SkillDetailResult | null {
    const info = this.loader.getSkill(id)
    if (!info) return null

    const item = info.dbRecord ?? this.getOrCreateBuiltinRecord(id)
    if (!item) return null

    return {
      item,
      definition: info.definition,
      builtin: info.builtin,
    }
  }

  /**
   * 搜索本地 Skill（内置 + 已安装）
   */
  searchSkills(query: string): SkillItem[] {
    return this.loader.search(query)
      .map((info) => info.dbRecord ?? this.getOrCreateBuiltinRecord(info.definition?.id ?? ''))
      .filter((item): item is SkillItem => item != null)
  }

  /**
   * 为指定 Skill 构建 system prompt
   */
  buildSkillSystemPrompt(skillId: string, userParams: Record<string, unknown> = {}): string | null {
    return buildSkillSystemPrompt(
      this.loader.getSkill(skillId)?.definition ?? {} as SkillDefinition,
      userParams,
    )
  }

  /**
   * 确保内置 Skill 存在于数据库中
   *
   * 使用 5 个完整的内置 Skill 定义替代原来的 3 个简化版本
   */
  ensureBuiltInSkills(): SkillItem[] {
    for (const def of BUILTIN_SKILLS) {
      if (this.repo.get(def.id) !== undefined) continue
      this.repo.create({
        id: def.id,
        scope: 'system',
        name: def.name,
        version: def.version,
        rootPath: `builtin://${def.id.slice('builtin:'.length)}`,
        manifestJson: JSON.stringify({
          desc: def.description,
          source: '内置',
          author: def.author,
          category: def.category,
          tags: def.tags,
          systemPrompt: def.systemPrompt,
          requiredTools: def.requiredTools,
          parameters: def.parameters,
        }),
        enabled: true,
      })
    }
    return this.listSkills()
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * 获取或创建内置 Skill 的 SkillItem 记录
   */
  private getOrCreateBuiltinRecord(id: string): SkillItem | null {
    const info = this.loader.getSkill(id)
    if (!info?.definition) return null

    // 如果数据库中已有记录
    if (info.dbRecord) return info.dbRecord

    // 返回虚拟记录（不写入数据库）
    const def = info.definition
    return {
      id: def.id,
      scope: 'system',
      name: def.name,
      version: def.version,
      rootPath: `builtin://${def.id.slice('builtin:'.length)}`,
      manifestJson: JSON.stringify({
        desc: def.description,
        source: '内置',
        author: def.author,
        category: def.category,
        tags: def.tags,
        systemPrompt: def.systemPrompt,
        requiredTools: def.requiredTools,
        parameters: def.parameters,
      }),
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
}

/** Skill 详情结果 */
export interface SkillDetailResult {
  item: SkillItem
  definition: SkillDefinition | null
  builtin: boolean
}

function toSkillItem(row: SkillRow): SkillItem {
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
