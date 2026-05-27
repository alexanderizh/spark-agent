/**
 * @module skills/skill-loader
 *
 * SkillLoader — 统一的 Skill 加载、查询和管理
 *
 * 职责：
 *   1. 管理内置 Skill 定义
 *   2. 从数据库加载已安装的 Skill
 *   3. 解析 Skill 的 manifest 并构建完整定义
 *   4. 为 AgentLoop 提供 system prompt 注入
 */

import type { SkillItem } from '@spark/protocol'
import type { SkillRepository } from '@spark/storage'
import type { SkillDefinition } from './types.js'
import { buildSkillSystemPrompt } from './types.js'
import { BUILTIN_SKILLS, getBuiltinSkill } from './builtin/index.js'

/** SkillLoader 查询结果 */
export interface SkillInfo {
  /** 是否为内置 Skill */
  builtin: boolean
  /** Skill 定义（内置 Skill 有完整定义，安装的 Skill 可能只有 manifest 信息） */
  definition: SkillDefinition | null
  /** 数据库记录（已安装的 Skill） */
  dbRecord: SkillItem | null
}

export class SkillLoader {
  constructor(private readonly repo: SkillRepository) {}

  /**
   * 列出所有可用 Skill（内置 + 已安装）
   */
  listAll(): SkillInfo[] {
    const builtinInfos: SkillInfo[] = BUILTIN_SKILLS.map((def) => ({
      builtin: true,
      definition: def,
      dbRecord: null,
    }))

    const installedRows = this.repo.list()
    const installedInfos: SkillInfo[] = installedRows
      .filter((row) => !row.id.startsWith('builtin:'))
      .map((row) => ({
        builtin: false,
        definition: this.parseManifestAsDefinition(row),
        dbRecord: toSkillItem(row),
      }))

    return [...builtinInfos, ...installedInfos]
  }

  /**
   * 获取指定 Skill 的信息
   */
  getSkill(skillId: string): SkillInfo | null {
    // 先查内置
    const builtin = getBuiltinSkill(skillId)
    if (builtin) {
      return { builtin: true, definition: builtin, dbRecord: null }
    }

    // 再查数据库
    const row = this.repo.get(skillId)
    if (!row) return null

    return {
      builtin: false,
      definition: this.parseManifestAsDefinition(row),
      dbRecord: toSkillItem(row),
    }
  }

  /**
   * 获取已启用的 Skill 列表
   */
  listEnabled(): SkillInfo[] {
    const builtinInfos: SkillInfo[] = BUILTIN_SKILLS.map((def) => ({
      builtin: true,
      definition: def,
      dbRecord: null,
    }))

    const installedRows = this.repo.list()
    const enabledInstalled: SkillInfo[] = installedRows
      .filter((row) => !row.id.startsWith('builtin:') && row.enabled === 1)
      .map((row) => ({
        builtin: false,
        definition: this.parseManifestAsDefinition(row),
        dbRecord: toSkillItem(row),
      }))

    // 内置 Skill 中，在数据库有记录的检查 enabled 状态
    const result: SkillInfo[] = []
    for (const info of builtinInfos) {
      const dbRow = this.repo.get(info.definition!.id)
      if (dbRow && dbRow.enabled === 0) continue // 被用户禁用的内置 Skill
      result.push(info)
    }

    return [...result, ...enabledInstalled]
  }

  /**
   * 为指定 Skill 构建 system prompt
   *
   * @param skillId Skill ID
   * @param userParams 用户参数
   * @returns 完整的 system prompt，如果 Skill 不存在返回 null
   */
  buildSystemPrompt(skillId: string, userParams: Record<string, unknown> = {}): string | null {
    const info = this.getSkill(skillId)
    if (!info?.definition) return null

    return buildSkillSystemPrompt(info.definition, userParams)
  }

  /**
   * 获取 Skill 所需的工具列表
   */
  getRequiredTools(skillId: string): string[] {
    const info = this.getSkill(skillId)
    return info?.definition?.requiredTools ?? []
  }

  /**
   * 搜索 Skill（按名称、描述、标签匹配）
   */
  search(query: string): SkillInfo[] {
    const q = query.toLowerCase().trim()
    if (!q) return this.listAll()

    return this.listAll().filter((info) => {
      const def = info.definition
      const db = info.dbRecord
      return (
        (def?.name.toLowerCase().includes(q)) ||
        (def?.description.toLowerCase().includes(q)) ||
        (def?.tags.some((t) => t.toLowerCase().includes(q))) ||
        (db?.name.toLowerCase().includes(q))
      )
    })
  }

  /**
   * 切换 Skill 启用/禁用状态
   */
  toggleSkill(skillId: string): boolean {
    const row = this.repo.get(skillId)
    if (!row) return false

    this.repo.update(skillId, { enabled: row.enabled === 0 })
    return true
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * 尝试从 manifestJson 解析出 SkillDefinition
   * 对于从市场安装的 Skill，manifest 可能包含 systemPrompt 等信息
   */
  private parseManifestAsDefinition(row: {
    id: string
    name: string
    manifest_json: string
    version: string
  }): SkillDefinition | null {
    try {
      const manifest = JSON.parse(row.manifest_json)
      return {
        id: row.id,
        name: row.name,
        description: manifest.desc ?? manifest.description ?? '',
        version: row.version,
        author: manifest.author ?? 'Unknown',
        category: (manifest.category ?? 'utility') as SkillDefinition['category'],
        icon: manifest.icon,
        tags: manifest.tags ?? [],
        systemPrompt: manifest.systemPrompt ?? '',
        requiredTools: manifest.requiredTools ?? manifest.tools ?? [],
        parameters: manifest.parameters ?? [],
      }
    } catch {
      return null
    }
  }
}

// ─── Mapper ────────────────────────────────────────────────────────────

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
