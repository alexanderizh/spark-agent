import { randomUUID } from 'node:crypto'
import { abortError, timeoutSignal } from '../../kernel/cancellation.js'
import { KernelError } from '../../kernel/errors.js'
import type { ToolCallContext, ToolOwner } from '../../seams.js'
import type { ToolOutcome } from '../contract.js'
import { runProcess } from './process.js'

type Status = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
interface Entry {
  readonly id: string
  readonly owner: ToolOwner
  readonly callId: string
  readonly commandKey: string
  readonly cancel: AbortController
  readonly listeners: Set<() => void>
  done: Promise<void>
  output: string
  status: Status
  exitCode?: number
  error?: string
  observed: boolean
}

/** In-memory commands owned by one turn. Never a cross-turn daemon registry. */
export class ManagedProcesses {
  readonly #entries = new Map<string, Entry>()

  async start(
    callId: string,
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; yieldMs: number },
    context: ToolCallContext,
  ): Promise<ToolOutcome> {
    if (!Number.isInteger(options.yieldMs) || options.yieldMs < 0 || options.yieldMs > 30_000)
      throw new KernelError('tool.invalid_wait', 'yield_ms must be between 0 and 30000')
    const { owner, signal: turnSignal } = requireOwner(context)
    context.signal.throwIfAborted()
    context.turnSignal?.throwIfAborted()
    if (process.platform === 'win32') {
      throw new KernelError(
        'tool.managed_process_unsupported',
        'Managed processes require POSIX process-group cleanup; use foreground bash on Windows.',
      )
    }
    const commandKey = JSON.stringify([command, args])
    const existing = [...this.#entries.values()].find(
      (entry) => owns(entry, owner) && entry.callId === callId,
    )
    if (existing) {
      if (existing.commandKey !== commandKey)
        throw new KernelError(
          'tool.process_call_conflict',
          'Call ID already belongs to a different command',
        )
      return this.wait(existing.id, 0, options.yieldMs, context)
    }
    if (
      this.#entries.size >= 64 ||
      [...this.#entries.values()].filter((entry) => owns(entry, owner)).length >= 8
    ) {
      throw new KernelError(
        'tool.process_limit',
        'Managed command limit reached (8 per turn, 64 per executor)',
      )
    }
    const cancel = new AbortController()
    const lifetime = timeoutSignal(AbortSignal.any([turnSignal, cancel.signal]), 120_000)
    const entry: Entry = {
      id: randomUUID(),
      owner: { ...owner },
      callId,
      commandKey,
      cancel,
      listeners: new Set(),
      done: Promise.resolve(),
      output: '',
      status: 'running',
      observed: false,
    }
    this.#entries.set(entry.id, entry)
    const notify = () => {
      for (const listener of [...entry.listeners]) listener()
    }
    entry.done = runProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: lifetime.signal,
      maxOutputBytes: 262_144,
      onOutput: (value) => {
        entry.output += value
        notify()
      },
    })
      .then(
        (result) => {
          entry.exitCode = result.exitCode
          entry.status = result.exitCode === 0 ? 'completed' : 'failed'
        },
        (error: unknown) => {
          entry.status = lifetime.timedOut()
            ? 'timed_out'
            : lifetime.signal.aborted
              ? 'cancelled'
              : 'failed'
          entry.error = error instanceof Error ? error.message : String(error)
        },
      )
      .finally(() => {
        lifetime.dispose()
        notify()
      })
    return this.wait(entry.id, 0, options.yieldMs, context)
  }

  async wait(
    id: string,
    cursor: number,
    waitMs: number,
    context: ToolCallContext,
  ): Promise<ToolOutcome> {
    const entry = this.#get(id, requireOwner(context).owner)
    context.signal.throwIfAborted()
    validateCursor(entry, cursor)
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000)
      throw new KernelError('tool.invalid_wait', 'wait_ms must be between 0 and 30000')
    if (entry.status === 'running' && cursor === entry.output.length && waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          cleanup()
          resolve()
        }
        const abort = () => {
          cleanup()
          reject(abortError(context.signal.reason))
        }
        const timer = setTimeout(finish, waitMs)
        const cleanup = () => {
          clearTimeout(timer)
          entry.listeners.delete(finish)
          context.signal.removeEventListener('abort', abort)
        }
        entry.listeners.add(finish)
        context.signal.addEventListener('abort', abort, { once: true })
        if (context.signal.aborted) abort()
      })
    }
    context.signal.throwIfAborted()
    return snapshot(entry, cursor)
  }

  async cancel(id: string, cursor: number, context: ToolCallContext): Promise<ToolOutcome> {
    const entry = this.#get(id, requireOwner(context).owner)
    context.signal.throwIfAborted()
    validateCursor(entry, cursor)
    entry.cancel.abort('Command cancelled by owner')
    await entry.done
    return snapshot(entry, cursor)
  }

  assertTurnSettled(owner: ToolOwner): void {
    const pending = [...this.#entries.values()].filter(
      (entry) => owns(entry, owner) && (entry.status === 'running' || !entry.observed),
    )
    if (pending.length)
      throw new KernelError(
        'tool.process_unobserved',
        `Cannot finish with unobserved managed commands: ${pending.map((entry) => entry.id).join(', ')}. Wait for terminal results before answering; remaining processes will be cancelled.`,
      )
  }

  async closeTurn(owner: ToolOwner): Promise<void> {
    const entries = [...this.#entries.values()].filter((entry) => owns(entry, owner))
    for (const entry of entries) entry.cancel.abort('Owning turn ended')
    await Promise.all(entries.map((entry) => entry.done))
    for (const entry of entries) this.#entries.delete(entry.id)
  }

  #get(id: string, owner: ToolOwner): Entry {
    const entry = this.#entries.get(id)
    if (!entry || !owns(entry, owner))
      throw new KernelError(
        'tool.process_not_found',
        'No managed process with this ID belongs to the current turn',
      )
    return entry
  }
}

function requireOwner(context: ToolCallContext): { owner: ToolOwner; signal: AbortSignal } {
  if (!context.owner || !context.turnSignal)
    throw new KernelError(
      'tool.process_owner_required',
      'Managed commands require an owning turn and lifetime signal',
    )
  return { owner: context.owner, signal: context.turnSignal }
}
function owns(entry: Entry, owner: ToolOwner): boolean {
  return entry.owner.sessionId === owner.sessionId && entry.owner.turnId === owner.turnId
}
function validateCursor(entry: Entry, cursor: number): void {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > entry.output.length)
    throw new KernelError('tool.invalid_cursor', 'cursor must refer to captured output')
}
function snapshot(entry: Entry, cursor: number): ToolOutcome {
  // Character cursors address the combined, decoded stream. Bound each page so
  // even escaped JSON remains within ordinary tool output budgets.
  let next = Math.min(entry.output.length, cursor + 2000)
  if (next < entry.output.length) {
    const last = entry.output.charCodeAt(next - 1)
    if (last >= 0xd800 && last <= 0xdbff) next -= 1
  }
  if (entry.status !== 'running' && next === entry.output.length) entry.observed = true
  return {
    ok: entry.status === 'running' || entry.status === 'completed',
    content: JSON.stringify({
      process_id: entry.id,
      status: entry.status,
      output: entry.output.slice(cursor, next),
      next_cursor: next,
      has_more: next < entry.output.length,
      ...(entry.exitCode === undefined ? {} : { exit_code: entry.exitCode }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.status === 'running'
        ? {
            instruction:
              'Command is still running. Use process_wait with process_id and next_cursor; do not restart it.',
          }
        : {}),
    }),
  }
}
