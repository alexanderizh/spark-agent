import { createHash } from 'node:crypto'

import { stableStringify } from '../kernel/stable-json.js'
import type { DangerClassifier, DangerVerdict, PermissionPolicy } from '../seams.js'
import type { ResolvedToolCall } from '../tools/contract.js'
import { extractCommandText, matchDangerousCommand } from './danger-rules.js'
import type {
  PermissionCheckContext,
  PermissionDecision,
  PermissionRuleReference,
  PermissionRuleSource,
  PolicyDecision,
} from './types.js'

type JsonScalar = string | number | boolean | null
const MAX_TRACKED_SESSIONS = 1_024
/** Stand-in for hosts that do not thread a turn signal into permission checks. */
const NEVER_ABORTED_SIGNAL = new AbortController().signal

export type PermissionArgumentMatcher =
  | { readonly path: string; readonly operator: 'equals'; readonly value: JsonScalar }
  | { readonly path: string; readonly operator: 'glob' | 'prefix'; readonly value: string }

export interface PermissionRule {
  readonly id: string
  readonly tool: string
  readonly action: PolicyDecision['decision']
  readonly reason?: string
  readonly match?: readonly PermissionArgumentMatcher[]
  readonly remember?: 'never' | 'session'
}

export interface PermissionRuleLayer {
  readonly source: PermissionRuleSource
  readonly rules: readonly PermissionRule[]
}

export interface RulePermissionPolicyOptions {
  readonly layers?: readonly PermissionRuleLayer[]
  /** Tool patterns that bypass interactive approval in manual mode. */
  readonly allowedTools?: readonly string[]
  /** Tool patterns that are denied before mode-specific handling. */
  readonly disallowedTools?: readonly string[]
  /**
   * Host risk reviewer for auto mode. When absent (CLI/TUI/unattended hosts
   * that did not wire one), auto keeps its historical unconditional allow.
   */
  readonly dangerClassifier?: DangerClassifier
}

interface SelectedRule {
  readonly rule: PermissionRule
  readonly reference: PermissionRuleReference
}

/** One rule with its provenance, for hosts rendering a rules list (mirrors the Claude SDK's list_permission_rules). */
export interface ListedPermissionRule {
  readonly id: string
  readonly tool: string
  readonly action: PermissionRule['action']
  readonly source: PermissionRuleSource
  /**
   * Where the rule lives: `persistent` (user/project config files),
   * `session` (cli-origin, memory only), or `readonly` (builtin/host —
   * this listing API never mutates rules).
   */
  readonly editability: 'persistent' | 'session' | 'readonly'
  readonly reason?: string
}

const EDITABILITY_BY_SOURCE: Readonly<
  Record<PermissionRuleSource, ListedPermissionRule['editability']>
> = {
  builtin: 'readonly',
  user: 'persistent',
  project: 'persistent',
  cli: 'session',
  host: 'readonly',
}

export class RulePermissionPolicy implements PermissionPolicy {
  readonly #rules: readonly SelectedRule[]
  readonly #allowedTools: readonly string[]
  readonly #disallowedTools: readonly string[]
  readonly #dangerClassifier: DangerClassifier | undefined
  readonly #sessionGrants = new Map<string, Set<string>>()

