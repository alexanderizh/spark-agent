import { resolve } from 'node:path'

import { createDefaultEnv } from '../env.js'
import { SessionLedger } from '../events/ledger.js'
import { findInterruptedTurn, scanOrphanIntents, type OrphanIntent } from '../events/recovery.js'
import type { AgentEvent } from '../events/schema.js'
import { abortError, throwIfAborted } from '../kernel/cancellation.js'
import { SessionScheduler } from '../kernel/scheduler.js'
import { stableStringify } from '../kernel/stable-json.js'
import { TurnMachine, type RunTurnOptions, type TurnResult } from '../kernel/turn-machine.js'
import type {
  AgentEnv,
  BudgetLimits,
  SessionMeta,
  SessionListOptions,
  SubagentRunRequest,
  SubagentRunResult,
  SubagentRunner,
} from '../seams.js'
import type { LlmService } from '../seams.js'
import { normalizeLegacyPermissionMode, type PermissionMode } from '../permission/types.js'
import type { ReasoningEffort } from '../llm/types.js'
import { AllowlistToolRegistry } from '../tools/registry.js'
import { SPARK_ENGINE_VERSION } from '../version.js'

export interface AgentOptions {
  readonly cwd?: string
  readonly dataRoot?: string
  readonly env?: AgentEnv
  readonly llm?: LlmService
  readonly engineVersion?: string
  /** Maximum child sessions executing concurrently across this Agent instance. */
  readonly maxConcurrentSubagents?: number
}

export interface SessionTurnOptions {
  readonly signal?: AbortSignal
  readonly budget?: Partial<BudgetLimits>
  readonly maxTokens?: number
  /** Parent turn id used when this session is a subagent. */
  readonly parentId?: string
  /** User-selected reasoning effort for this turn chain; omitted = protocol default. */
  readonly reasoningEffort?: ReasoningEffort
  readonly onEvent?: RunTurnOptions['onEvent']
  readonly onDelta?: RunTurnOptions['onDelta']
}

export interface SessionRecovery {
  readonly interruptedTurnId?: string
  readonly orphanIntents: readonly OrphanIntent[]
}

export class Agent {
  readonly #env: AgentEnv
  readonly #cwd: string
  readonly #engineVersion: string
  readonly #scheduler = new SessionScheduler()
  readonly #sessions = new Map<string, AgentSession>()
  readonly #subagent: SubagentRunner
  readonly #subagentLimiter: SubagentLimiter

