import { errorMessage } from '../config/config-file.js'
import { createRuntimeLogger } from '../observability/logger.js'
import type { AgentEnv } from '../seams.js'
import { runDueSchedules, type ScheduleRunOutcome } from './runner.js'
import type { ScheduleStore } from './store.js'

/**
 * `spark scheduler` host loop: every tick runs due schedules sequentially and
 * sleeps until the next minute boundary. Schedules carry their own working
 * directory, so one host process serves every project on the machine.
 */
export interface ScheduleHostOptions {
  readonly store: ScheduleStore
  readonly envFor: (cwd: string) => Promise<AgentEnv>
  readonly tickMs?: number
  readonly log?: (line: string) => void
}

export interface ScheduleHostHandle {
  stop(): Promise<void>
}

export async function startScheduleHost(options: ScheduleHostOptions): Promise<ScheduleHostHandle> {
  const logger = createRuntimeLogger('scheduler')
  const log =
    options.log ??
    ((line: string) => {
      logger.info(line)
    })
  const tickMs = options.tickMs ?? 60_000
  let stopped = false
  let wake: (() => void) | undefined
  const wakePromise = new Promise<void>((resolveWake) => {
    wake = resolveWake
  })

  log(`scheduler host started (tick=${tickMs}ms)`)
  const loop = (async () => {
    while (!stopped) {
      try {
        const outcomes = await runDueSchedules({
          store: options.store,
          envFor: options.envFor,
          logger,
        })
        for (const outcome of outcomes) reportOutcome(outcome, log)
      } catch (error) {
        log(`scheduler tick failed: ${errorMessage(error)}`)
      }
      if (stopped) break
      await Promise.race([
        new Promise<void>((resolveSleep) => setTimeout(resolveSleep, tickMs)),
        wakePromise,
      ])
    }
  })()

  return {
    stop: async () => {
      stopped = true
      wake?.()
      await loop.catch(() => undefined)
      log('scheduler host stopped')
    },
  }
}

function reportOutcome(outcome: ScheduleRunOutcome, log: (line: string) => void): void {
  const head = outcome.summary.split('\n')[0] ?? ''
  log(`schedule ${outcome.schedule.id} ${outcome.ok ? 'ok' : 'FAILED'}: ${head.slice(0, 200)}`)
}
