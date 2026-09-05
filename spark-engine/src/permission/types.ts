import type { ResolvedToolCall } from '../tools/contract.js';

export type GrantScope = 'once' | 'session';
/**
 * Three approval levels only:
 * - `manual`: read-only tools run free; write/edit and shell commands ask.
 * - `auto`: everything auto-approved, but explicit `deny` rules still bite.
 * - `bypass`: policy skipped entirely (deny rules included).
 * Legacy ledger values (`default`/`acceptEdits`/`plan`) are normalized on replay.
 */
export type PermissionMode = 'manual' | 'auto' | 'bypass';
export type PermissionRuleSource = 'builtin' | 'user' | 'project' | 'cli' | 'host';

export interface PermissionCheckContext {
  readonly sessionId: string;
  readonly cwd: string;
  readonly mode: PermissionMode;
}

export interface PermissionRuleReference {
  readonly id: string;
  readonly source: PermissionRuleSource;
}

export type PolicyDecision =
  | { readonly decision: 'allow'; readonly reason?: string; readonly rule?: PermissionRuleReference }
  | { readonly decision: 'deny'; readonly reason?: string; readonly rule?: PermissionRuleReference }
  | {
      readonly decision: 'ask';
      readonly reason?: string;
      readonly rule?: PermissionRuleReference;
      readonly allowedGrantScopes: readonly GrantScope[];
      readonly sessionScopeLabel?: string;
    };

export type PermissionDecision =
  | { readonly decision: 'allow'; readonly grantScope?: GrantScope }
  | { readonly decision: 'deny'; readonly reason?: string };

export interface PermissionRequest {
  readonly requestId: string;
  readonly call: ResolvedToolCall;
  readonly argsPreview: string;
  readonly reason?: string;
  readonly allowedGrantScopes: readonly GrantScope[];
  readonly sessionScopeLabel?: string;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'manual' || value === 'auto' || value === 'bypass';
}

/**
 * Ledger replay compatibility: old sessions persisted `default`/`acceptEdits`/
 * `plan`. All of them collapse to `manual` — the most conservative of the three
 * current modes — because `acceptEdits`' auto-edit behavior now lives in `auto`
 * (which would also silence shell approval) and `plan` no longer exists.
 */
export function normalizeLegacyPermissionMode(value: unknown): PermissionMode | undefined {
  if (isPermissionMode(value)) return value;
  if (value === 'default' || value === 'acceptEdits' || value === 'plan') return 'manual';
  return undefined;
}