  private constructor(options: AgentOptions) {
    this.#cwd = resolve(options.cwd ?? process.cwd())
    this.#engineVersion = options.engineVersion ?? SPARK_ENGINE_VERSION
    if (options.env) this.#env = options.env
    else if (options.llm) {
      this.#env = createDefaultEnv({
        cwd: this.#cwd,
        llm: options.llm,
        ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
      })
    } else {
      throw new Error('Agent.open requires an LlmService or a complete AgentEnv')
    }
    this.#subagentLimiter = new SubagentLimiter(
      validateSubagentConcurrency(options.maxConcurrentSubagents ?? 4),
    )
    this.#subagent = { run: (request) => this.#runSubagent(request) }
  }

  static open(options: AgentOptions = {}): Agent {
    return new Agent(options)
  }

  get env(): AgentEnv {
    return this.#env
  }

  async newSession(config: Readonly<Record<string, unknown>> = {}): Promise<AgentSession> {
    const permissionMode = permissionModeFromConfig(config)
    const sessionId = this.#env.ids.next('session')
    const ledger = new SessionLedger(sessionId, this.#env.store, this.#env.clock)
    await ledger.append({
      type: 'session.started',
      schemaVersion: 1,
      engineVersion: this.#engineVersion,
      cwd: this.#cwd,
      configSnapshot: stableStringify(config),
    })
    const session = new AgentSession({
      sessionId,
      cwd: this.#cwd,
      env: this.#env,
      scheduler: this.#scheduler,
      recovery: { orphanIntents: [] },
      permissionMode,
      subagent: this.#subagent,
    })
    this.#sessions.set(sessionId, session)
    return session
  }

  /** User-facing sessions for this cwd, most recently updated first. */
  async listSessions(options: SessionListOptions = {}): Promise<SessionMeta[]> {
    return this.#env.store.list(this.#cwd, options)
  }

  async openSession(sessionId: string): Promise<AgentSession> {
    const existing = this.#sessions.get(sessionId)
    if (existing) return existing
    const ledger = new SessionLedger(sessionId, this.#env.store, this.#env.clock)
    const events = await collect(ledger)
    if (events.length === 0) throw new Error(`Session not found: ${sessionId}`)
    const subagentConfig = readSubagentConfig(events)
    let sessionEnv = this.#env
    let subagent: SubagentRunner | undefined = this.#subagent
    if (subagentConfig !== undefined) {
      const allowed = resolveSubagentTools(this.#env, subagentConfig.allowedTools)
      if (!allowed.ok) {
        throw new Error(`Cannot resume subagent session ${sessionId}: ${allowed.content}`)
      }
      sessionEnv = restrictAgentEnv(this.#env, allowed.tools)
      // A resumed internal session must keep the same non-recursive boundary
      // as a live child, even when opened through the public Agent API.
      subagent = undefined
    }
    const interruptedTurnId = findInterruptedTurn(events)
    const orphanIntents = scanOrphanIntents(events)
    if (interruptedTurnId) {
      await ledger.append({
        type: 'turn.failed',
        schemaVersion: 1,
        turnId: interruptedTurnId,
        error: {
          code: 'kernel.crash_recovery',
          message: 'The previous engine process ended before the turn reached a terminal event.',
          retryable: false,
          detail: { orphanCallIds: orphanIntents.map((intent) => intent.callId) },
        },
        recoveryHint:
          'Inspect orphan tool intents before retrying. Non-idempotent tools are never replayed automatically.',
      })
    }
    const recovery: SessionRecovery = {
      ...(interruptedTurnId === undefined ? {} : { interruptedTurnId }),
      orphanIntents,
    }
    const session = new AgentSession({
      sessionId,
      cwd: this.#cwd,
      env: sessionEnv,
      scheduler: this.#scheduler,
      recovery,
      permissionMode: permissionModeFromEvents(events),
      ...(subagent === undefined ? {} : { subagent }),
    })
    this.#sessions.set(sessionId, session)
    return session
  }

  async #runSubagent(request: SubagentRunRequest): Promise<SubagentRunResult> {
    return this.#subagentLimiter.run(request.signal, () => this.#runSubagentWithPermit(request))
  }

  async #runSubagentWithPermit(request: SubagentRunRequest): Promise<SubagentRunResult> {
    const allowed = resolveSubagentTools(this.#env, request.allowedTools)
    if (!allowed.ok) return allowed

    const childEnv = restrictAgentEnv(this.#env, allowed.tools)
    const childAgent = new Agent({
      cwd: request.cwd,
      env: childEnv,
      engineVersion: this.#engineVersion,
    })
    const childSession = await childAgent.newSession({
      kind: 'subagent',
      description: request.description,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      permissionMode: request.permissionMode,
      allowedTools: allowed.tools,
    })
    try {
      const turn = await childSession.turn(request.prompt, {
        parentId: request.parentTurnId,
        signal: request.signal,
        budget: {
          maxInputTokens: 250_000,
          maxCostUsd: 100,
          maxWallMs: 10 * 60 * 1_000,
          maxSteps: request.maxSteps ?? 20,
          maxToolCalls: request.maxToolCalls ?? 100,
        },
        ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
        ...(request.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: request.reasoningEffort }),
      })
      const events = await collectEvents(childSession)
      const answer = latestAssistantText(events, turn.turnId)
      const sessionSuffix = `Subagent session: ${childSession.sessionId}`
      if (turn.terminal.type === 'turn.completed' && turn.terminal.reason === 'final') {
        return {
          ok: true,
          sessionId: childSession.sessionId,
          content: `${sessionSuffix}\n${answer || 'The subagent completed without a final text response.'}`,
        }
      }
      const failure =
        turn.terminal.type === 'turn.failed'
          ? turn.terminal.error.message
          : turn.terminal.type === 'turn.completed'
            ? 'The subagent exhausted its budget before reaching a final answer.'
            : 'The subagent was cancelled before completing.'
      return {
        ok: false,
        sessionId: childSession.sessionId,
        content: `${sessionSuffix}\nSubagent did not complete: ${failure}${answer ? `\nPartial result:\n${answer}` : ''}`,
      }
    } catch (error) {
      return {
        ok: false,
        sessionId: childSession.sessionId,
        content: `Subagent session ${childSession.sessionId} failed: ${errorMessage(error)}`,
      }
    }
  }
}

function validateSubagentConcurrency(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error('maxConcurrentSubagents must be an integer from 1 to 32')
  }
  return value
}

class SubagentLimiter {
  readonly #waiters: (() => void)[] = []
  #active = 0

  constructor(private readonly limit: number) {}

  async run<Result>(signal: AbortSignal, operation: () => Promise<Result>): Promise<Result> {
    const release = await this.#acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async #acquire(signal: AbortSignal): Promise<() => void> {
    throwIfAborted(signal)
    if (this.#active < this.limit) {
      this.#active += 1
      return () => {
        this.#release()
      }
    }

    await new Promise<void>((resolveWaiter, rejectWaiter) => {
      const resume = () => {
        signal.removeEventListener('abort', cancel)
        resolveWaiter()
      }
      const cancel = () => {
        const index = this.#waiters.indexOf(resume)
        if (index >= 0) this.#waiters.splice(index, 1)
        rejectWaiter(abortError(signal.reason))
      }
      this.#waiters.push(resume)
      signal.addEventListener('abort', cancel, { once: true })
    })
    return () => {
      this.#release()
    }
  }

  #release(): void {
    const next = this.#waiters.shift()
    if (next) {
      // Transfer the existing permit directly so a new caller cannot race the
      // resumed waiter and temporarily exceed the configured concurrency.
      next()
      return
    }
    this.#active -= 1
  }
}

