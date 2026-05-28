import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectContextService } from './project-context.service.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('ProjectContextService', () => {
  it('discovers project instruction files, skills, and agents', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), '# Project rules\nAlways run tests.')

    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(root, '.cursor', 'rules', 'style.mdc'), 'Use strict TypeScript.')

    mkdirSync(join(root, '.claude', 'skills', 'review'), { recursive: true })
    writeFileSync(join(root, '.claude', 'skills', 'review', 'SKILL.md'), [
      '---',
      'name: Review Skill',
      'description: Review project changes',
      '---',
      'Check regressions and missing tests.',
    ].join('\n'))

    mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(root, '.claude', 'agents', 'architect.md'), [
      '---',
      'name: Architect',
      'description: Architecture reviewer',
      '---',
      'Evaluate design tradeoffs.',
    ].join('\n'))

    const result = new ProjectContextService().discover(root)

    expect(result.rules).toEqual(expect.arrayContaining([
      expect.stringContaining('Always run tests.'),
      expect.stringContaining('Use strict TypeScript.'),
    ]))
    expect(result.systemPrompt).toContain('[Project Instruction Files]')
    expect(result.systemPrompt).toContain('[Project Agent Definitions]')
    expect(result.systemPrompt).toContain('Architecture reviewer')
    expect(result.skillSystemPrompt).toContain('[Project Local Skills Catalog]')
    expect(result.skillSystemPrompt).toContain('Review Skill')
    expect(result.skillSystemPrompt).not.toContain('Check regressions and missing tests.')
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', path: 'AGENTS.md', included: true }),
      expect.objectContaining({ kind: 'skill', path: '.claude/skills/review/SKILL.md', included: true }),
      expect.objectContaining({ kind: 'agent', path: '.claude/agents/architect.md', included: true }),
    ]))
    expect(result.budget).toMatchObject({ mode: 'project-smart', truncated: false })
  })

  it('trims and excludes project context sources when the budget is tight', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-budget-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), 'A'.repeat(3000))
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(root, '.claude', 'agents', 'large.md'), 'B'.repeat(3000))

    const result = new ProjectContextService().discover(root, { budgetTokens: 500 })

    expect(result.budget).toMatchObject({ budgetTokens: 500, truncated: true })
    expect(result.sources.some((source) => source.reason === 'trimmed_to_context_budget')).toBe(true)
    expect(result.sources.some((source) => source.reason === 'excluded_by_context_budget')).toBe(true)
    expect(result.systemPrompt?.length ?? 0).toBeLessThan(2500)
  })

  it('returns an empty context for missing workspaces', () => {
    expect(new ProjectContextService().discover(join(tmpdir(), 'missing-spark-context'))).toEqual({
      rules: [],
      sources: [],
    })
  })
})
