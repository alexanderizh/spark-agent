import type { SkillRepository, SkillRow } from '@spark/storage'
import type { SkillItem } from '@spark/protocol'

const BUILT_IN_SKILLS: Array<{
  id: string
  name: string
  desc: string
  enabled: boolean
}> = [
  { id: 'built-in:search', name: 'Web 搜索', desc: '使用搜索引擎查询信息', enabled: true },
  { id: 'built-in:calculator', name: '计算器', desc: '精确数学计算', enabled: true },
  { id: 'built-in:code-exec', name: '代码执行', desc: '在沙箱中运行代码片段', enabled: false },
]

export class SkillService {
  constructor(private readonly repo: SkillRepository) {}

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
    return this.repo.deleteById(id)
  }

  ensureBuiltInSkills(): SkillItem[] {
    for (const skill of BUILT_IN_SKILLS) {
      if (this.repo.get(skill.id) !== undefined) continue
      this.repo.create({
        id: skill.id,
        scope: 'system',
        name: skill.name,
        version: '1.0.0',
        rootPath: `builtin://${skill.id.slice('built-in:'.length)}`,
        manifestJson: JSON.stringify({
          desc: skill.desc,
          source: '内置',
        }),
        enabled: skill.enabled,
      })
    }
    return this.listSkills()
  }
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
