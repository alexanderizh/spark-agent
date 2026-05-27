/**
 * SkillLoader + builtin skills unit tests
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_SKILLS, getBuiltinSkill } from '../../skills/builtin/index.js'
import { buildSkillSystemPrompt } from '../../skills/types.js'
import type { SkillDefinition } from '../../skills/types.js'

describe('Builtin Skills', () => {
  it('should have 5 builtin skills', () => {
    expect(BUILTIN_SKILLS).toHaveLength(5)
  })

  it('each skill should have required fields', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.id).toBeTruthy()
      expect(skill.name).toBeTruthy()
      expect(skill.description).toBeTruthy()
      expect(skill.version).toBeTruthy()
      expect(skill.author).toBeTruthy()
      expect(skill.category).toBeTruthy()
      expect(skill.tags.length).toBeGreaterThan(0)
      expect(skill.systemPrompt).toBeTruthy()
      expect(skill.requiredTools.length).toBeGreaterThan(0)
      expect(skill.parameters).toBeDefined()
    }
  })

  it('each skill id should start with "builtin:"', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.id).toMatch(/^builtin:/)
    }
  })

  it('each skill version should be semver', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('getBuiltinSkill should find existing skills', () => {
    expect(getBuiltinSkill('builtin:code-review')).toBeDefined()
    expect(getBuiltinSkill('builtin:translate')).toBeDefined()
    expect(getBuiltinSkill('builtin:summarize')).toBeDefined()
    expect(getBuiltinSkill('builtin:test-gen')).toBeDefined()
    expect(getBuiltinSkill('builtin:refactor')).toBeDefined()
  })

  it('getBuiltinSkill should return undefined for unknown IDs', () => {
    expect(getBuiltinSkill('builtin:nonexistent')).toBeUndefined()
    expect(getBuiltinSkill('other:id')).toBeUndefined()
    expect(getBuiltinSkill('')).toBeUndefined()
  })
})

describe('Skill: code-review', () => {
  const skill = getBuiltinSkill('builtin:code-review')!

  it('should have correct metadata', () => {
    expect(skill.name).toBe('代码审查')
    expect(skill.category).toBe('coding')
    expect(skill.requiredTools).toContain('read_file')
    expect(skill.requiredTools).toContain('grep_files')
  })

  it('should have focus parameter with default', () => {
    const focusParam = skill.parameters.find((p) => p.name === 'focus')
    expect(focusParam).toBeDefined()
    expect(focusParam!.type).toBe('string')
    expect(focusParam!.defaultValue).toBe('全面审查')
  })
})

describe('Skill: translate', () => {
  const skill = getBuiltinSkill('builtin:translate')!

  it('should have correct metadata', () => {
    expect(skill.name).toBe('翻译助手')
    expect(skill.category).toBe('writing')
    expect(skill.requiredTools).toContain('read_file')
    expect(skill.requiredTools).toContain('write_file')
  })

  it('should have sourceLang and targetLang parameters', () => {
    expect(skill.parameters.find((p) => p.name === 'sourceLang')).toBeDefined()
    expect(skill.parameters.find((p) => p.name === 'targetLang')).toBeDefined()
    const target = skill.parameters.find((p) => p.name === 'targetLang')!
    expect(target.required).toBe(true)
    expect(target.options).toBeDefined()
    expect(target.options!.length).toBeGreaterThan(0)
  })
})

describe('Skill: summarize', () => {
  const skill = getBuiltinSkill('builtin:summarize')!

  it('should have correct metadata', () => {
    expect(skill.name).toBe('文档摘要')
    expect(skill.category).toBe('analysis')
  })

  it('should have ratio and style parameters', () => {
    expect(skill.parameters.find((p) => p.name === 'ratio')).toBeDefined()
    expect(skill.parameters.find((p) => p.name === 'style')).toBeDefined()
  })
})

describe('Skill: test-gen', () => {
  const skill = getBuiltinSkill('builtin:test-gen')!

  it('should have correct metadata', () => {
    expect(skill.name).toBe('测试生成器')
    expect(skill.category).toBe('coding')
    expect(skill.requiredTools).toContain('read_file')
    expect(skill.requiredTools).toContain('write_file')
  })

  it('should have framework and testType parameters', () => {
    expect(skill.parameters.find((p) => p.name === 'framework')).toBeDefined()
    expect(skill.parameters.find((p) => p.name === 'testType')).toBeDefined()
  })
})

describe('Skill: refactor', () => {
  const skill = getBuiltinSkill('builtin:refactor')!

  it('should have correct metadata', () => {
    expect(skill.name).toBe('重构助手')
    expect(skill.category).toBe('coding')
    expect(skill.requiredTools).toContain('read_file')
    expect(skill.requiredTools).toContain('write_file')
    expect(skill.requiredTools).toContain('edit_file')
  })

  it('should have refocus parameter', () => {
    const param = skill.parameters.find((p) => p.name === 'refocus')
    expect(param).toBeDefined()
    expect(param!.type).toBe('select')
    expect(param!.options!.length).toBeGreaterThan(0)
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
