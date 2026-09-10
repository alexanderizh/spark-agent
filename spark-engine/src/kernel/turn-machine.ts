import { SessionLedger } from '../events/ledger.js'
import {
  type AgentEvent,
  type BoundEventDraft,
  type ErrorInfo,
  type TurnStats,
  type Usage,
} from '../events/schema.js'
import { consumeLlmStream } from '../llm/consume.js'
import type { LlmDelta, LlmRequest, ReasoningEffort } from '../llm/types.js'
import { resolveOutputBudget } from '../llm/budget.js'
import { thinkingConfigFor } from '../llm/types.js'
import type { PermissionMode } from '../permission/types.js'
import type { AgentEnv, BudgetLimits, SubagentRunner } from '../seams.js'
import { CancellationTree, isAbortError, throwIfAborted } from './cancellation.js'
import { toErrorInfo } from './errors.js'
import { ToolRunner } from './tool-runner.js'
import { TurnGate } from './turn-gate.js'

type TerminalEvent = Extract<
  AgentEvent,
  { type: 'turn.completed' | 'turn.cancelled' | 'turn.failed' }
>

export interface RunTurnOptions {
  readonly sessionId: string
  readonly turnId: string
  readonly input: string
  readonly cwd: string
  readonly permissionMode: PermissionMode
  readonly parentId?: string
  readonly signal?: AbortSignal
  readonly budget?: Partial<BudgetLimits>
  readonly maxTokens?: number
  /** Optional orchestration seam used by the built-in task tool. */
  readonly subagent?: SubagentRunner
  /** User-selected reasoning effort; omitted keeps the protocol default. */
  readonly reasoningEffort?: ReasoningEffort
  /** Explicit provider thinking budget; omitted uses the effort preset. */
  readonly reasoningBudgetTokens?: number
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void
  readonly onDelta?: (delta: LlmDelta) => Promise<void> | void
}

export interface TurnResult {
  readonly turnId: string
  readonly terminal: TerminalEvent
}

export class TurnMachine {
  constructor(private readonly env: AgentEnv) {}

