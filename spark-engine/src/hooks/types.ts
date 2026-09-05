import { z } from 'zod'

import type { PermissionMode } from '../permission/types.js'

/**
 * Deterministic subset of the Claude Code hook model: four lifecycle events
 * (prompt submitted, before/after each tool call, turn finished) executed as
 * shell commands with a JSON contract. The event list is a closed union so
 * settings files cannot smuggle in unknown event names.
 */
export const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

export type HookEventName = (typeof HOOK_EVENTS)[number]

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000

const HookCommandSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1).max(8_192),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
})

export type HookCommandConfig = z.output<typeof HookCommandSchema>

const HookMatcherSchema = z.object({
  /** Tool-name glob; only consulted for PreToolUse / PostToolUse. Absent = all tools. */
  matcher: z.string().min(1).max(256).optional(),
  hooks: z.array(HookCommandSchema).min(1).max(16),
})

export type HookMatcherConfig = z.output<typeof HookMatcherSchema>

export const HooksConfigSchema = z.object({
  UserPromptSubmit: z.array(HookMatcherSchema).max(32).optional(),
  PreToolUse: z.array(HookMatcherSchema).max(32).optional(),
  PostToolUse: z.array(HookMatcherSchema).max(32).optional(),
  Stop: z.array(HookMatcherSchema).max(32).optional(),
})

export type HooksConfig = z.output<typeof HooksConfigSchema>

/** Per-run context resolved by the caller (session-scoped, unlike the shared runner). */
export interface HookRunContext {
  readonly sessionId: string
  readonly cwd: string
  readonly permissionMode: PermissionMode
}

/** Event-specific fields; only the relevant subset is set per event. */
export interface HookInvocation {
  readonly turnId?: string
  readonly prompt?: string
  readonly toolName?: string
  readonly toolInput?: unknown
  readonly toolOk?: boolean
  readonly toolOutputPreview?: string
  readonly stopReason?: string
}

/** Result of one hook command execution. */
export interface HookResult {
  readonly command: string
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly durationMs: number
  /** True when the hook blocked via exit code 2 or a `block` decision. */
  readonly blocked: boolean
  readonly decision?: 'block' | 'approve'
  readonly reason?: string
  readonly stdout: string
  readonly stderr: string
  /** True when the hook failed in a non-blocking way (spawn error, unexpected exit code). */
  readonly failed: boolean
}

export interface HookOutcome {
  readonly results: readonly HookResult[]
  readonly blocked: boolean
  /** PreToolUse only: a hook explicitly approved, skipping the permission ask. */
  readonly approved: boolean
  readonly reason?: string
}
