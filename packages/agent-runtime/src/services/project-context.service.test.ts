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
    expect(result.skillSystemPrompt).toContain('project:.claude/skills/review/SKILL.md')
    expect(result.skillSystemPrompt).not.toContain('Source:')
    expect(result.skillSystemPrompt).not.toContain('Check regressions and missing tests.')
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', path: 'AGENTS.md', included: true }),
      expect.objectContaining({ kind: 'skill', path: '.claude/skills/review/SKILL.md', included: true }),
      expect.objectContaining({ kind: 'agent', path: '.claude/agents/architect.md', included: true }),
    ]))
    expect(result.budget).toMatchObject({ mode: 'project-smart', truncated: false })
  })

  it('loads distinct Codex and Claude rule files but injects duplicate content once', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-dedupe-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), '# Shared rules\nAlways run tests.')
    writeFileSync(join(root, 'CLAUDE.md'), '# Shared rules\nAlways run tests.')
    writeFileSync(join(root, 'GEMINI.md'), '# Gemini rules\nCheck formatting.')

    const result = new ProjectContextService().discover(root)

    expect(result.systemPrompt?.match(/Always run tests\./g)).toHaveLength(1)
    expect(result.systemPrompt).toContain('Check formatting.')
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', path: 'AGENTS.md', included: true }),
      expect.objectContaining({ kind: 'rule', path: 'CLAUDE.md', included: false, reason: 'duplicate_of:AGENTS.md' }),
      expect.objectContaining({ kind: 'rule', path: 'GEMINI.md', included: true }),
    ]))
    expect(result.budget).toMatchObject({ truncated: false })
  })

  it('skips a lower-priority rule file wholly contained in an earlier instruction file', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-contained-'))
    roots.push(root)
    const shared = '# Shared rules\nAlways run tests.\nKeep strict types.'
    writeFileSync(join(root, 'AGENTS.md'), `# Repository preface\nUse local tools.\n\n${shared}\n\n# Tail\nVerify changes.`)
    writeFileSync(join(root, 'CLAUDE.md'), shared)

    const result = new ProjectContextService().discover(root)

    expect(result.systemPrompt?.match(/Always run tests\./g)).toHaveLength(1)
    expect(result.systemPrompt).toContain('Repository preface')
    expect(result.systemPrompt).toContain('Verify changes.')
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', path: 'AGENTS.md', included: true }),
      expect.objectContaining({
        kind: 'rule',
        path: 'CLAUDE.md',
        included: false,
        reason: 'contained_in:AGENTS.md',
      }),
    ]))
  })

  it('does not dedupe a rule that only matches a substring inside a larger token', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-boundary-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), 'prefixAlways run tests.suffix')
    writeFileSync(join(root, 'CLAUDE.md'), 'Always run tests.')

    const result = new ProjectContextService().discover(root)

    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', path: 'AGENTS.md', included: true }),
      expect.objectContaining({ kind: 'rule', path: 'CLAUDE.md', included: true }),
    ]))
  })

  it('does not claim containment in an earlier rule that was excluded by budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-contained-budget-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), 'Header\n\nShared rule.\n\nTail')
    writeFileSync(join(root, 'CLAUDE.md'), 'Shared rule.')

    const result = new ProjectContextService().discover(root, { budgetTokens: 0 })

    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'AGENTS.md', reason: 'excluded_by_context_budget' }),
      expect.objectContaining({ path: 'CLAUDE.md', reason: 'excluded_by_context_budget' }),
    ]))
    expect(result.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'CLAUDE.md', reason: 'contained_in:AGENTS.md' }),
    ]))
  })

  it('always includes an explicitly pinned rule even when an earlier rule contains it', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-pinned-contained-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), 'Header\n\nPinned rule.\n\nTail')
    writeFileSync(join(root, 'CLAUDE.md'), 'Pinned rule.')

    const result = new ProjectContextService().discover(root, {
      pinnedPaths: new Set(['CLAUDE.md']),
    })

    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'AGENTS.md', included: true }),
      expect.objectContaining({ path: 'CLAUDE.md', included: true, reason: 'pinned' }),
    ]))
    expect(result.systemPrompt?.match(/Pinned rule\./g)).toHaveLength(2)
  })

  it('does not treat an instruction quoted inside a fenced code block as active containment', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-fenced-example-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), '# Example\n\n```md\nQuoted rule.\n```')
    writeFileSync(join(root, 'CLAUDE.md'), 'Quoted rule.')

    const result = new ProjectContextService().discover(root)

    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'AGENTS.md', included: true }),
      expect.objectContaining({ path: 'CLAUDE.md', included: true }),
    ]))
  })

  it('loads project-local skill instructions only when explicitly selected', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-skill-load-'))
    roots.push(root)
    mkdirSync(join(root, '.codex', 'skills', 'planner'), { recursive: true })
    writeFileSync(join(root, '.codex', 'skills', 'planner', 'SKILL.md'), [
      '---',
      'name: Planner',
      'description: Plan project changes',
      '---',
      'Full planning workflow.',
    ].join('\n'))

    const service = new ProjectContextService()
    const summaries = service.listSkillSummaries(root)
    const prompt = service.buildSkillSystemPrompt(root, 'project:.codex/skills/planner/SKILL.md')

    expect(summaries).toContainEqual(expect.objectContaining({
      id: 'project:.codex/skills/planner/SKILL.md',
      name: 'Planner',
      description: 'Plan project changes',
    }))
    expect(prompt).toContain('[Selected Project Skill: Planner]')
    expect(prompt).toContain('Full planning workflow.')
  })

  it('trims and excludes project context sources when the budget is tight', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-budget-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), 'A'.repeat(3000))
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(root, '.claude', 'agents', 'large.md'), 'B'.repeat(3000))

    // 真实 token 数（gpt-tokenizer）：'A'*3000 → 375 token，'B'*3000 → 750 token。
    // budget=300：AGENTS.md (375>300 但 ≥200) 触发 trimmed_to_context_budget；
    // 剩余预算归零后，large.md 触发 excluded_by_context_budget。
    const result = new ProjectContextService().discover(root, { budgetTokens: 300 })

    expect(result.budget).toMatchObject({ budgetTokens: 300, truncated: true })
    expect(result.sources.some((source) => source.reason === 'trimmed_to_context_budget')).toBe(true)
    expect(result.sources.some((source) => source.reason === 'excluded_by_context_budget')).toBe(true)
    // 旧的字符粗暴截断 ≤2500；新的 token+头尾截断 ellipsis 更长（多 2 char），放宽到 2700。
    expect(result.systemPrompt?.length ?? 0).toBeLessThan(2700)
  })

  it('preserves both the head and tail of a file that exceeds the per-file token budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-project-context-long-file-'))
    roots.push(root)
    writeFileSync(
      join(root, 'AGENTS.md'),
      `START-OF-RULES\n${'middle content '.repeat(30_000)}\nEND-OF-RULES`,
    )

    const result = new ProjectContextService().discover(root, {
      mode: 'deep-research',
      budgetTokens: 80_000,
    })

    expect(result.systemPrompt).toContain('START-OF-RULES')
    expect(result.systemPrompt).toContain('END-OF-RULES')
    expect(result.systemPrompt).toContain('Project context system prompt truncated')
    expect(result.sources).toContainEqual(
      expect.objectContaining({ path: 'AGENTS.md', included: true, truncated: true }),
    )
  })

  it('returns an empty context for missing workspaces', () => {
    expect(new ProjectContextService().discover(join(tmpdir(), 'missing-spark-context'))).toEqual({
      rules: [],
      sources: [],
    })
  })

  describe('file pin/exclude overrides', () => {
    it('excludes files matching excludedPaths', () => {
      const root = mkdtempSync(join(tmpdir(), 'spark-ctx-exclude-'))
      roots.push(root)
      writeFileSync(join(root, 'AGENTS.md'), 'Keep this rule.')
      writeFileSync(join(root, 'CLAUDE.md'), 'Exclude this rule.')

      const result = new ProjectContextService().discover(root, {
        excludedPaths: new Set(['CLAUDE.md']),
      })

      expect(result.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md', included: true }),
      ]))
      expect(result.sources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'CLAUDE.md' }),
      ]))
    })

    it('pins extra files not auto-discovered', () => {
      const root = mkdtempSync(join(tmpdir(), 'spark-ctx-pin-extra-'))
      roots.push(root)
      mkdirSync(join(root, 'docs'), { recursive: true })
      writeFileSync(join(root, 'docs', 'architecture.md'), '# Architecture\nUse microservices.')
      // docs/architecture.md is not a standard rule/agent/skill path — not auto-discovered

      const result = new ProjectContextService().discover(root, {
        pinnedPaths: new Set(['docs/architecture.md']),
      })

      expect(result.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'docs/architecture.md', included: true, reason: 'pinned' }),
      ]))
      expect(result.systemPrompt).toContain('Use microservices.')
    })

    it('pins a file that would otherwise be excluded by budget', () => {
      const root = mkdtempSync(join(tmpdir(), 'spark-ctx-pin-budget-'))
      roots.push(root)
      writeFileSync(join(root, 'AGENTS.md'), 'A'.repeat(3000))
      mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(root, '.claude', 'agents', 'architect.md'), 'B'.repeat(3000))

      const result = new ProjectContextService().discover(root, {
        budgetTokens: 500,
        pinnedPaths: new Set(['.claude/agents/architect.md']),
      })

      // The pinned file should be included even though budget is tiny
      const architectSource = result.sources.find((s) => s.path === '.claude/agents/architect.md')
      expect(architectSource).toEqual(expect.objectContaining({ included: true, reason: 'pinned' }))
    })

    it('excluded takes priority over pinned for the same file', () => {
      const root = mkdtempSync(join(tmpdir(), 'spark-ctx-pin-exclude-conflict-'))
      roots.push(root)
      writeFileSync(join(root, 'AGENTS.md'), 'Some rule content.')

      const result = new ProjectContextService().discover(root, {
        pinnedPaths: new Set(['AGENTS.md']),
        excludedPaths: new Set(['AGENTS.md']),
      })

      // excluded wins — the file should not appear
      expect(result.sources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md' }),
      ]))
    })

    it('returns empty context with empty overrides', () => {
      const root = mkdtempSync(join(tmpdir(), 'spark-ctx-empty-overrides-'))
      roots.push(root)

      const result = new ProjectContextService().discover(root, {
        pinnedPaths: new Set(),
        excludedPaths: new Set(),
      })

      expect(result.rules).toEqual([])
      expect(result.sources).toEqual([])
    })
  })
})