  async run(options: RunTurnOptions): Promise<TurnResult> {
    const ledger = new SessionLedger(options.sessionId, this.env.store, this.env.clock)
    const gate = new TurnGate(this.env.telemetry)
    const cancellation = new CancellationTree(options.signal)
    const budget = this.env.budgets.create(options.budget)
    const completedSteps: number[] = []
    let budgetWarning: string | undefined
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let llmMsTotal = 0
    let reasoningTokensTotal = 0
    let turnTtftMs: number | undefined

    const append = async (draft: BoundEventDraft): Promise<AgentEvent> => {
      const event = await ledger.append(draft)
      try {
        await options.onEvent?.(event)
      } catch {
        this.env.telemetry.counter('observer.event.failed', { type: event.type })
      }
      return event
    }
    const stats = (): TurnStats => {
      const snapshot = budget.snapshot()
      return {
        steps: snapshot.steps,
        toolCalls: snapshot.toolCalls,
        usage: {
          inputTokens: snapshot.inputTokens,
          outputTokens: snapshot.outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          reasoningTokens: reasoningTokensTotal,
        },
        wallMs: snapshot.wallMs,
        llmMs: llmMsTotal,
        ttftMs: turnTtftMs ?? 0,
        costUsd: snapshot.costUsd,
      }
    }

    try {
      await append({
        type: 'turn.started',
        schemaVersion: 1,
        turnId: options.turnId,
        input: { kind: 'text', text: options.input },
        ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
      })

      const hooks = this.env.hooks
      if (hooks) {
        const hookContext = {
          sessionId: options.sessionId,
          cwd: options.cwd,
          permissionMode: options.permissionMode,
        }
        const submitted = await hooks.run(
          'UserPromptSubmit',
          { turnId: options.turnId, prompt: options.input },
          hookContext,
          cancellation.signal,
        )
        if (submitted.blocked) {
          const terminal = await gate.finalize(async () =>
            asTerminal(
              await append({
                type: 'turn.failed',
                schemaVersion: 1,
                turnId: options.turnId,
                error: {
                  code: 'hook.blocked',
                  message: submitted.reason ?? 'Prompt rejected by a UserPromptSubmit hook.',
                  retryable: false,
                },
                recoveryHint:
                  'Adjust or remove the blocking UserPromptSubmit hook, then resubmit the prompt.',
              }),
            ),
          )
          if (!terminal) throw new Error('Turn terminal event was unexpectedly swallowed')
          return { turnId: options.turnId, terminal }
        }
      }

      while (true) {
        throwIfAborted(cancellation.signal)
        const stepId = this.env.ids.next('step')
        const history = await collectEvents(ledger)
        const projected = this.env.projector.project(history, {
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
        })
        const system = await this.env.prompt.compose(
          {
            sessionId: options.sessionId,
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
          },
          {
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
          },
        )
        await append({
          type: 'step.started',
          schemaVersion: 1,
          stepId,
          turnId: options.turnId,
        })

        const modelBudget = this.env.llm.getModelBudget?.()
        const tools = this.env.tools.registry.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }))
        const request: LlmRequest = {
          system,
          messages: projected.messages,
          tools,
          ...(options.reasoningEffort === undefined
            ? {}
            : {
                thinking: thinkingConfigFor(options.reasoningEffort, options.reasoningBudgetTokens),
              }),
          maxTokens: resolveOutputBudget({
            ...(options.maxTokens === undefined ? {} : { requestedMaxTokens: options.maxTokens }),
            ...(modelBudget === undefined ? {} : { modelBudget }),
            system,
            messages: projected.messages,
            tools,
          }).maxTokens,
          metadata: {
            sessionId: options.sessionId,
            turnId: options.turnId,
            stepId,
          },
        }
        const response = await consumeLlmStream(
          this.env.llm.stream(request, {
            signal: cancellation.signal,
            turnId: options.turnId,
            stepId,
          }),
          async (delta) => {
            try {
              await options.onDelta?.(delta)
            } catch {
              this.env.telemetry.counter('observer.delta.failed', { type: delta.type })
            }
          },
        )
        const assistantEvent = await append({
          type: 'assistant.completed',
          schemaVersion: 1,
          stepId,
          turnId: options.turnId,
          message: response.message,
          usage: response.usage,
          llmMs: response.llmMs,
          ttftMs: response.ttftMs,
        })
        completedSteps.push(assistantEvent.seq)
        cacheReadTokens += response.usage.cacheReadTokens
        cacheWriteTokens += response.usage.cacheWriteTokens
        llmMsTotal += response.llmMs
        reasoningTokensTotal += response.usage.reasoningTokens
        turnTtftMs ??= response.ttftMs

