import { errorMessage } from '../config/config-file.js'
import type { AgentEvent } from '../events/schema.js'
import type { RuntimeLogger } from '../observability/logger.js'
import { Agent } from '../sdk/agent.js'
import type { AgentEnv } from '../seams.js'
import { isDue, type ScheduleStore, type StoredSchedule } from './store.js'

/**
 * Executes due schedules: every enabled schedule whose interval has elapsed
 * since its last run gets a fresh session in its recorded working directory,
 * the schedule prompt as a turn, and its outcome written back to the store.
 *
 * Runs are sequential by design — a periodic fleet of tasks hammering the
 * model concurrently would be a cost and rate-limit hazard, and the store is
 * a single JSON file that must not be written concurrently.
 */

export interface ScheduleRunnerOptions {
  readonly store: ScheduleStore
  /**
   * Builds a full environment for the schedule's working directory. Hosts
   * cache by cwd: the workspace guard and process manager are cwd-bound.
   */
  readonly envFor: (cwd: string) => Promise<AgentEnv>
  readonly logger?: RuntimeLogger
  /** Wall clock override for tests; defaults to Date.now. */
  readonly now?: () => number
  /** Global shutdown signal for in-flight turns. */
  readonly signal?: AbortSignal
  /** Per-run wall clock budget; defaults to 10 minutes. */
  readonly maxWallMs?: number
}

export interface ScheduleRunOutcome {
  readonly schedule: StoredSchedule
  readonly ok: boolean
  readonly summary: string
}

const DEFAULT_MAX_WALL_MS = 10 * 60_000

export async function runDueSchedules(
  options: ScheduleRunnerOptions,
): Promise<readonly ScheduleRunOutcome[]> {
  const now = options.now ?? Date.now
  const data = await options.store.load()
  const due = data.schedules.filter((schedule) => isDue(schedule, now()))
  const outcomes: ScheduleRunOutcome[] = []
  for (const schedule of due) {
    outcomes.push(await runSchedule(schedule, options))
  }
  return outcomes
}

export async function runSchedule(
  schedule: StoredSchedule,
  options: ScheduleRunnerOptions,
): Promise<ScheduleRunOutcome> {
  const logger = options.logger
  logger?.info(`schedule ${schedule.id} running (cwd=${schedule.cwd})`)
  let outcome: ScheduleRunOutcome
  try {
    outcome = await executeTurn(schedule, options)
  } catch (error) {
    outcome = { schedule, ok: false, summary: errorMessage(error) }
  }
  await options.store.markRun(schedule.id, outcome.ok ? 'ok' : 'failed', outcome.summary)
  logger?.info(
    `schedule ${schedule.id} ${outcome.ok ? 'finished' : 'failed'}: ${outcome.summary.slice(0, 120)}`,
  )
  return outcome
}

async function executeTurn(
  schedule: StoredSchedule,
  options: ScheduleRunnerOptions,
): Promise<ScheduleRunOutcome> {
  const env = await options.envFor(schedule.cwd)
  const agent = Agent.open({ cwd: schedule.cwd, env })
  const session = await agent.newSession({ permissionMode: 'auto' })
  let lastAssistant = ''
  const result = await session.turn(schedule.prompt, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    budget: { maxWallMs: options.maxWallMs ?? DEFAULT_MAX_WALL_MS },
    onEvent: (event: AgentEvent) => {
      if (event.type === 'assistant.completed' && event.message.text) {
        lastAssistant = event.message.text
      }
    },
  })
  const ok = result.terminal.type === 'turn.completed'
  const summary = ok
    ? lastAssistant.trim() || '(no text output)'
    : `turn ended: ${result.terminal.type}${
        result.terminal.type === 'turn.failed' && result.terminal.error.message
          ? ` — ${result.terminal.error.message}`
          : ''
      }`
  return { schedule, ok, summary }
}
