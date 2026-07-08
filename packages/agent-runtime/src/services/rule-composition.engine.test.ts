import { describe, it, expect, beforeEach } from 'vitest'
import { RuleCompositionEngine } from './rule-composition.engine.js'
import type { RuleItem } from '@spark/protocol'

// Minimal mock repository
function makeRepo(rules: RuleItem[]) {
  return {
    list: ({ scope, scopeRef }: { scope?: string; scopeRef?: string }) => {
      return rules
        .filter((r) => (scope ? r.scope === scope : true))
        .filter((r) => (scopeRef ? r.scopeRef === scopeRef : true))
        .map((r) => ({ ...r, enabled: r.enabled ? 1 : 0 })) as unknown as ReturnType<typeof import('@spark/storage').RulesRepository.prototype.list>
    },
  } as unknown as import('@spark/storage').RulesRepository
}

function rule(overrides: Partial<RuleItem> & Pick<RuleItem, 'name' | 'scope'>): RuleItem {
  return {
    id: overrides.name,
    scopeRef: null,
    content: `content of ${overrides.name}`,
    priority: 0,
    enabled: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('RuleCompositionEngine', () => {
  let engine: RuleCompositionEngine

  describe('basic composition', () => {
    beforeEach(() => {
      engine = new RuleCompositionEngine(
        makeRepo([
          rule({ name: 'safety', scope: 'system', priority: 100 }),
          rule({ name: 'style', scope: 'user', priority: 50 }),
          rule({ name: 'project-lint', scope: 'project', priority: 10 }),
        ]),
      )
    })

    it('returns all enabled rules sorted by priority desc', () => {
      const { rules } = engine.compose()
      expect(rules.map((r) => r.name)).toEqual(['safety', 'style', 'project-lint'])
    })

    it('builds a non-empty prompt', () => {
      const { prompt } = engine.compose()
      expect(prompt).toContain('## Active Rules')
      expect(prompt).toContain('safety')
    })

    it('reports includedScopes', () => {
      const { includedScopes } = engine.compose()
      expect(includedScopes).toContain('system')
      expect(includedScopes).toContain('user')
    })
  })

  describe('conflict strategy: override', () => {
    beforeEach(() => {
      engine = new RuleCompositionEngine(
        makeRepo([
          rule({ name: 'style', scope: 'system', priority: 50, content: 'system style' }),
          rule({ name: 'style', scope: 'project', priority: 10, content: 'project style' }),
        ]),
      )
    })

    it('higher-precedence scope wins on name collision', () => {
      const { rules } = engine.compose({ conflictStrategy: 'override' })
      const styleRule = rules.find((r) => r.name === 'style')
      // project has higher scope precedence than system
      expect(styleRule?.sourceScope).toBe('project')
      expect(styleRule?.overrode).toBe(true)
    })

    it('deduplicates to one rule per name', () => {
      const { rules } = engine.compose({ conflictStrategy: 'override' })
      const styleRules = rules.filter((r) => r.name === 'style')
      expect(styleRules).toHaveLength(1)
    })
  })

  describe('conflict strategy: merge', () => {
    beforeEach(() => {
      engine = new RuleCompositionEngine(
        makeRepo([
          rule({ name: 'style', scope: 'system', priority: 50, content: 'system style' }),
          rule({ name: 'style', scope: 'user', priority: 10, content: 'user style' }),
        ]),
      )
    })

    it('concatenates content of same-named rules', () => {
      const { rules } = engine.compose({ conflictStrategy: 'merge' })
      const styleRule = rules.find((r) => r.name === 'style')
      expect(styleRule?.content).toContain('system style')
      expect(styleRule?.content).toContain('user style')
    })
  })

  describe('disabled rules', () => {
    it('excludes disabled rules from composition', () => {
      engine = new RuleCompositionEngine(
        makeRepo([
          rule({ name: 'active', scope: 'system', enabled: true }),
          rule({ name: 'inactive', scope: 'system', enabled: false }),
        ]),
      )
      const { rules } = engine.compose()
      expect(rules.map((r) => r.name)).not.toContain('inactive')
    })
  })

  describe('scope filtering', () => {
    it('only includes requested scopes', () => {
      engine = new RuleCompositionEngine(
        makeRepo([
          rule({ name: 'sys', scope: 'system' }),
          rule({ name: 'usr', scope: 'user' }),
        ]),
      )
      const { rules } = engine.compose({ scopes: ['system'] })
      expect(rules.map((r) => r.name)).toEqual(['sys'])
    })
  })

  describe('cache invalidation', () => {
    it('returns cached result on repeated calls', () => {
      engine = new RuleCompositionEngine(makeRepo([rule({ name: 'r', scope: 'system' })]))
      const r1 = engine.compose()
      const r2 = engine.compose()
      expect(r1).toBe(r2)
    })

    it('recomputes after invalidate()', () => {
      engine = new RuleCompositionEngine(makeRepo([rule({ name: 'r', scope: 'system' })]))
      const r1 = engine.compose()
      engine.invalidate()
      const r2 = engine.compose()
      expect(r1).not.toBe(r2)
    })
  })

  describe('empty rules', () => {
    it('returns empty prompt when no rules', () => {
      engine = new RuleCompositionEngine(makeRepo([]))
      const { rules, prompt } = engine.compose()
      expect(rules).toHaveLength(0)
      expect(prompt).toBe('')
    })
  })
})
