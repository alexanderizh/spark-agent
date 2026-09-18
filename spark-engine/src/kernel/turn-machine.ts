import { SessionLedger } from '../events/ledger.js'
import {
  type AgentEvent,
  type BoundEventDraft,
  type ErrorInfo,
  type TurnInputImage,
  type TurnStats,
  type Usage,
} from '../events/schema.js'
import { consumeLlmStream } from '../llm/consume.js'
import type {
  IrImagePart,
  IrImageRef,
  IrMessage,
  LlmDelta,
  LlmRequest,
  ReasoningEffort,
} from '../llm/types.js'
import { estimateRequestTokens, resolveOutputBudget } from '../llm/budget.js'
import { thinkingConfigFor } from '../llm/types.js'
import type { PermissionMode } from '../permission/types.js'
import type { AgentEnv, BudgetLimits, SubagentRunner } from '../seams.js'
import {
  ContextCompactor,
  DEFAULT_ASSUMED_CONTEXT_WINDOW_TOKENS,
  DEFAULT_COMPACTION_POLICY,
  isContextOverflowError,
  slimToolResults,
} from './compaction.js'
import { CancellationTree, isAbortError, throwIfAborted } from './cancellation.js'
import { KernelError, toErrorInfo } from './errors.js'
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
  /**
   * Images already persisted in the artifact store. The turn only records
   * their references; bytes are resolved per request.
   */
  readonly images?: readonly TurnInputImage[]
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
    const imageCache = new Map<string, IrImagePart>()
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let llmMsTotal = 0
    let reasoningTokensTotal = 0
    let turnTtftMs: number | undefined

    // Context management: history is buffered in memory and extended
    // incrementally from the store, so a long turn never re-reads the whole
    // ledger on every step.
    const history: AgentEvent[] = []
    let pulledThrough = -1
    const pullEvents = async (): Promise<void> => {
      for await (const event of ledger.read(pulledThrough + 1)) {
        history.push(event)
        pulledThrough = event.seq
      }
    }
    const compactionPolicy = {
      ...DEFAULT_COMPACTION_POLICY,
      ...(this.env.context?.compaction ?? {}),
    }
    const compactor = new ContextCompactor(this.env, compactionPolicy)
    let compactions = 0
    let slimmedToolResults = 0
    const contextWindowTokens = (): number =>
      this.env.llm.getModelBudget?.()?.contextWindowTokens ?? DEFAULT_ASSUMED_CONTEXT_WINDOW_TOKENS

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
        compactions,
        slimmedToolResults,
      }
    }
    /**
     * Runs one compaction pass. Returns true when the context was rewritten;
     * the caller re-enters the loop so the next request uses the summary.
     */
    const compactContext = async (
      reason: 'threshold' | 'overflow',
      force: boolean,
    ): Promise<boolean> => {
      if (compactions >= compactionPolicy.maxCompactionsPerTurn) return false
      const outcome = await compactor.compact({
        sessionId: options.sessionId,
        cwd: options.cwd,
        permissionMode: options.permissionMode,
        events: history,
        ledger,
        ...(options.signal === undefined ? {} : { signal: cancellation.signal }),
        ...(force ? { force } : {}),
      })
      if ('skipped' in outcome) {
        this.env.telemetry.counter('context.compaction.skipped', { reason })
        return false
      }
      compactions += 1
      try {
        await options.onEvent?.(outcome.event)
      } catch {
        this.env.telemetry.counter('observer.event.failed', { type: outcome.event.type })
      }
      await pullEvents()
      budgetWarning = undefined
      return true
    }

    try {
      await append({
        type: 'turn.started',
        schemaVersion: 1,
        turnId: options.turnId,
        input: {
          kind: 'text',
          text: options.input,
          ...(options.images === undefined || options.images.length === 0
            ? {}
            : { images: options.images.map((image) => structuredClone(image)) }),
        },
        ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
      })
      if (options.images !== undefined && options.images.length > 0) {
        this.env.telemetry.counter('image.attached', { count: options.images.length })
      }

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

      let lastInputTokens = 0
      while (true) {
        throwIfAborted(cancellation.signal)
        await pullEvents()
        const stepId = this.env.ids.next('step')
        const projected = this.env.projector.project(history, {
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
        })

        // Microcompact: sink stale tool bodies into artifacts before paying
        // for the request. Pure token hygiene — may avoid a full compaction.
        if (
          compactionPolicy.microcompactEnabled &&
          slimmedToolResults < compactionPolicy.microcompactMaxPerTurn
        ) {
          const slimOutcome = await slimToolResults(this.env, {
            events: history,
            messages: projected.messages,
            ledger,
            policy: compactionPolicy,
          })
          if ('event' in slimOutcome) {
            slimmedToolResults += slimOutcome.slimmedCount
            try {
              await options.onEvent?.(slimOutcome.event)
            } catch {
              this.env.telemetry.counter('observer.event.failed', {
                type: slimOutcome.event.type,
              })
            }
            await pullEvents()
            continue
          }
        }

        const messages = await resolveImageParts(this.env, projected.messages, imageCache)
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

        // Auto-compact: before paying for a request that the window already
        // outgrew, summarize the oldest turns and continue with the summary.
        const modelBudget = this.env.llm.getModelBudget?.()
        const compactThreshold = contextWindowTokens() * compactionPolicy.thresholdRatio
        const estimatedTokens = estimateRequestTokens({
          system,
          messages,
          tools: this.env.tools.registry.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        })
        if (
          compactionPolicy.autoCompact &&
          compactions < compactionPolicy.maxCompactionsPerTurn &&
          (lastInputTokens >= compactThreshold || estimatedTokens >= compactThreshold)
        ) {
          this.env.telemetry.hist('context.compaction.trigger', estimatedTokens, {
            reason: 'threshold',
          })
          if (await compactContext('threshold', false)) continue
        }

        await append({
          type: 'step.started',
          schemaVersion: 1,
          stepId,
          turnId: options.turnId,
        })

        const tools = this.env.tools.registry.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }))
        const request: LlmRequest = {
          system,
          messages,
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
            messages,
            tools,
          }).maxTokens,
          metadata: {
            sessionId: options.sessionId,
            turnId: options.turnId,
            stepId,
          },
        }
        let response
        try {
          response = await consumeLlmStream(
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
        } catch (error) {
          // A provider rejection for context length is recoverable: compact
          // hard and retry the same step once before giving up.
          if (isContextOverflowError(error) && !cancellation.signal.aborted) {
            this.env.telemetry.hist('context.compaction.trigger', estimatedTokens, {
              reason: 'overflow',
            })
            if (await compactContext('overflow', true)) continue
          }
          throw error
        }
        lastInputTokens = response.usage.inputTokens
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

/**
 * Resolves ledger image references into base64 payloads for the wire format.
 *
 * Resolution happens here, not in the projector, so the projection stays a
 * pure function of the event log. Payloads are cached per turn: a multi-step
 * turn reads and encodes each image once.
 */
async function resolveImageParts(
  env: AgentEnv,
  messages: readonly IrMessage[],
  cache: Map<string, IrImagePart>,
): Promise<readonly IrMessage[]> {
  const needsResolution = messages.some(
    (message) => message.role === 'user' && (message.imageRefs?.length ?? 0) > 0,
  )
  if (!needsResolution) return messages

  const resolved: IrMessage[] = []
  for (const message of messages) {
    if (
      message.role !== 'user' ||
      message.imageRefs === undefined ||
      message.imageRefs.length === 0
    ) {
      resolved.push(message)
      continue
    }
    const imageParts: IrImagePart[] = []
    for (const ref of message.imageRefs) {
      const cached = cache.get(ref.sha256)
      if (cached !== undefined) {
        imageParts.push(cached)
        continue
      }
      const part = await readImagePart(env, ref)
      cache.set(ref.sha256, part)
      imageParts.push(part)
    }
    resolved.push({ ...message, imageParts })
  }
  return resolved
}

async function readImagePart(env: AgentEnv, ref: IrImageRef): Promise<IrImagePart> {
  const label = ref.name ?? `sha256:${ref.sha256.slice(0, 12)}`
  let content: string | Uint8Array
  try {
    content = await env.artifacts.get({
      sha256: ref.sha256,
      bytes: ref.bytes,
      mediaType: ref.mediaType,
      summary: ref.summary,
      readHint: ref.readHint,
    })
  } catch (error) {
    env.telemetry.counter('image.resolve_failed', { mediaType: ref.mediaType, reason: 'missing' })
    throw new KernelError(
      'image.artifact_missing',
      `图片附件 ${label} 的产物已不可读取，无法发送给模型。`,
      {
        cause: error,
        retryable: false,
        detail: { sha256: ref.sha256, mediaType: ref.mediaType },
      },
    )
  }
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  if (bytes.byteLength !== ref.bytes) {
    env.telemetry.counter('image.resolve_failed', { mediaType: ref.mediaType, reason: 'corrupt' })
    throw new KernelError(
      'image.artifact_corrupt',
      `图片附件 ${label} 的产物长度为 ${bytes.byteLength} 字节，与记录的 ${ref.bytes} 字节不一致。`,
      {
        retryable: false,
        detail: { sha256: ref.sha256, mediaType: ref.mediaType, actualBytes: bytes.byteLength },
      },
    )
  }
  return { mediaType: ref.mediaType, base64: Buffer.from(bytes).toString('base64') }
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
