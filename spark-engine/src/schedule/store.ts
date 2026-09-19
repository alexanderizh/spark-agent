import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'

import { z } from 'zod'

import { errorMessage } from '../config/config-file.js'
import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'

/**
 * Local scheduled tasks (`~/.spark/schedules.json`).
 *
 * A schedule re-runs a fixed prompt against the configured model on a wall
 * clock interval — the engine-side equivalent of pointing cron at
 * `spark -p`, but with durable run bookkeeping (last status/output) so a
 * missed or failed run is visible instead of silent.
 */
const STORE_FILENAME = 'schedules.json'
const STORE_VERSION = 1
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 60 * 24 * 30
const MAX_LAST_RESULT_CHARS = 2_000

export const ScheduleSchema = z
  .object({
    id: z.string().regex(/^sch_[A-Za-z0-9-]+$/u),
    /** Task prompt sent to the model on every due tick. */
    prompt: z.string().min(1).max(20_000),
    /** Wall clock interval between runs, in minutes. */
    intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES),
    enabled: z.boolean(),
    /** Working directory the task runs against. */
    cwd: z.string().min(1).max(4_096),
    createdAt: z.string().min(1).max(64),
    lastRunAt: z.string().nullable(),
    lastStatus: z.enum(['ok', 'failed']).nullable(),
    lastResult: z.string().max(MAX_LAST_RESULT_CHARS).nullable(),
  })
  .strict()

const StoreSchema = z
  .object({
    version: z.literal(STORE_VERSION),
    schedules: z.array(ScheduleSchema).default([]),
  })
  .strict()

export type StoredSchedule = z.output<typeof ScheduleSchema>
export type ScheduleStoreData = z.output<typeof StoreSchema>

export class ScheduleError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ScheduleError'
  }
}

export interface ScheduleStoreOptions {
  readonly sparkHome: string
  readonly logger?: RuntimeLogger
}

const EMPTY_STORE: ScheduleStoreData = { version: STORE_VERSION, schedules: [] }

export class ScheduleStore {
  readonly #path: string
  readonly #logger: RuntimeLogger

  constructor(options: ScheduleStoreOptions) {
    this.#path = resolve(options.sparkHome, STORE_FILENAME)
    this.#logger = options.logger ?? NULL_RUNTIME_LOGGER
  }

  get path(): string {
    return this.#path
  }

  /** Reads all schedules. A missing or corrupt file degrades to empty. */
  async load(): Promise<ScheduleStoreData> {
    let raw: string
    try {
      raw = await readFile(this.#path, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ...EMPTY_STORE, schedules: [] }
      throw new ScheduleError(`Cannot read schedules at ${this.#path}: ${errorMessage(error)}`, {
        cause: error,
      })
    }
    try {
      return StoreSchema.parse(JSON.parse(raw))
    } catch {
      this.#logger.warn(`schedules at ${this.#path} are unreadable; treating as empty`)
      return { ...EMPTY_STORE, schedules: [] }
    }
  }

  async #writeAll(data: ScheduleStoreData): Promise<void> {
    const directory = dirname(this.#path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = resolve(directory, `.${basename(this.#path)}.${process.pid}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporary, this.#path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw new ScheduleError(`Cannot write schedules at ${this.#path}: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  async add(input: {
    readonly prompt: string
    readonly intervalMinutes: number
    readonly cwd: string
  }): Promise<StoredSchedule> {
    const data = await this.load()
    const schedule: StoredSchedule = {
      id: `sch_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      prompt: input.prompt,
      intervalMinutes: input.intervalMinutes,
      enabled: true,
      cwd: resolve(input.cwd),
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      lastStatus: null,
      lastResult: null,
    }
    await this.#writeAll({ ...data, schedules: [...data.schedules, schedule] })
    return schedule
  }

  async remove(id: string): Promise<boolean> {
    const data = await this.load()
    const remaining = data.schedules.filter((schedule) => schedule.id !== id)
    if (remaining.length === data.schedules.length) return false
    await this.#writeAll({ ...data, schedules: remaining })
    return true
  }

  async setEnabled(id: string, enabled: boolean): Promise<StoredSchedule | undefined> {
    const data = await this.load()
    const schedule = data.schedules.find((entry) => entry.id === id)
    if (schedule === undefined) return undefined
    const updated: StoredSchedule = { ...schedule, enabled }
    await this.#writeAll({
      ...data,
      schedules: data.schedules.map((entry) => (entry.id === id ? updated : entry)),
    })
    return updated
  }

  async get(id: string): Promise<StoredSchedule | undefined> {
    return (await this.load()).schedules.find((schedule) => schedule.id === id)
  }

  /** Records one run outcome on the schedule entry. */
  async markRun(id: string, status: 'ok' | 'failed', result: string): Promise<void> {
    const data = await this.load()
    await this.#writeAll({
      ...data,
      schedules: data.schedules.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              lastRunAt: new Date().toISOString(),
              lastStatus: status,
              lastResult: result.slice(0, MAX_LAST_RESULT_CHARS),
            }
          : entry,
      ),
    })
  }
}

/** True when the schedule is due to run at `now` (epoch ms). */
export function isDue(schedule: StoredSchedule, now: number): boolean {
  if (!schedule.enabled) return false
  if (schedule.lastRunAt === null) return true
  const last = Date.parse(schedule.lastRunAt)
  if (!Number.isFinite(last)) return true
  return now - last >= schedule.intervalMinutes * 60_000
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined
}
