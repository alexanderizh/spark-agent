import { createHash } from 'node:crypto';

import { stableStringify } from '../kernel/stable-json.js';
import type { PermissionPolicy } from '../seams.js';
import type { ResolvedToolCall } from '../tools/contract.js';
import type {
  PermissionCheckContext,
  PermissionDecision,
  PermissionMode,
  PermissionRuleReference,
  PermissionRuleSource,
  PolicyDecision,
} from './types.js';

type JsonScalar = string | number | boolean | null;
const MAX_TRACKED_SESSIONS = 1_024;

export type PermissionArgumentMatcher =
  | { readonly path: string; readonly operator: 'equals'; readonly value: JsonScalar }
  | { readonly path: string; readonly operator: 'glob' | 'prefix'; readonly value: string };

export interface PermissionRule {
  readonly id: string;
  readonly tool: string;
  readonly action: PolicyDecision['decision'];
  readonly reason?: string;
  readonly match?: readonly PermissionArgumentMatcher[];
  readonly remember?: 'never' | 'session';
}

export interface PermissionRuleLayer {
  readonly source: PermissionRuleSource;
  readonly rules: readonly PermissionRule[];
}

export interface RulePermissionPolicyOptions {
  readonly mode?: PermissionMode;
  readonly layers?: readonly PermissionRuleLayer[];
}

interface SelectedRule {
  readonly rule: PermissionRule;
  readonly reference: PermissionRuleReference;
}

export class RulePermissionPolicy implements PermissionPolicy {
  readonly #mode: PermissionMode;
  readonly #rules: readonly SelectedRule[];
  readonly #sessionGrants = new Map<string, Set<string>>();

  constructor(options: RulePermissionPolicyOptions | readonly PermissionRule[] = {}) {
    const normalized: RulePermissionPolicyOptions = Array.isArray(options)
      ? { layers: [{ source: 'host', rules: options as readonly PermissionRule[] }] }
      : (options as RulePermissionPolicyOptions);
    this.#mode = normalized.mode ?? 'default';
    this.#rules = (normalized.layers ?? []).flatMap((layer) =>
      layer.rules.map((rule) => {
        validateRule(rule);
        return { rule: structuredClone(rule), reference: { id: rule.id, source: layer.source } };
      }),
    );
  }

  async check(call: ResolvedToolCall, context: PermissionCheckContext): Promise<PolicyDecision> {
    const mode = context.mode === 'default' ? this.#mode : context.mode;
    if (mode === 'bypass') return { decision: 'allow', reason: 'Permission bypass mode' };
    if (mode === 'plan' && call.definition.permissionClass !== 'read') {
      return { decision: 'deny', reason: 'Plan mode blocks tools with side effects' };
    }
    let selected: SelectedRule | undefined;
    for (const rule of this.#rules) {
      if (wildcardMatches(rule.rule.tool, call.name) && matchesArguments(rule.rule, call.args)) {
        selected = rule;
      }
    }
    if (selected) {
      if (selected.rule.action !== 'ask') return ruleDecision(selected);
      const grant = grantDetails(
        call,
        selected.rule.remember === 'session' && call.definition.approval !== 'always',
      );
      if (this.#hasGrant(context.sessionId, grant.key)) {
        return { decision: 'allow', reason: `Session grant: ${grant.label}` };
      }
      return askDecision(call, selected, grant);
    }
    const grant = grantDetails(call, call.definition.approval === 'session');
    if (this.#hasGrant(context.sessionId, grant.key)) {
      return { decision: 'allow', reason: `Session grant: ${grant.label}` };
    }
    if (
      mode === 'acceptEdits' &&
      (call.definition.permissionClass === 'read' ||
        call.definition.permissionClass === 'workspace-write')
    ) {
      return { decision: 'allow', reason: 'acceptEdits mode' };
    }
    if (call.definition.approval === 'never') return { decision: 'allow' };
    return askDecision(call, undefined, grant);
  }

  recordDecision(
    call: ResolvedToolCall,
    decision: PermissionDecision,
    context: PermissionCheckContext,
  ): void {
    if (decision.decision === 'allow' && decision.grantScope === 'session') {
      if (!this.#mayRemember(call)) {
        throw new Error(`Tool ${call.name} does not permit session grants`);
      }
      let grants = this.#sessionGrants.get(context.sessionId);
      if (!grants) {
        if (this.#sessionGrants.size >= MAX_TRACKED_SESSIONS) {
          const oldest = this.#sessionGrants.keys().next().value;
          if (oldest) this.#sessionGrants.delete(oldest);
        }
        grants = new Set<string>();
      }
      grants.add(grantDetails(call, true).key);
      this.#sessionGrants.set(context.sessionId, grants);
    }
  }

  #hasGrant(sessionId: string, key: string): boolean {
    return this.#sessionGrants.get(sessionId)?.has(key) ?? false;
  }

  #mayRemember(call: ResolvedToolCall): boolean {
    let selected: SelectedRule | undefined;
    for (const rule of this.#rules) {
      if (wildcardMatches(rule.rule.tool, call.name) && matchesArguments(rule.rule, call.args)) {
        selected = rule;
      }
    }
    return selected?.rule.action === 'ask'
      ? selected.rule.remember === 'session' && call.definition.approval !== 'always'
      : call.definition.approval === 'session';
  }
}