interface AgentSessionOptions {
  readonly sessionId: string
  readonly cwd: string
  readonly env: AgentEnv
  readonly scheduler: SessionScheduler
  readonly recovery: SessionRecovery
  readonly permissionMode: PermissionMode
  readonly subagent?: SubagentRunner
}

export class AgentSession {
  readonly sessionId: string
  readonly cwd: string
  readonly recovery: SessionRecovery
  /** Current permission mode; mutable only via setPermissionMode. */
  readonly #env: AgentEnv
  readonly #scheduler: SessionScheduler
  readonly #subagent: SubagentRunner | undefined
  #permissionMode: PermissionMode

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId
    this.cwd = options.cwd
    this.recovery = options.recovery
    this.#permissionMode = options.permissionMode
    this.#env = options.env
    this.#scheduler = options.scheduler
    this.#subagent = options.subagent
  }

  get permissionMode(): PermissionMode {
    return this.#permissionMode
  }

  /**
   * Switches the permission policy for the rest of the session (subsequent
   * turns run under it). Session-scoped by design: a new session starts from
   * its config snapshot, so `--permission-mode` stays the durable default.
   */
  setPermissionMode(mode: PermissionMode): void {
    this.#permissionMode = mode
  }

  turn(input: string, options: SessionTurnOptions = {}): Promise<TurnResult> {
    const turnId = this.#env.ids.next('turn')
    const ledger = new SessionLedger(this.sessionId, this.#env.store, this.#env.clock)
    const notify = async (event: AgentEvent): Promise<void> => {
      try {
        await options.onEvent?.(event)
      } catch {
        this.#env.telemetry.counter('observer.event.failed', { type: event.type })
      }
    }
    return this.#scheduler.schedule({
      sessionId: this.sessionId,
      onQueued: async () => {
        const event = await ledger.append({
          type: 'turn.queued',
          schemaVersion: 1,
          turnId,
        })
        await notify(event)
      },
      run: async () =>
        new TurnMachine(this.#env).run({
          sessionId: this.sessionId,
          turnId,
          input,
          cwd: this.cwd,
          permissionMode: this.#permissionMode,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.budget === undefined ? {} : { budget: options.budget }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
          ...(options.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: options.reasoningEffort }),
          ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
          ...(options.onDelta === undefined ? {} : { onDelta: options.onDelta }),
          ...(this.#subagent === undefined ? {} : { subagent: this.#subagent }),
        }),
    })
  }

  events(fromSeq = 0): AsyncIterable<AgentEvent> {
    return this.#env.store.read(this.sessionId, fromSeq)
  }

  async fork(uptoSeq: number): Promise<string> {
    return this.#env.store.fork(this.sessionId, uptoSeq)
  }

  queuedTurns(): number {
    return this.#scheduler.queued(this.sessionId)
  }
}

