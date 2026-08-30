import type { RuleItem, RuleScope } from '@spark/protocol'
import type { RulesRepository } from '@spark/storage'

// Scope priority order: higher index = higher precedence when merging
const SCOPE_PRECEDENCE: RuleScope[] = ['system', 'team', 'user', 'project', 'session']

export type ConflictStrategy = 'override' | 'merge'

export interface ComposeOptions {
  /** Scopes to include, in addition to 'system'. Defaults to all scopes. */
  scopes?: RuleScope[]
  /** scopeRef filter per scope (e.g. workspaceId for 'project') */
  scopeRefs?: Partial<Record<RuleScope, string>>
  /** How to handle rules with the same name across scopes. Default: 'override' */
  conflictStrategy?: ConflictStrategy
}

export interface ComposedRule {
  id: string
  name: string
  content: string
  /** Effective priority after composition */
  priority: number
  /** Which scope this rule came from */
  sourceScope: RuleScope
  /** Whether it overrode a lower-scope rule with the same name */
  overrode: boolean
}

export interface CompositionResult {
  rules: ComposedRule[]
  /** Merged prompt string ready for injection into system prompt */
  prompt: string
  /** Scopes that were included in this composition */
  includedScopes: RuleScope[]
}

export class RuleCompositionEngine {
  // Cache: key → { result, version }
  private cache = new Map<string, { result: CompositionResult; version: number }>()
  private version = 0

  constructor(private readonly repo: RulesRepository) {}

  /** Invalidate cache (call after any rule mutation) */
  invalidate(): void {
    this.version++
  }

  compose(options: ComposeOptions = {}): CompositionResult {
    const cacheKey = this.buildCacheKey(options)
    const cached = this.cache.get(cacheKey)
    if (cached && cached.version === this.version) {
      return cached.result
    }

    const result = this.doCompose(options)
    this.cache.set(cacheKey, { result, version: this.version })
    return result
  }

  private doCompose(options: ComposeOptions): CompositionResult {
    const { scopes, scopeRefs = {}, conflictStrategy = 'override' } = options
    const includedScopes = scopes ?? [...SCOPE_PRECEDENCE]

    // Collect enabled rules per scope, sorted by priority desc
    const rulesByScope = new Map<RuleScope, RuleItem[]>()
    for (const scope of includedScopes) {
      const scopeRef = scopeRefs[scope]
      const rows = this.repo.list({ scope, ...(scopeRef ? { scopeRef } : {}) })
      const enabled = rows.filter((r) => r.enabled === 1 || (r as unknown as RuleItem).enabled === true)
      rulesByScope.set(scope, enabled as unknown as RuleItem[])
    }

    const composed: ComposedRule[] = []

    if (conflictStrategy === 'override') {
      // Process scopes from lowest to highest precedence; higher scope wins on name collision
      const nameMap = new Map<string, ComposedRule>()

      for (const scope of includedScopes) {
        const rules = rulesByScope.get(scope) ?? []
        for (const rule of rules) {
          const existing = nameMap.get(rule.name.toLowerCase())
          const overrode = existing !== undefined
          nameMap.set(rule.name.toLowerCase(), {
            id: rule.id,
            name: rule.name,
            content: rule.content,
            priority: rule.priority,
            sourceScope: scope,
            overrode,
          })
        }
      }

      composed.push(...nameMap.values())
    } else {
      // merge: concatenate content of same-named rules across scopes
      const nameMap = new Map<string, ComposedRule>()

      for (const scope of includedScopes) {
        const rules = rulesByScope.get(scope) ?? []
        for (const rule of rules) {
          const key = rule.name.toLowerCase()
          const existing = nameMap.get(key)
          if (existing) {
            existing.content = `${existing.content}\n\n${rule.content}`
            existing.overrode = true
            // Keep higher priority
            if (rule.priority > existing.priority) {
              existing.priority = rule.priority
            }
          } else {
            nameMap.set(key, {
              id: rule.id,
              name: rule.name,
              content: rule.content,
              priority: rule.priority,
              sourceScope: scope,
              overrode: false,
            })
          }
        }
      }

      composed.push(...nameMap.values())
    }

    // Sort by priority desc, then by scope precedence desc
    composed.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return SCOPE_PRECEDENCE.indexOf(b.sourceScope) - SCOPE_PRECEDENCE.indexOf(a.sourceScope)
    })

    const prompt = buildPrompt(composed)

    return { rules: composed, prompt, includedScopes }
  }

  private buildCacheKey(options: ComposeOptions): string {
    return JSON.stringify({
      scopes: options.scopes ?? null,
      scopeRefs: options.scopeRefs ?? null,
      strategy: options.conflictStrategy ?? 'override',
    })
  }
}

function buildPrompt(rules: ComposedRule[]): string {
  if (rules.length === 0) return ''
  const lines = rules.map((r) => `### ${r.name}\n${r.content}`)
  return `## Active Rules\n\n${lines.join('\n\n')}`
}
