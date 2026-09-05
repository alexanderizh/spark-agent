import { spawn } from 'node:child_process'

import {
  DEFAULT_HOOK_TIMEOUT_MS,
  type HookCommandConfig,
  type HookEventName,
  type HookInvocation,
  type HookOutcome,
  type HookResult,
  type HookRunContext,
  type HooksConfig,
} from './types.js'
import { wildcardMatches } from '../permission/policy.js'
import type { Telemetry } from '../seams.js'
import { NullTelemetry } from '../telemetry.js'

export interface HookSpawnRequest {
  readonly command: string
  readonly cwd: string
  /** JSON payload piped to the hook process stdin. */
  readonly input: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

export interface HookSpawnResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly spawnError?: string
}

export type HookSpawn = (request: HookSpawnRequest) => Promise<HookSpawnResult>

/** Hooks may stay chatty; keep the first 64 KiB of each stream. */
export const HOOK_OUTPUT_LIMIT_BYTES = 64 * 1024

/**
 * Default hook executor: runs the command through the platform shell with the
 * JSON payload on stdin. Spawn failures and aborts surface as `spawnError`
 * instead of rejecting, so hook problems never break a turn.
 */
export const nodeHookSpawn: HookSpawn = (request) =>
  new Promise((resolveSpawn) => {
    const useWindows = process.platform === 'win32'
    const child = spawn(
      useWindows ? 'cmd.exe' : '/bin/sh',
      useWindows ? ['/d', '/s', '/c', request.command] : ['-c', request.command],
      {
        cwd: request.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: request.signal,
      },
    )
    let settled = false
    let timedOut = false
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= HOOK_OUTPUT_LIMIT_BYTES) return
      stdoutBytes += chunk.length
      stdoutChunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= HOOK_OUTPUT_LIMIT_BYTES) return
      stderrBytes += chunk.length
      stderrChunks.push(chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, request.timeoutMs)
    const finish = (exitCode: number | null, spawnError?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin?.destroy()
      resolveSpawn({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        ...(spawnError === undefined ? {} : { spawnError }),
      })
    }
    child.on('error', (error: Error) => {
      finish(null, error.message)
    })
    child.on('close', (code) => {
      finish(code)
    })
  })

export interface HookRunnerOptions {
  readonly config: HooksConfig
  readonly spawn?: HookSpawn
  readonly telemetry?: Telemetry
}

/**
 * Executes configured hooks for a lifecycle event, in settings scope order.
 * Blocking semantics (exit code 2 or a `{"decision":"block"}` stdout payload)
 * short-circuit the remaining hooks; every other failure is non-blocking and
 * only surfaces through telemetry, so a broken hook can never wedge a turn.
 */
export class HookRunner {
  readonly #config: HooksConfig
  readonly #spawn: HookSpawn
  readonly #telemetry: Telemetry

  constructor(options: HookRunnerOptions) {
    this.#config = options.config
    this.#spawn = options.spawn ?? nodeHookSpawn
    this.#telemetry = options.telemetry ?? new NullTelemetry()
  }

  async run(
    event: HookEventName,
    invocation: HookInvocation,
    context: HookRunContext,
    signal: AbortSignal,
  ): Promise<HookOutcome> {
    const results: HookResult[] = []
    let approved = false
    for (const matcher of this.#config[event] ?? []) {
      if (signal.aborted) break
      if (!matcherApplies(matcher.matcher, event, invocation)) continue
      for (const hook of matcher.hooks) {
        if (signal.aborted) break
        const result = await this.#execute(hook, event, invocation, context, signal)
        results.push(result)
        if (result.blocked) {
          return {
            results,
            blocked: true,
            approved: false,
            reason: result.reason ?? `Blocked by ${event} hook`,
          }
        }
        if (result.decision === 'approve') approved = true
      }
    }
    return { results, blocked: false, approved }
  }

