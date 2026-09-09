import type { SessionLedger } from '../events/ledger.js'
import type { AgentEvent, AssistantMessage, BoundEventDraft } from '../events/schema.js'
import { stableStringify } from './stable-json.js'
import { isAbortError, throwIfAborted, timeoutSignal } from './cancellation.js'
import type { AgentEnv, SubagentRunner, SubagentRunResult } from '../seams.js'
import type { ReasoningEffort } from '../llm/types.js'
import type {
  PermissionCheckContext,
  PermissionDecision,
  PermissionMode,
  PolicyDecision,
} from '../permission/types.js'
import type { HookRunContext } from '../hooks/types.js'
import type { ResolvedToolCall } from '../tools/contract.js'
import { taskArgs } from '../tools/task/definition.js'
import { processToolOutput, type ProcessedToolOutput } from '../tools/output.js'
import { ToolArgumentValidator } from '../tools/validation.js'

interface PreparedCall {
  readonly call: ResolvedToolCall
}

interface ExecutionRecord {
  readonly call: ResolvedToolCall
  readonly durationMs: number
  readonly ok: boolean
  readonly output: ProcessedToolOutput
  readonly aborted: boolean
  readonly childSessionId?: string
}

export interface ToolRunSummary {
  readonly attempted: number
  readonly executed: number
}

export interface ToolRunnerOptions {
  readonly env: AgentEnv
  readonly ledger: SessionLedger
  readonly stepId: string
  readonly sessionId: string
  /** Owning turn id; only consumed by hook payloads. */
  readonly turnId?: string
  readonly cwd: string
  readonly permissionMode: PermissionMode
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningBudgetTokens?: number
  readonly signal: AbortSignal
  readonly subagent?: SubagentRunner
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void
  readonly maxOutputCharacters?: number
}

export class ToolRunner {
  readonly #validator = new ToolArgumentValidator()

  constructor(private readonly options: ToolRunnerOptions) {}