        if (response.message.toolCalls.length > 0) {
          const runner = new ToolRunner({
            env: this.env,
            ledger,
            stepId,
            sessionId: options.sessionId,
            turnId: options.turnId,
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            ...(options.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: options.reasoningEffort }),
            ...(options.reasoningBudgetTokens === undefined
              ? {}
              : { reasoningBudgetTokens: options.reasoningBudgetTokens }),
            signal: cancellation.signal,
            ...(options.subagent === undefined ? {} : { subagent: options.subagent }),
            ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
          })
          await runner.run(response.message.toolCalls)
        }

        const action = budget.onStep({
          ...usageToBudget(response.usage),
          costUsd: 0,
          toolCalls: response.message.toolCalls.length,
        })
        if (response.message.toolCalls.length === 0) {
          this.env.tools.executor.assertTurnSettled?.(options)
          const terminal = await gate.finalize(async () =>
            asTerminal(
              await append({
                type: 'turn.completed',
                schemaVersion: 1,
                turnId: options.turnId,
                reason: 'final',
                stats: stats(),
              }),
            ),
          )
          if (!terminal) throw new Error('Turn terminal event was unexpectedly swallowed')
          await this.#runStopHook(options, 'final', cancellation.signal)
          return { turnId: options.turnId, terminal }
        }
        if (action.kind === 'stop') {
          this.env.tools.executor.assertTurnSettled?.(options)
          const terminal = await gate.finalize(async () =>
            asTerminal(
              await append({
                type: 'turn.completed',
                schemaVersion: 1,
                turnId: options.turnId,
                reason: 'budget',
                stats: stats(),
              }),
            ),
          )
          if (!terminal) throw new Error('Turn terminal event was unexpectedly swallowed')
          await this.#runStopHook(options, 'budget', cancellation.signal)
          return { turnId: options.turnId, terminal }
        }
        budgetWarning = action.kind === 'warn' ? action.message : undefined
      }
    } catch (error) {
      const terminal = await gate.finalize(async () => {
        if (isAbortError(error) || cancellation.signal.aborted) {
          return asTerminal(
            await append({
              type: 'turn.cancelled',
              schemaVersion: 1,
              turnId: options.turnId,
              partial: completedSteps,
            }),
          )
        }
        const errorInfo = toErrorInfo(error)
        return asTerminal(
          await append({
            type: 'turn.failed',
            schemaVersion: 1,
            turnId: options.turnId,
            error: errorInfo,
            recoveryHint: recoveryHintFor(errorInfo),
          }),
        )
      })
      if (!terminal) throw error
      return { turnId: options.turnId, terminal }
    } finally {
      try {
        await this.env.tools.executor.closeTurn?.(options)
      } finally {
        cancellation.dispose()
      }
    }
  }

  /**
   * Stop hooks run after a completed terminal event; they are notifications
   * only — a failing or blocking Stop hook can no longer alter the turn.
   */
  async #runStopHook(
    options: RunTurnOptions,
    reason: 'final' | 'budget',
    signal: AbortSignal,
  ): Promise<void> {
    const hooks = this.env.hooks
    if (!hooks) return
    try {
      await hooks.run(
        'Stop',
        { turnId: options.turnId, stopReason: reason },
        {
          sessionId: options.sessionId,
          cwd: options.cwd,
          permissionMode: options.permissionMode,
        },
        signal,
      )
    } catch {
      this.env.telemetry.counter('hook.run.failed', { event: 'Stop' })
    }
  }
}

async function collectEvents(ledger: SessionLedger): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of ledger.read()) events.push(event)
  return events
}

function recoveryHintFor(error: ErrorInfo): string {
  if (error.code === 'llm.partial_stream_failed') {
    if (nestedErrorCode(error.detail)?.endsWith('.invalid_tool_json')) {
      return 'The model repeatedly produced invalid tool arguments. Retry with lower reasoning effort or choose a model with more reliable tool calling.'
    }
    return 'Retry the turn; if it repeats, inspect the recorded root cause and check the model gateway or network.'
  }
  if (error.code === 'llm.retry_delay_exceeded') {
    return 'Retry later, configure a larger retry_max_delay_ms, or add a failover model.'
  }
  return error.retryable
    ? 'Retry the turn; the failure was classified as transient.'
    : 'Inspect the event log and correct the reported boundary failure before retrying.'
}

function nestedErrorCode(detail: unknown): string | undefined {
  if (typeof detail !== 'object' || detail === null) return undefined
  const cause = (detail as Record<string, unknown>).cause
  if (typeof cause !== 'object' || cause === null) return undefined
  const code = (cause as Record<string, unknown>).code
  return typeof code === 'string' ? code : undefined
}

function usageToBudget(
  usage: Usage,
): Omit<
  Parameters<ReturnType<AgentEnv['budgets']['create']>['onStep']>[0],
  'costUsd' | 'toolCalls'
> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }
}

function asTerminal(event: AgentEvent): TerminalEvent {
  if (
    event.type !== 'turn.completed' &&
    event.type !== 'turn.cancelled' &&
    event.type !== 'turn.failed'
  ) {
    throw new Error(`Expected terminal event, got ${event.type}`)
  }
  return event
}
