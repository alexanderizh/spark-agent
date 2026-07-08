import type { SkillRepository, SkillRow } from '@spark/storage'
import type { LocalSkillCandidate, SkillItem } from '@spark/protocol'
import { SkillLoader } from '../skills/skill-loader.js'
import { BUILTIN_SKILLS } from '../skills/builtin/index.js'
import { buildSkillSystemPrompt } from '../skills/types.js'
import type { SkillDefinition } from '../skills/types.js'
import {
  detectLocalSkills as detectLocalSkillCandidates,
  detectBundledSkills,
  importLocalSkillDirectory,
  importLocalSkillFile,
  type LocalSkillSource,
} from './local-skill-importer.js'

export class SkillService {
  private readonly loader: SkillLoader

  constructor(
    private readonly repo: SkillRepository,
    /** 应用内置 skills 目录路径（从 AppSkillsManager.bundledDir 传入） */
    private readonly bundledSkillsDir?: string,
  ) {
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

  /**
   * 清理重复的「宿主软链」技能行（local:linked:*）：
   *   - 与任意非软链技能（内置 / 市场 / 本地导入 / 用户创建）同名 → 删除软链行
   *   - 多个软链技能同名 → 仅保留一个
   *
   * 只删除 local:linked:* 行，绝不动内置/市场/手动导入，避免破坏既有绑定。
   * 用于消除「宿主自动软链导入」与既有技能/彼此之间的重复（数量虚高问题）。
   *
   * @returns 删除的行数
   */
  pruneDuplicateLinkedSkills(): number {
    const rows = this.repo.list()
    const nonLinkedNames = new Set(
      rows
        .filter((r) => !r.id.startsWith('local:linked:'))
        .map((r) => r.name.trim().toLowerCase()),
    )
    const seenLinked = new Set<string>()
    let removed = 0
    for (const row of rows) {
      if (!row.id.startsWith('local:linked:')) continue
      const key = row.name.trim().toLowerCase()
      if (nonLinkedNames.has(key) || seenLinked.has(key)) {
        this.repo.deleteById(row.id)
        removed += 1
      } else {
        seenLinked.add(key)
      }
    }
    return removed
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

  /**
   * 导入单个文件作为 Skill（SKILL.md 或 Markdown 文件）
   */
  importFile(filePath: string): SkillItem {
    const payload = importLocalSkillFile(filePath)
    const existing = this.repo.get(payload.id)
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
   * 两个来源：
   *   1. 文件系统内置技能（resources/skills/ 目录下的 SKILL.md + manifest.json）
   *   2. 硬编码 TS 定义（platform-manager 等纯代码驱动的技能）
   *
   * 对于文件系统技能，每次启动时重新从文件读取最新内容并更新到数据库，
   * 保证应用更新后技能内容也会同步更新。
   */
  ensureBuiltInSkills(): SkillItem[] {
    // ── 0. 收集所有当前有效的内置 Skill ID ────────────────────────────────
    const validIds = new Set<string>()

    // 来自文件系统
    if (this.bundledSkillsDir) {
      for (const candidate of detectBundledSkills(this.bundledSkillsDir)) {
        validIds.add(candidate.id)
      }
    }
    // 来自 TS 硬编码
    for (const def of BUILTIN_SKILLS) {
      validIds.add(def.id)
    }

    // ── 1. 清理数据库中已不存在的内置/旧格式记录 ────────────────────────
    const allRows = this.repo.list()
    for (const row of allRows) {
      const shouldRemove =
        // 旧的 local:bundled:* 格式（ID 迁移前的残留）
        (row.id.startsWith('local:bundled:') && row.root_path.includes('/resources/skills/')) ||
        // 旧的 local:claude:* 格式指向 bundled 目录
        (row.id.startsWith('local:claude:') && row.root_path.includes('/resources/skills/')) ||
        // builtin:* 记录但不再有对应的文件或 TS 定义
        (row.id.startsWith('builtin:') && !validIds.has(row.id))
      if (shouldRemove) {
        this.repo.deleteById(row.id)
      }
    }

    // ── 3. 从文件系统加载内置技能 ──────────────────────────────────────
    if (this.bundledSkillsDir) {
      const candidates = detectBundledSkills(this.bundledSkillsDir)
      for (const candidate of candidates) {
        try {
          const payload = importLocalSkillDirectory(candidate.rootPath, 'bundled')
          const existing = this.repo.get(payload.id)
          if (existing != null) {
            // 已存在 → 更新内容（应用升级后技能文件可能变化）
            this.repo.update(existing.id, {
              name: payload.name,
              version: payload.version,
              rootPath: payload.rootPath,
              manifestJson: payload.manifestJson,
            })
          } else {
            this.repo.create(payload)
          }
        } catch (err) {
          // 内置技能加载失败不应阻塞启动，记录日志即可
          console.warn(`[SkillService] Failed to load bundled skill from ${candidate.rootPath}:`, err)
        }
      }
    }

    // ── 4. 从硬编码 TS 定义加载（已全部迁移到文件系统，此处为空循环） ──
    for (const def of BUILTIN_SKILLS) {
      const existing = this.repo.get(def.id)
      if (existing != null) {
        // 已存在 → 更新（代码升级后内容可能变化）
        this.repo.update(def.id, {
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
        })
        continue
      }
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