  constructor(options: RulePermissionPolicyOptions | readonly PermissionRule[] = {}) {
    const normalized: RulePermissionPolicyOptions = Array.isArray(options)
      ? { layers: [{ source: 'host', rules: options as readonly PermissionRule[] }] }
      : (options as RulePermissionPolicyOptions)
    this.#allowedTools = [...(normalized.allowedTools ?? [])]
    this.#disallowedTools = [...(normalized.disallowedTools ?? [])]
    this.#dangerClassifier = normalized.dangerClassifier
    this.#rules = (normalized.layers ?? []).flatMap((layer) =>
      layer.rules.map((rule) => {
        validateRule(rule)
        return { rule: structuredClone(rule), reference: { id: rule.id, source: layer.source } }
      }),
    )
  }

  async check(call: ResolvedToolCall, context: PermissionCheckContext): Promise<PolicyDecision> {
    // Session mode is the single source of truth: the tool runner always
    // forwards the session's current mode, so the policy never second-guesses it.
    const mode = context.mode
    let selected: SelectedRule | undefined
    for (const rule of this.#rules) {
      if (wildcardMatches(rule.rule.tool, call.name) && matchesArguments(rule.rule, call.args)) {
        selected = rule
      }
    }
    if (matchesAny(this.#disallowedTools, call.name)) {
      return { decision: 'deny', reason: 'Tool is disallowed by host configuration' }
    }
    if (mode === 'bypass') return { decision: 'allow', reason: 'Permission bypass mode' }
    // Explicit deny rules stay enforceable in auto mode; auto only removes the
    // interactive asks. Bypass skips ordinary rules but not host disallows.
    if (selected?.rule.action === 'deny') return ruleDecision(selected)
    if (matchesAny(this.#allowedTools, call.name)) {
      return { decision: 'allow', reason: 'Tool is allowed by host configuration' }
    }
    if (mode === 'auto') return this.#autoDecision(call, context)
    if (selected) {
      if (selected.rule.action !== 'ask') return ruleDecision(selected)
      const grant = grantDetails(
        call,
        selected.rule.remember === 'session' && call.definition.approval !== 'always',
      )
      if (this.#hasGrant(context.sessionId, grant.key)) {
        return { decision: 'allow', reason: `Session grant: ${grant.label}` }
      }
      return askDecision(call, selected, grant)
    }
    const grant = grantDetails(call, call.definition.approval === 'session')
    if (this.#hasGrant(context.sessionId, grant.key)) {
      return { decision: 'allow', reason: `Session grant: ${grant.label}` }
    }
    if (call.definition.approval === 'never') return { decision: 'allow' }
    return askDecision(call, undefined, grant)
  }

  /**
   * Auto mode: read-only tools and workspace writes run free (aligned with the
   * SDK's acceptEdits tier); a call that carries a command string is screened —
   * known-dangerous patterns and host-classifier risk verdicts fall back to an
   * interactive ask instead of running silently. Without a classifier the
   * historical unconditional allow applies (CLI/TUI/unattended hosts).
   */
  async #autoDecision(
    call: ResolvedToolCall,
    context: PermissionCheckContext,
  ): Promise<PolicyDecision> {
    // A grant recorded earlier (manual ask or a prior auto ask) short-circuits
    // before any screening, matching the manual-mode grant semantics.
    const grant = grantDetails(call, this.#mayRemember(call))
    if (this.#hasGrant(context.sessionId, grant.key)) {
      return { decision: 'allow', reason: `Session grant: ${grant.label}` }
    }
    const definition = call.definition
    if (definition.permissionClass === 'read' || definition.approval === 'never') {
      return { decision: 'allow', reason: 'Auto approval mode (read-only tool)' }
    }
    if (definition.permissionClass === 'workspace-write') {
      return { decision: 'allow', reason: 'Auto approval mode (workspace write)' }
    }
    const command = extractCommandText(call.args)
    // Screening is triggered solely by a command string in the arguments;
    // web/task/MCP calls without one keep the historical behavior.
    if (command === undefined) return { decision: 'allow', reason: 'Auto approval mode' }
    if (matchDangerousCommand(command) !== undefined) {
      return this.#dangerAsk(grant, `Dangerous command pattern: ${singleLine(command, 160)}`)
    }
    const classifier = this.#dangerClassifier
    if (classifier !== undefined) {
      const verdict = await this.#classifySafely(classifier, call, context, command)
      if (verdict.kind === 'dangerous') {
        return this.#dangerAsk(grant, `Risk review: ${singleLine(verdict.reason, 160)}`)
      }
      if (verdict.kind === 'safe') {
        return { decision: 'allow', reason: 'Auto approval mode (risk review passed)' }
      }
      // unavailable: no verdict this time — fall through to the unconditional
      // allow below (hosts without a reviewer share this fallback).
    }
    return { decision: 'allow', reason: 'Auto approval mode' }
  }

  /** Danger-driven asks reuse the grant calculation: bash (approval `always`) gets once-only. */
  #dangerAsk(
    grant: { readonly key: string; readonly label: string; readonly remember: boolean },
    reason: string,
  ): Extract<PolicyDecision, { decision: 'ask' }> {
    return {
      decision: 'ask',
      reason,
      allowedGrantScopes: grant.remember ? ['once', 'session'] : ['once'],
      ...(grant.remember ? { sessionScopeLabel: grant.label } : {}),
    }
  }

  /** Classifier contract violations (reject/throw) degrade to `unavailable`, never break the turn. */
  async #classifySafely(
    classifier: DangerClassifier,
    call: ResolvedToolCall,
    context: PermissionCheckContext,
    command: string,
  ): Promise<DangerVerdict> {
    try {
      return await classifier.classify({
        tool: call.name,
        args: call.args,
        command,
        cwd: context.cwd,
        sessionId: context.sessionId,
        signal: context.signal ?? NEVER_ABORTED_SIGNAL,
      })
    } catch (error) {
      return {
        kind: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  recordDecision(
    call: ResolvedToolCall,
    decision: PermissionDecision,
    context: PermissionCheckContext,
  ): void {
    if (decision.decision === 'allow' && decision.grantScope === 'session') {
      if (!this.#mayRemember(call)) {
        throw new Error(`Tool ${call.name} does not permit session grants`)
      }
      let grants = this.#sessionGrants.get(context.sessionId)
      if (!grants) {
        if (this.#sessionGrants.size >= MAX_TRACKED_SESSIONS) {
          const oldest = this.#sessionGrants.keys().next().value
          if (oldest) this.#sessionGrants.delete(oldest)
        }
        grants = new Set<string>()
      }
      grants.add(grantDetails(call, true).key)
      this.#sessionGrants.set(context.sessionId, grants)
    }
  }

  #hasGrant(sessionId: string, key: string): boolean {
    return this.#sessionGrants.get(sessionId)?.has(key) ?? false
  }

  /**
   * Full rule listing with provenance and editability. Informational only —
   * mutating rules means editing the source settings, not calling this API.
   * Later layers win in `check`; the listing preserves registration order so
   * hosts can show precedence the way the policy applies it.
   */
  listRules(): readonly ListedPermissionRule[] {
    return this.#rules.map(({ rule, reference }) => ({
      id: rule.id,
      tool: rule.tool,
      action: rule.action,
      source: reference.source,
      editability: EDITABILITY_BY_SOURCE[reference.source],
      ...(rule.reason ? { reason: rule.reason } : {}),
    }))
  }

  #mayRemember(call: ResolvedToolCall): boolean {
    let selected: SelectedRule | undefined
    for (const rule of this.#rules) {
      if (wildcardMatches(rule.rule.tool, call.name) && matchesArguments(rule.rule, call.args)) {
        selected = rule
      }
    }
    return selected?.rule.action === 'ask'
      ? selected.rule.remember === 'session' && call.definition.approval !== 'always'
      : call.definition.approval === 'session'
  }
}

