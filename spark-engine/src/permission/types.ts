import type { ResolvedToolCall } from '../tools/contract.js';

export type GrantScope = 'once' | 'session';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypass';
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
  return value === 'default' || value === 'acceptEdits' || value === 'plan' || value === 'bypass';
}