function ruleDecision(selected: SelectedRule): PolicyDecision {
  const { rule, reference } = selected;
  if (rule.action === 'allow') {
    return { decision: 'allow', ...(rule.reason ? { reason: rule.reason } : {}), rule: reference };
  }
  return { decision: 'deny', ...(rule.reason ? { reason: rule.reason } : {}), rule: reference };
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
  };
}

function grantDetails(
  call: ResolvedToolCall,
  remember: boolean,
): { readonly key: string; readonly label: string; readonly remember: boolean } {
  const args = asRecord(call.args);
  const path = typeof args?.path === 'string' ? args.path : undefined;
  const command = typeof args?.command === 'string' ? args.command : undefined;
  const identity = path === undefined ? stableStringify(call.args) : stableStringify({ path });
  const digest = createHash('sha256').update(identity).digest('hex');
  const detail = path ?? command ?? 'these exact arguments';
  return {
    key: `${call.name}:${digest}`,
    label: `${call.name}: ${singleLine(detail, 160)}`,
    remember,
  };
}

function matchesArguments(rule: PermissionRule, args: unknown): boolean {
  return (rule.match ?? []).every((matcher) => {
    const actual = resolvePointer(args, matcher.path);
    if (matcher.operator === 'equals') return Object.is(actual, matcher.value);
    if (typeof actual !== 'string') return false;
    return matcher.operator === 'prefix'
      ? actual.startsWith(matcher.value)
      : wildcardMatches(matcher.value, actual);
  });
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  let current = value;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    const record = asRecord(current);
    if (!record || !Object.hasOwn(record, key)) return undefined;
    current = record[key];
  }
  return current;
}

function wildcardMatches(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let retryValueIndex = -1;
  while (valueIndex < value.length) {
    if (pattern[patternIndex] === value[valueIndex]) {
      patternIndex += 1;
      valueIndex += 1;
    } else if (pattern[patternIndex] === '*') {
      starIndex = patternIndex;
      retryValueIndex = valueIndex;
      patternIndex += 1;
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      retryValueIndex += 1;
      valueIndex = retryValueIndex;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === '*') patternIndex += 1;
  return patternIndex === pattern.length;
}

function validateRule(rule: PermissionRule): void {
  if (!rule.id || !rule.tool || rule.tool.length > 256) throw new Error('Permission rule requires a valid id and tool pattern');
  if (rule.remember && rule.action !== 'ask') {
    throw new Error(`Permission rule ${rule.id} can only set remember when action is ask`);
  }
  for (const matcher of rule.match ?? []) {
    if (matcher.path !== '' && (!matcher.path.startsWith('/') || matcher.path.length > 512)) {
      throw new Error(`Permission rule ${rule.id} contains an invalid JSON pointer`);
    }
    if (/(?:~(?![01]))/u.test(matcher.path)) {
      throw new Error(`Permission rule ${rule.id} contains an invalid JSON pointer escape`);
    }
    if (typeof matcher.value === 'string' && matcher.value.length > 4_096) {
      throw new Error(`Permission rule ${rule.id} contains an oversized matcher value`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function singleLine(value: string, maximum: number): string {
  const normalized = value.replaceAll(/\s+/gu, ' ').trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}
