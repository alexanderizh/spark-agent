/**
 * SkillLoader + builtin skills unit tests
 *
 * 注意：内置 skill 定义已全部迁移到 resources/skills/ 目录以文件形式存储，
 * 硬编码的 BUILTIN_SKILLS 数组保留为空仅作模块兼容。已安装的 skill 通过
 * SkillLoader 从 DB（manifest）加载。本测试反映迁移后的现状：
 *   - BUILTIN_SKILLS 为空数组
 *   - getBuiltinSkill 对任何 id 返回 undefined（skill 现在在文件系统/DB）
 *   - buildSkillSystemPrompt（纯函数）行为不变
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_SKILLS, getBuiltinSkill } from '../../skills/builtin/index.js'
import { buildSkillSystemPrompt } from '../../skills/types.js'
import type { SkillDefinition } from '../../skills/types.js'

describe('Builtin Skills (migrated to filesystem)', () => {
  it('BUILTIN_SKILLS is an empty array after migration', () => {
    // skills 迁移到 resources/skills/ 后，硬编码数组清空（仅保留模块兼容）
    expect(Array.isArray(BUILTIN_SKILLS)).toBe(true)
    expect(BUILTIN_SKILLS).toHaveLength(0)
  })

  it('getBuiltinSkill returns undefined for any id (skills now live in filesystem/DB)', () => {
    expect(getBuiltinSkill('builtin:code-review')).toBeUndefined()
    expect(getBuiltinSkill('builtin:translate')).toBeUndefined()
    expect(getBuiltinSkill('builtin:nonexistent')).toBeUndefined()
    expect(getBuiltinSkill('')).toBeUndefined()
  })
})

describe('buildSkillSystemPrompt', () => {
  const testDef: SkillDefinition = {
    id: 'test:mock',
    name: 'Test Skill',
    description: 'A test skill',
    version: '1.0.0',
    author: 'Test',
    category: 'utility',
    tags: ['test'],
    systemPrompt: 'You are {{role}}. Focus on {{focus}}.',
    requiredTools: [],
    parameters: [
      { name: 'role', type: 'string', label: 'Role', defaultValue: 'an assistant' },
      { name: 'focus', type: 'string', label: 'Focus', defaultValue: 'everything' },
    ],
  }

  it('should replace parameter placeholders with defaults', () => {
    const prompt = buildSkillSystemPrompt(testDef, {})
    expect(prompt).toBe('You are an assistant. Focus on everything.')
  })

  it('should use user params over defaults', () => {
    const prompt = buildSkillSystemPrompt(testDef, { role: 'a reviewer' })
    expect(prompt).toBe('You are a reviewer. Focus on everything.')
  })

  it('should replace all user params', () => {
    const prompt = buildSkillSystemPrompt(testDef, { role: 'a tester', focus: 'bugs' })
    expect(prompt).toBe('You are a tester. Focus on bugs.')
  })

  it('should leave unreplaced placeholders when parameters not defined', () => {
    const def: SkillDefinition = {
      ...testDef,
      systemPrompt: 'Hello {{name}}, welcome to {{place}}.',
      parameters: [],
    }
    const prompt = buildSkillSystemPrompt(def, {})
    expect(prompt).toBe('Hello {{name}}, welcome to {{place}}.')
  })
})
