import { describe, expect, it } from 'vitest'
import type { SkillItem } from '@spark/protocol'
import { MANAGED_SKILLS_PLUGIN_NAME, buildNativeSkillsFilter } from './native-skill-filter.js'

function makeSkill(overrides: Partial<SkillItem> & { id: string; name: string }): SkillItem {
  return {
    scope: 'user',
    version: '1.0.0',
    rootPath: '/tmp/skills/x',
    manifestJson: '',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeConfig(input: {
  skills: SkillItem[]
  agentSkillIds?: string[]
  effectiveSkillIds: string[]
}) {
  return {
    skills: input.skills,
    systemSkillIds: input.skills.map((s) => s.id),
    agentSkillIds: input.agentSkillIds ?? [],
    projectSkillIds: [],
    sessionSkillIds: [],
    agentDisabledSkillIds: [],
    projectDisabledSkillIds: [],
    sessionDisabledSkillIds: [],
    effectiveSkillIds: input.effectiveSkillIds,
  }
}

describe('buildNativeSkillsFilter', () => {
  it('agent 未配置技能 → all（回退全量，与历史行为一致）', () => {
    const cfg = makeConfig({
      skills: [makeSkill({ id: 'builtin:echarts', name: 'ECharts' })],
      effectiveSkillIds: ['builtin:echarts'],
    })
    expect(buildNativeSkillsFilter(cfg)).toBe('all')
  })

  it('白名单模式 → 生效技能的多形态冗余名单（name / plugin:name / plugin:目录名）', () => {
    const echarts = makeSkill({ id: 'builtin:echarts', name: 'ECharts' })
    const withSpace = makeSkill({ id: 'user-skill-1', name: 'My Cool Skill!' })
    const cfg = makeConfig({
      skills: [echarts, withSpace, makeSkill({ id: 'user-skill-2', name: 'Other' })],
      agentSkillIds: ['builtin:echarts', 'user-skill-1'],
      effectiveSkillIds: ['builtin:echarts', 'user-skill-1'],
    })
    const filter = buildNativeSkillsFilter(cfg)
    expect(Array.isArray(filter)).toBe(true)
    const names = filter as string[]
    // frontmatter name
    expect(names).toContain('ECharts')
    expect(names).toContain('My Cool Skill!')
    // plugin 限定形态
    expect(names).toContain(`${MANAGED_SKILLS_PLUGIN_NAME}:ECharts`)
    expect(names).toContain(`${MANAGED_SKILLS_PLUGIN_NAME}:My Cool Skill!`)
    // 目录名形态（sanitize 后空格转连字符）
    expect(names).toContain(`${MANAGED_SKILLS_PLUGIN_NAME}:My-Cool-Skill`)
    // 未生效技能不进名单
    expect(names.some((n) => n.includes('Other'))).toBe(false)
    // 名单去重
    expect(new Set(names).size).toBe(names.length)
  })

  it('白名单模式但生效集为空（显式清空）→ 空数组 = 关闭全部原生技能', () => {
    const cfg = makeConfig({
      skills: [makeSkill({ id: 'builtin:echarts', name: 'ECharts' })],
      effectiveSkillIds: [],
    })
    expect(buildNativeSkillsFilter(cfg)).toEqual([])
  })

  it('生效 id 在 skills 目录中缺失（虚拟技能）→ 安全跳过', () => {
    const cfg = makeConfig({
      skills: [makeSkill({ id: 'builtin:echarts', name: 'ECharts' })],
      agentSkillIds: ['builtin:echarts', 'ghost'],
      effectiveSkillIds: ['builtin:echarts', 'ghost'],
    })
    const names = buildNativeSkillsFilter(cfg) as string[]
    expect(names.some((n) => n.includes('ECharts'))).toBe(true)
    expect(names.filter((n) => n === 'ghost' || n.endsWith(':ghost')).length).toBe(0)
  })
})
