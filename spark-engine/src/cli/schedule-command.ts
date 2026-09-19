import { resolve } from 'node:path'

import { errorMessage } from '../config/config-file.js'
import { loadConfiguredModel, type ConfiguredModelRuntime } from '../config/model-config.js'
import { loadSparkSettings, resolveEngineSettings } from '../config/settings.js'
import { createResilientEnv, defaultSparkHome } from '../env.js'
import { createRuntimeLogger } from '../observability/logger.js'
import { startScheduleHost } from '../schedule/host.js'
import { runSchedule } from '../schedule/runner.js'
import { isDue, ScheduleStore } from '../schedule/store.js'
import type { AgentEnv } from '../seams.js'

/**
 * `spark schedule` — durable local prompts on a wall-clock interval, plus
 * `spark scheduler` — the host loop that executes them. Runs always use the
 * configured model (local config, platform, or SparkWork bridge) and record
 * their outcome on the schedule entry.
 */

const USAGE =
  'Usage: spark schedule list [--json] | add "<prompt>" --every <minutes> [--cwd dir] | remove <id> | enable <id> | disable <id> | run <id> | due\n' +
  '       spark scheduler  Run the schedule host loop until interrupted\n'

export interface ScheduleCommandOptions {
  readonly args: readonly string[]
  readonly json: boolean
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

export async function executeScheduleCommand(options: ScheduleCommandOptions): Promise<number> {
  const [subcommand, ...rest] = options.args
  const logger = createRuntimeLogger('schedule')
  try {
    const store = new ScheduleStore({
      sparkHome: defaultSparkHome(),
      logger,
    })
    switch (subcommand) {
      case 'list':
        return await list(store, options)
      case 'add':
        return await add(store, rest, options)
      case 'remove':
        return await simpleMutation(store.remove(rest[0] ?? ''), options, {
          empty: 'Usage: spark schedule remove <id>\n',
          missing: `No schedule with that id.\n`,
          ok: (id) => `Removed schedule ${id}\n`,
          id: rest[0] ?? '',
        })
      case 'enable':
      case 'disable':
        return await toggle(store, subcommand, rest[0] ?? '', options)
      case 'run':
        return await runOnce(store, rest[0] ?? '', options)
      case 'due':
        return await due(store, options)
      default:
        options.stderr(`Unknown \`spark schedule ${subcommand ?? ''}\`.\n${USAGE}`)
        return 2
    }
  } catch (error) {
    options.stderr(`${errorMessage(error)}\n`)
    return 1
  }
}

async function list(store: ScheduleStore, options: ScheduleCommandOptions): Promise<number> {
  const { schedules } = await store.load()
  const now = Date.now()
  if (options.json) {
    options.stdout(
      `${JSON.stringify({ schedules, dueNow: schedules.filter((s) => isDue(s, now)).map((s) => s.id) }, null, 2)}\n`,
    )
    return 0
  }
  if (schedules.length === 0) {
    options.stdout('No schedules. Add one with: spark schedule add "check CI" --every 30\n')
    return 0
  }
  for (const schedule of schedules) {
    const state = schedule.enabled ? (isDue(schedule, now) ? 'DUE' : 'scheduled') : 'disabled'
    const last = schedule.lastRunAt
      ? `last=${schedule.lastStatus ?? '?'} ${schedule.lastRunAt}`
      : 'never run'
    options.stdout(
      `${schedule.id}  every ${schedule.intervalMinutes}m  ${state}  ${last}\n  ${schedule.prompt.replaceAll('\n', ' ').slice(0, 120)}\n`,
    )
  }
  return 0
}

async function add(
  store: ScheduleStore,
  args: readonly string[],
  options: ScheduleCommandOptions,
): Promise<number> {
  const everyIndex = args.indexOf('--every')
  const cwdIndex = args.indexOf('--cwd')
  const promptParts = args.filter(
    (_, index) =>
      index !== everyIndex &&
      index !== everyIndex + 1 &&
      index !== cwdIndex &&
      index !== cwdIndex + 1,
  )
  const prompt = promptParts.join(' ').trim()
  const everyRaw = everyIndex >= 0 ? args[everyIndex + 1] : undefined
  const minutes = Number(everyRaw)
  if (prompt === '' || !Number.isInteger(minutes) || minutes < 5) {
    options.stderr(
      'Usage: spark schedule add "<prompt>" --every <minutes> [--cwd dir]\n(minutes must be an integer ≥ 5)\n',
    )
    return 2
  }
  const cwd = cwdIndex >= 0 ? resolve(args[cwdIndex + 1] ?? '.') : options.cwd
  const schedule = await store.add({ prompt, intervalMinutes: minutes, cwd })
  if (options.json) {
    options.stdout(`${JSON.stringify(schedule, null, 2)}\n`)
    return 0
  }
  options.stdout(
    `Scheduled ${schedule.id}: every ${schedule.intervalMinutes}m in ${schedule.cwd}\n` +
      'Start the host with `spark scheduler`.\n',
  )
  return 0
}

async function toggle(
  store: ScheduleStore,
  action: 'enable' | 'disable',
  id: string,
  options: ScheduleCommandOptions,
): Promise<number> {
  if (id === '') {
    options.stderr(`Usage: spark schedule ${action} <id>\n`)
    return 2
  }
  const updated = await store.setEnabled(id, action === 'enable')
  if (updated === undefined) {
    options.stderr('No schedule with that id.\n')
    return 1
  }
  options.stdout(`${updated.id} ${action}d\n`)
  return 0
}

async function simpleMutation(
  mutation: Promise<boolean>,
  options: ScheduleCommandOptions,
  labels: {
    readonly empty: string
    readonly missing: string
    readonly ok: (id: string) => string
    readonly id: string
  },
): Promise<number> {
  if (labels.id === '') {
    options.stderr(labels.empty)
    return 2
  }
  const removed = await mutation
  options.stdout(removed ? labels.ok(labels.id) : labels.missing)
  return removed ? 0 : 1
}

async function due(store: ScheduleStore, options: ScheduleCommandOptions): Promise<number> {
  const now = Date.now()
  const due = (await store.load()).schedules.filter((schedule) => isDue(schedule, now))
  if (options.json) {
    options.stdout(`${JSON.stringify({ ids: due.map((schedule) => schedule.id) }, null, 2)}\n`)
  } else {
    options.stdout(
      due.length === 0 ? 'No schedules are due.\n' : `${due.map((s) => s.id).join(', ')}\n`,
    )
  }
  return 0
}

/** Runs one schedule immediately through the configured model. */
async function runOnce(
  store: ScheduleStore,
  id: string,
  options: ScheduleCommandOptions,
): Promise<number> {
  if (id === '') {
    options.stderr('Usage: spark schedule run <id>\n')
    return 2
  }
  const schedule = await store.get(id)
  if (schedule === undefined) {
    options.stderr('No schedule with that id.\n')
    return 1
  }
  const runtime = await buildRuntime(options)
  const outcome = await runSchedule(schedule, {
    store,
    envFor: async () => {
      const managed = await createResilientEnv({
        cwd: schedule.cwd,
        llm: runtime.service,
        skillsEnabled: true,
        ...resolveEngineSettings(await loadSparkSettings({ cwd: schedule.cwd })),
      })
      return managed.env
    },
    logger: createRuntimeLogger('schedule'),
  })
  if (options.json) {
    options.stdout(`${JSON.stringify({ id, ok: outcome.ok, summary: outcome.summary }, null, 2)}\n`)
  } else {
    options.stdout(`${outcome.ok ? 'OK' : 'FAILED'}: ${outcome.summary}\n`)
  }
  return outcome.ok ? 0 : 1
}

/** `spark scheduler` — host loop. Resolves never; the process exits by signal. */
export async function runSchedulerHost(options: {
  readonly model?: string
  readonly env?: NodeJS.ProcessEnv
}): Promise<number> {
  const cwd = process.cwd()
  const runtime = await buildRuntime({ ...options, cwd })
  const envCache = new Map<string, AgentEnv>()
  const settings = await loadSparkSettings({
    cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  const engineSettings = resolveEngineSettings(settings)
  const store = new ScheduleStore({
    sparkHome: defaultSparkHome(),
    logger: createRuntimeLogger('scheduler'),
  })
  const host = await startScheduleHost({
    store,
    envFor: async (scheduleCwd) => {
      const cached = envCache.get(scheduleCwd)
      if (cached !== undefined) return cached
      const managed = await createResilientEnv({
        cwd: scheduleCwd,
        llm: runtime.service,
        skillsEnabled: true,
        ...engineSettings,
      })
      envCache.set(scheduleCwd, managed.env)
      return managed.env
    },
  })
  const shutdown = async (): Promise<void> => {
    for (const env of envCache.values()) {
      // Envs carry MCP subprocesses; the host owns their lifetime.
      await env.tools.executor.closeTurn?.({ sessionId: 'scheduler', turnId: 'shutdown' })
    }
    await host.stop()
    process.exit(0)
  }
  const onSignal = (): void => {
    void shutdown()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  return new Promise<number>(() => {
    // Resolved only by shutdown() calling process.exit.
  })
}

async function buildRuntime(options: {
  readonly cwd: string
  readonly model?: string
  readonly env?: NodeJS.ProcessEnv
}): Promise<ConfiguredModelRuntime> {
  return loadConfiguredModel({
    cwd: options.cwd,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
}

export { resolveEngineSettings }