  async #execute(
    hook: HookCommandConfig,
    event: HookEventName,
    invocation: HookInvocation,
    context: HookRunContext,
    signal: AbortSignal,
  ): Promise<HookResult> {
    const startedAt = Date.now()
    const base = {
      command: hook.command,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      blocked: false,
      stdout: '',
      stderr: '',
      failed: false,
    }
    const timeoutMs = hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
    let spawnResult: HookSpawnResult
    try {
      spawnResult = await this.#spawn({
        command: hook.command,
        cwd: context.cwd,
        input: buildPayload(event, invocation, context),
        timeoutMs,
        signal,
      })
    } catch (error) {
      this.#telemetry.counter('hook.spawn.failed', { event })
      return {
        ...base,
        durationMs: Date.now() - startedAt,
        stderr: error instanceof Error ? error.message : String(error),
        failed: true,
      }
    }
    const durationMs = Date.now() - startedAt
    if (spawnResult.spawnError !== undefined) {
      this.#telemetry.counter('hook.spawn.failed', { event })
      return {
        ...base,
        durationMs,
        stderr: spawnResult.spawnError,
        failed: !signal.aborted,
      }
    }
    const decision = parseDecision(spawnResult.stdout)
    const blocked = spawnResult.exitCode === 2 || decision.decision === 'block'
    const failed = !blocked && !spawnResult.timedOut && spawnResult.exitCode !== 0
    if (failed || spawnResult.timedOut) {
      this.#telemetry.counter('hook.failed', { event, timedOut: String(spawnResult.timedOut) })
    }
    let reason: string | undefined
    if (decision.decision === 'block') reason = decision.reason
    else if (spawnResult.exitCode === 2) {
      reason = nonEmpty(spawnResult.stderr) ?? nonEmpty(spawnResult.stdout)
    }
    return {
      command: hook.command,
      exitCode: spawnResult.exitCode,
      timedOut: spawnResult.timedOut,
      durationMs,
      blocked,
      ...(decision.decision === undefined ? {} : { decision: decision.decision }),
      ...(reason === undefined ? {} : { reason }),
      stdout: spawnResult.stdout,
      stderr: spawnResult.stderr,
      failed,
    }
  }
}

/** Tool-name glob filter; only consulted for PreToolUse / PostToolUse events. */
function matcherApplies(
  matcher: string | undefined,
  event: HookEventName,
  invocation: HookInvocation,
): boolean {
  if (matcher === undefined) return true
  if (event !== 'PreToolUse' && event !== 'PostToolUse') return true
  if (invocation.toolName === undefined) return false
  return wildcardMatches(matcher, invocation.toolName)
}

function buildPayload(
  event: HookEventName,
  invocation: HookInvocation,
  context: HookRunContext,
): string {
  const payload: Record<string, unknown> = {
    session_id: context.sessionId,
    cwd: context.cwd,
    permission_mode: context.permissionMode,
    hook_event_name: event,
  }
  if (invocation.turnId !== undefined) payload.turn_id = invocation.turnId
  if (invocation.prompt !== undefined) payload.prompt = invocation.prompt
  if (invocation.toolName !== undefined) payload.tool_name = invocation.toolName
  if (invocation.toolInput !== undefined) payload.tool_input = invocation.toolInput
  if (invocation.toolOk !== undefined) payload.tool_ok = invocation.toolOk
  if (invocation.toolOutputPreview !== undefined) {
    payload.tool_output = invocation.toolOutputPreview
  }
  if (invocation.stopReason !== undefined) payload.stop_reason = invocation.stopReason
  return JSON.stringify(payload)
}

function parseDecision(stdout: string): { decision?: 'block' | 'approve'; reason?: string } {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Readonly<Record<string, unknown>>
  const reason = typeof record.reason === 'string' ? record.reason : undefined
  if (record.decision === 'block') {
    return { decision: 'block', ...(reason === undefined ? {} : { reason }) }
  }
  if (record.decision === 'approve') {
    return { decision: 'approve', ...(reason === undefined ? {} : { reason }) }
  }
  return {}
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
