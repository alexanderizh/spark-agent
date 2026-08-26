import { resolve } from 'node:path'

import { createDefaultEnv } from '../env.js'
import { SessionLedger } from '../events/ledger.js'
import { findInterruptedTurn, scanOrphanIntents, type OrphanIntent } from '../events/recovery.js'
import type { AgentEvent } from '../events/schema.js'
import { SessionScheduler } from '../kernel/scheduler.js'
import { stableStringify } from '../kernel/stable-json.js'
import { TurnMachine, type RunTurnOptions, type TurnResult } from '../kernel/turn-machine.js'
import type { AgentEnv, BudgetLimits } from '../seams.js'
import type { LlmService } from '../seams.js'
import { isPermissionMode, type PermissionMode } from '../permission/types.js'
import type { ReasoningEffort } from '../llm/types.js'

export interface AgentOptions {
  readonly cwd?: string
  readonly dataRoot?: string
  readonly env?: AgentEnv
  readonly llm?: LlmService
  readonly engineVersion?: string
}

export interface SessionTurnOptions {
  readonly signal?: AbortSignal
  readonly budget?: Partial<BudgetLimits>
  readonly maxTokens?: number
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

  private constructor(options: AgentOptions) {
    this.#cwd = resolve(options.cwd ?? process.cwd())
    this.#engineVersion = options.engineVersion ?? '0.2.0'
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
    })
    this.#sessions.set(sessionId, session)
    return session
  }

  async openSession(sessionId: string): Promise<AgentSession> {
    const existing = this.#sessions.get(sessionId)
    if (existing) return existing
    const ledger = new SessionLedger(sessionId, this.#env.store, this.#env.clock)
    const events = await collect(ledger)
    if (events.length === 0) throw new Error(`Session not found: ${sessionId}`)
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
      env: this.#env,
      scheduler: this.#scheduler,
      recovery,
      permissionMode: permissionModeFromEvents(events),
    })
    this.#sessions.set(sessionId, session)
    return session
  }
}

interface AgentSessionOptions {
  readonly sessionId: string
  readonly cwd: string
  readonly env: AgentEnv
  readonly scheduler: SessionScheduler
  readonly recovery: SessionRecovery
  readonly permissionMode: PermissionMode
}

export class AgentSession {
  readonly sessionId: string
  readonly cwd: string
  readonly recovery: SessionRecovery
  /** Current permission mode; mutable only via setPermissionMode. */
  readonly #env: AgentEnv
  readonly #scheduler: SessionScheduler
  #permissionMode: PermissionMode

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId
    this.cwd = options.cwd
    this.recovery = options.recovery
    this.#permissionMode = options.permissionMode
    this.#env = options.env
    this.#scheduler = options.scheduler
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
          ...(options.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: options.reasoningEffort }),
          ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
          ...(options.onDelta === undefined ? {} : { onDelta: options.onDelta }),
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

function permissionModeFromConfig(config: Readonly<Record<string, unknown>>): PermissionMode {
  const value = config.permissionMode
  if (value === undefined) return 'default'
  if (!isPermissionMode(value)) throw new Error('Invalid permission mode in session config')
  return value
}

function permissionModeFromEvents(events: readonly AgentEvent[]): PermissionMode {
  const started = events.find((event) => event.type === 'session.started')
  if (started?.type !== 'session.started') return 'default'
  try {
    const config: unknown = JSON.parse(started.configSnapshot)
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'default'
    const value = (config as Record<string, unknown>).permissionMode
    return isPermissionMode(value) ? value : 'default'
  } catch {
    return 'default'
  }
}