  async run(calls: AssistantMessage['toolCalls']): Promise<ToolRunSummary> {
    const prepared: PreparedCall[] = []
    for (const call of calls) {
      if (this.options.signal.aborted) {
        if (prepared.length === 0) throwIfAborted(this.options.signal)
        break
      }
      const candidate = await this.#prepare(call)
      if (candidate) prepared.push(candidate)
      if (this.options.signal.aborted) break
    }

    let executed = 0
    for (const group of groupCalls(prepared, this.options.env)) {
      const started: PreparedCall[] = []
      for (const item of group) {
        if (this.options.signal.aborted) break
        await this.#append({
          type: 'tool.intent',
          schemaVersion: 1,
          callId: item.call.callId,
        })
        started.push(item)
      }
      if (started.length === 0) throwIfAborted(this.options.signal)
      const records = await Promise.all(started.map(async ({ call }) => this.#execute(call)))
      for (const record of records) {
        await this.#append({
          type: 'tool.result',
          schemaVersion: 1,
          callId: record.call.callId,
          durationMs: record.durationMs,
          ok: record.ok,
          content: record.output.content,
          ...(record.childSessionId === undefined ? {} : { childSessionId: record.childSessionId }),
          ...(record.output.artifact === undefined ? {} : { artifact: record.output.artifact }),
        })
        executed += 1
      }
      await this.#postToolUse(records)
      if (records.some((record) => record.aborted)) throwIfAborted(this.options.signal)
    }
    return { attempted: calls.length, executed }
  }

  async #prepare(
    modelCall: AssistantMessage['toolCalls'][number],
  ): Promise<PreparedCall | undefined> {
    await this.#append({
      type: 'tool.call',
      schemaVersion: 1,
      callId: modelCall.callId,
      stepId: this.options.stepId,
      tool: modelCall.name,
      args: modelCall.args,
    })

    const definition = this.options.env.tools.registry.get(modelCall.name)
    if (!definition) {
      await this.#deny(modelCall.callId, `Unknown tool: ${modelCall.name}`)
      return undefined
    }
    let validation
    try {
      validation = this.#validator.validate(definition, modelCall.args)
    } catch (error) {
      await this.#deny(
        modelCall.callId,
        `Tool schema could not be evaluated: ${errorMessage(error)}`,
      )
      return undefined
    }
    if (!validation.valid) {
      await this.#deny(
        modelCall.callId,
        `Invalid tool arguments: ${validation.message ?? 'unknown error'}`,
      )
      return undefined
    }

    const call: ResolvedToolCall = {
      callId: modelCall.callId,
      name: modelCall.name,
      args: modelCall.args,
      definition,
    }

    // PreToolUse hooks run before the permission policy: a `block` decision
    // denies the call outright, an `approve` decision short-circuits the ask.
    const hooks = this.options.env.hooks
    if (hooks) {
      const outcome = await hooks.run(
        'PreToolUse',
        {
          ...(this.options.turnId === undefined ? {} : { turnId: this.options.turnId }),
          toolName: call.name,
          toolInput: call.args,
        },
        this.#hookContext(),
        this.options.signal,
      )
      if (outcome.blocked) {
        await this.#deny(
          call.callId,
          `Blocked by PreToolUse hook: ${outcome.reason ?? 'no reason provided'}`,
        )
        return undefined
      }
      if (outcome.approved) {
        await this.#appendPermissionEvaluation(call.callId, {
          decision: 'allow',
          reason: 'PreToolUse hook approved',
        })
        return { call }
      }
    }

    let policyDecision
    try {
      policyDecision = await this.options.env.permission.policy.check(
        call,
        this.#permissionContext(),
      )
    } catch (error) {
      const reason = `Permission policy failed closed: ${errorMessage(error)}`
      await this.#appendPermissionEvaluation(call.callId, {
        decision: 'deny',
        reason,
      })
      await this.#deny(modelCall.callId, reason)
      return undefined
    }
    await this.#appendPermissionEvaluation(call.callId, policyDecision)
    if (policyDecision.decision === 'deny') {
      await this.#deny(modelCall.callId, `Permission denied: ${policyDecision.reason ?? 'policy'}`)
      return undefined
    }
    if (policyDecision.decision === 'ask') {
      const decision = await this.#ask(call, policyDecision)
      if (decision.decision === 'deny') {
        await this.#deny(modelCall.callId, `Permission denied: ${decision.reason ?? 'user'}`)
        return undefined
      }
    }

    return { call }
  }

  async #ask(
    call: ResolvedToolCall,
    policyDecision: Extract<PolicyDecision, { decision: 'ask' }>,
  ): Promise<PermissionDecision> {
    const requestId = this.options.env.ids.next('p')
    const argsPreview = previewArgs(call.args)
    await this.#append({
      type: 'permission.requested',
      schemaVersion: 1,
      requestId,
      callId: call.callId,
      risk: { tool: call.name, argsPreview },
    })
    let decision: PermissionDecision
    try {
      decision = await this.options.env.permission.approver.ask(
        {
          requestId,
          call,
          argsPreview,
          ...(policyDecision.reason ? { reason: policyDecision.reason } : {}),
          allowedGrantScopes: policyDecision.allowedGrantScopes,
          ...(policyDecision.sessionScopeLabel
            ? { sessionScopeLabel: policyDecision.sessionScopeLabel }
            : {}),
        },
        this.options.signal,
      )
    } catch (error) {
      decision = {
        decision: 'deny',
        reason: isAbortError(error)
          ? 'Approval cancelled'
          : `Approver failed closed: ${errorMessage(error)}`,
      }
    }
    if (decision.decision === 'allow') {
      const scope = decision.grantScope ?? 'once'
      if (!policyDecision.allowedGrantScopes.includes(scope)) {
        decision = {
          decision: 'deny',
          reason: `Approver returned disallowed grant scope: ${scope}`,
        }
      } else {
        try {
          await this.options.env.permission.policy.recordDecision?.(
            call,
            { ...decision, grantScope: scope },
            this.#permissionContext(),
          )
          decision = { ...decision, grantScope: scope }
        } catch (error) {
          decision = {
            decision: 'deny',
            reason: `Permission grant failed closed: ${errorMessage(error)}`,
          }
        }
      }
    }
    await this.#append({
      type: 'permission.decided',
      schemaVersion: 1,
      requestId,
      decision: decision.decision,
      ...(decision.decision === 'allow' && decision.grantScope !== undefined
        ? { grantScope: decision.grantScope }
        : {}),
      ...(decision.decision === 'deny' && decision.reason !== undefined
        ? { reason: decision.reason }
        : {}),
    })
    return decision
  }

  #permissionContext(): PermissionCheckContext {
    return {
      sessionId: this.options.sessionId,
      cwd: this.options.cwd,
      mode: this.options.permissionMode,
    }
  }

  #hookContext(): HookRunContext {
    return {
      sessionId: this.options.sessionId,
      cwd: this.options.cwd,
      permissionMode: this.options.permissionMode,
    }
  }

  /**
   * PostToolUse hooks observe the settled result of every executed call.
   * They are notifications only: outcomes never rewrite the recorded
   * tool.result, and failures surface through telemetry.
   */
  async #postToolUse(records: readonly ExecutionRecord[]): Promise<void> {
    const hooks = this.options.env.hooks
    if (!hooks) return
    for (const record of records) {
      if (this.options.signal.aborted) return
      try {
        await hooks.run(
          'PostToolUse',
          {
            ...(this.options.turnId === undefined ? {} : { turnId: this.options.turnId }),
            toolName: record.call.name,
            toolInput: record.call.args,
            toolOk: record.ok,
            toolOutputPreview: previewArgs(record.output.content),
          },
          this.#hookContext(),
          this.options.signal,
        )
      } catch {
        this.options.env.telemetry.counter('hook.run.failed', { event: 'PostToolUse' })
      }
    }
  }

  async #appendPermissionEvaluation(callId: string, decision: PolicyDecision): Promise<void> {
    await this.#append({
      type: 'permission.evaluated',
      schemaVersion: 1,
      callId,
      mode: this.options.permissionMode,
      decision: decision.decision,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.rule ? { rule: decision.rule } : {}),
      ...(decision.decision === 'ask'
        ? { allowedGrantScopes: [...decision.allowedGrantScopes] }
        : {}),
    })
  }

  async #execute(call: ResolvedToolCall): Promise<ExecutionRecord> {
    const startedAt = this.options.env.clock.monotonicMs()
    const timeout = timeoutSignal(this.options.signal, call.definition.timeoutMs)
    let ok = false
    let content: string
    let aborted = false
    let childSessionId: string | undefined
    try {
      const outcome =
        call.name === 'task'
          ? await this.#runTask(call, timeout.signal)
          : await this.options.env.tools.executor.execute(call, {
              signal: timeout.signal,
              timeoutMs: call.definition.timeoutMs,
            })
      ok = outcome.ok
      content = outcome.content
      if ('sessionId' in outcome && typeof outcome.sessionId === 'string') {
        childSessionId = outcome.sessionId
      }
    } catch (error) {
      if (this.options.signal.aborted) {
        content = 'aborted'
        aborted = true
      } else if (timeout.timedOut()) {
        content = `timeout after ${call.definition.timeoutMs}ms`
      } else {
        content = `tool execution failed: ${errorMessage(error)}`
      }
    } finally {
      timeout.dispose()
    }
    let output: ProcessedToolOutput
    try {
      output = await processToolOutput(
        content,
        this.options.env.artifacts,
        this.options.maxOutputCharacters,
      )
    } catch (error) {
      ok = false
      output = { content: `artifact pipeline failed: ${errorMessage(error)}` }
    }
    return {
      call,
      durationMs: Math.max(0, this.options.env.clock.monotonicMs() - startedAt),
      ok,
      output,
      aborted,
      ...(childSessionId === undefined ? {} : { childSessionId }),
    }
  }

  async #runTask(call: ResolvedToolCall, signal: AbortSignal): Promise<SubagentRunResult> {
    if (!this.options.subagent) {
      return { ok: false, content: 'Task tool is unavailable in this runtime.' }
    }
    if (this.options.turnId === undefined) {
      return { ok: false, content: 'Task tool requires an owning turn.' }
    }
    let args
    try {
      args = taskArgs(call.args)
    } catch (error) {
      return { ok: false, content: `Invalid task arguments: ${errorMessage(error)}` }
    }
    return this.options.subagent.run({
      parentSessionId: this.options.sessionId,
      parentTurnId: this.options.turnId,
      cwd: this.options.cwd,
      permissionMode: this.options.permissionMode,
      prompt: args.prompt,
      description: args.description,
      ...(args.allowed_tools === undefined ? {} : { allowedTools: args.allowed_tools }),
      ...(args.max_steps === undefined ? {} : { maxSteps: args.max_steps }),
      ...(args.max_tool_calls === undefined ? {} : { maxToolCalls: args.max_tool_calls }),
      ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
      ...(this.options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: this.options.reasoningEffort }),
      ...(this.options.reasoningBudgetTokens === undefined
        ? {}
        : { reasoningBudgetTokens: this.options.reasoningBudgetTokens }),
      signal,
    })
  }

  async #deny(callId: string, content: string): Promise<void> {
    await this.#append({
      type: 'tool.result',
      schemaVersion: 1,
      callId,
      durationMs: 0,
      ok: false,
      content,
    })
  }

  async #append(draft: BoundEventDraft): Promise<AgentEvent> {
    const event = await this.options.ledger.append(draft)
    try {
      await this.options.onEvent?.(event)
    } catch {
      this.options.env.telemetry.counter('observer.event.failed', { type: event.type })
    }
    return event
  }
}

function groupCalls(calls: readonly PreparedCall[], env: AgentEnv): PreparedCall[][] {
  const groups: PreparedCall[][] = []
  let parallel: PreparedCall[] = []
  const flush = () => {
    if (parallel.length > 0) groups.push(parallel)
    parallel = []
  }
  for (const call of calls) {
    if (canRunInParallel(call.call, env)) parallel.push(call)
    else {
      flush()
      groups.push([call])
    }
  }
  flush()
  return groups
}

function canRunInParallel(call: ResolvedToolCall, env: AgentEnv): boolean {
  if (call.definition.concurrency !== 'parallel') return false
  if (call.name !== 'task') return true
  const requested = taskArgs(call.args).allowed_tools
  // Default task capabilities are read-only. Explicit mutation-capable task
  // calls share the current workspace and must remain serial until worktree
  // isolation is implemented.
  return (
    requested === undefined ||
    requested.every((name) => env.tools.registry.get(name)?.readonly === true)
  )
}

function previewArgs(args: unknown): string {
  try {
    return stableStringify(args).slice(0, 2_000)
  } catch {
    return '[unserializable arguments]'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