async function collect(ledger: SessionLedger): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of ledger.read()) events.push(event)
  return events
}

async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of session.events()) events.push(event)
  return events
}

function latestAssistantText(events: readonly AgentEvent[], turnId: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant.completed' || event.turnId !== turnId) continue
    const text = event.message.text?.trim()
    if (text) return text
  }
  return ''
}

type ResolvedSubagentTools =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly content: string }

function resolveSubagentTools(
  env: AgentEnv,
  requested: readonly string[] | undefined,
): ResolvedSubagentTools {
  const available = new Map(env.tools.registry.list().map((tool) => [tool.name, tool]))
  const names =
    requested ??
    env.tools.registry
      .list()
      .filter((tool) => tool.readonly)
      .map((tool) => tool.name)
  const unknown = names.filter((name) => !available.has(name))
  if (unknown.length > 0) {
    return { ok: false, content: `Task requested unavailable tools: ${unknown.join(', ')}` }
  }
  if (names.includes('task')) {
    return { ok: false, content: 'Task subagents cannot invoke the task tool recursively.' }
  }
  return { ok: true, tools: [...names] }
}

function restrictAgentEnv(env: AgentEnv, allowedTools: readonly string[]): AgentEnv {
  return {
    ...env,
    tools: {
      ...env.tools,
      registry: new AllowlistToolRegistry(env.tools.registry, allowedTools),
    },
  }
}

function readSubagentConfig(
  events: readonly AgentEvent[],
): { readonly allowedTools?: readonly string[] } | undefined {
  const started = events.find((event) => event.type === 'session.started')
  if (started?.type !== 'session.started') return undefined
  try {
    const config: unknown = JSON.parse(started.configSnapshot)
    if (!isRecord(config) || config.kind !== 'subagent') return undefined
    if (config.allowedTools === undefined) return {}
    if (!isStringArray(config.allowedTools)) {
      throw new Error('stored allowedTools is not an array of strings')
    }
    return { allowedTools: config.allowedTools }
  } catch (error) {
    throw new Error(`Invalid subagent session configuration: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const DEFAULT_PERMISSION_MODE: PermissionMode = 'manual'

function permissionModeFromConfig(config: Readonly<Record<string, unknown>>): PermissionMode {
  const value = config.permissionMode
  if (value === undefined) return DEFAULT_PERMISSION_MODE
  const normalized = normalizeLegacyPermissionMode(value)
  if (!normalized) throw new Error('Invalid permission mode in session config')
  return normalized
}

function permissionModeFromEvents(events: readonly AgentEvent[]): PermissionMode {
  const started = events.find((event) => event.type === 'session.started')
  if (started?.type !== 'session.started') return DEFAULT_PERMISSION_MODE
  try {
    const config: unknown = JSON.parse(started.configSnapshot)
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      return DEFAULT_PERMISSION_MODE
    }
    const value = (config as Record<string, unknown>).permissionMode
    return normalizeLegacyPermissionMode(value) ?? DEFAULT_PERMISSION_MODE
  } catch {
    return DEFAULT_PERMISSION_MODE
  }
}