function ruleDecision(selected: SelectedRule): PolicyDecision {
  const { rule, reference } = selected
  if (rule.action === 'allow') {
    return { decision: 'allow', ...(rule.reason ? { reason: rule.reason } : {}), rule: reference }
  }
  return { decision: 'deny', ...(rule.reason ? { reason: rule.reason } : {}), rule: reference }
}

function askDecision(
  call: ResolvedToolCall,
  selected: SelectedRule | undefined,
  grant: { readonly key: string; readonly label: string; readonly remember: boolean },
): Extract<PolicyDecision, { decision: 'ask' }> {
  return {
    decision: 'ask',
    reason: selected?.rule.reason ?? `Tool approval policy: ${call.definition.approval}`,
    ...(selected ? { rule: selected.reference } : {}),
    allowedGrantScopes: grant.remember ? ['once', 'session'] : ['once'],
    ...(grant.remember ? { sessionScopeLabel: grant.label } : {}),
  }
}

function grantDetails(
  call: ResolvedToolCall,
  remember: boolean,
): { readonly key: string; readonly label: string; readonly remember: boolean } {
  const args = asRecord(call.args)
  const path = typeof args?.path === 'string' ? args.path : undefined
  const command = typeof args?.command === 'string' ? args.command : undefined
  const identity = path === undefined ? stableStringify(call.args) : stableStringify({ path })
  const digest = createHash('sha256').update(identity).digest('hex')
  const detail = path ?? command ?? 'these exact arguments'
  return {
    key: `${call.name}:${digest}`,
    label: `${call.name}: ${singleLine(detail, 160)}`,
    remember,
  }
}

function matchesArguments(rule: PermissionRule, args: unknown): boolean {
  return (rule.match ?? []).every((matcher) => {
    const actual = resolvePointer(args, matcher.path)
    if (matcher.operator === 'equals') return Object.is(actual, matcher.value)
    if (typeof actual !== 'string') return false
    return matcher.operator === 'prefix'
      ? actual.startsWith(matcher.value)
      : wildcardMatches(matcher.value, actual)
  })
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value
  let current = value
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    const record = asRecord(current)
    if (!record || !Object.hasOwn(record, key)) return undefined
    current = record[key]
  }
  return current
}

/** Glob match with `*` wildcards; shared with hook matchers and permission rules. */
export function wildcardMatches(pattern: string, value: string): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let retryValueIndex = -1
  while (valueIndex < value.length) {
    if (pattern[patternIndex] === value[valueIndex]) {
      patternIndex += 1
      valueIndex += 1
    } else if (pattern[patternIndex] === '*') {
      starIndex = patternIndex
      retryValueIndex = valueIndex
      patternIndex += 1
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      retryValueIndex += 1
      valueIndex = retryValueIndex
    } else {
      return false
    }
  }
  while (pattern[patternIndex] === '*') patternIndex += 1
  return patternIndex === pattern.length
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => wildcardMatches(pattern, value))
}

function validateRule(rule: PermissionRule): void {
  if (!rule.id || !rule.tool || rule.tool.length > 256)
    throw new Error('Permission rule requires a valid id and tool pattern')
  if (rule.remember && rule.action !== 'ask') {
    throw new Error(`Permission rule ${rule.id} can only set remember when action is ask`)
  }
  for (const matcher of rule.match ?? []) {
    if (matcher.path !== '' && (!matcher.path.startsWith('/') || matcher.path.length > 512)) {
      throw new Error(`Permission rule ${rule.id} contains an invalid JSON pointer`)
    }
    if (/(?:~(?![01]))/u.test(matcher.path)) {
      throw new Error(`Permission rule ${rule.id} contains an invalid JSON pointer escape`)
    }
    if (typeof matcher.value === 'string' && matcher.value.length > 4_096) {
      throw new Error(`Permission rule ${rule.id} contains an oversized matcher value`)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function singleLine(value: string, maximum: number): string {
  const normalized = value.replaceAll(/\s+/gu, ' ').trim()
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
}
