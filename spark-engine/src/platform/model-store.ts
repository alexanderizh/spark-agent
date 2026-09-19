import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import { z } from 'zod'

import { errorMessage } from '../config/config-file.js'
import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'

/**
 * Local platform-model binding (`~/.spark/platform-model.json`).
 *
 * Holds the new-api gateway coordinates the bootstrap flow produced: which
 * gateway to call, which dashboard session it belongs to, and the API key the
 * model requests use. Kept out of `config.toml` for the same reason as the
 * account session — per-machine secrets do not belong in shared config.
 */
const STORE_FILENAME = 'platform-model.json'
const STORE_VERSION = 1
const MAX_TOKEN_CHARS = 8_192

const StoredPlatformModelSchema = z
  .object({
    version: z.literal(STORE_VERSION),
    baseUrl: z.url().max(2_000),
    newApiUserId: z.number().int().positive(),
    accessToken: z.string().min(1).max(MAX_TOKEN_CHARS).optional(),
    apiKey: z.string().min(1).max(MAX_TOKEN_CHARS).optional(),
    models: z.array(z.string().min(1).max(500)).default([]),
    updatedAt: z.string().min(1).max(64),
  })
  .strict()

export type StoredPlatformModel = z.output<typeof StoredPlatformModelSchema>

export class PlatformModelError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PlatformModelError'
  }
}

export interface PlatformModelStoreOptions {
  readonly sparkHome: string
  readonly logger?: RuntimeLogger
}

export class PlatformModelStore {
  readonly #path: string
  readonly #logger: RuntimeLogger

  constructor(options: PlatformModelStoreOptions) {
    this.#path = resolve(options.sparkHome, STORE_FILENAME)
    this.#logger = options.logger ?? NULL_RUNTIME_LOGGER
  }

  get path(): string {
    return this.#path
  }

  /**
   * Reads the stored binding. Returns null when nothing was saved yet; a
   * corrupt file degrades to null with a warning instead of failing every
   * command — the next bootstrap simply rebuilds it.
   */
  async load(): Promise<StoredPlatformModel | null> {
    let raw: string
    try {
      raw = await readFile(this.#path, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw new PlatformModelError(
        `Cannot read platform model binding at ${this.#path}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.#logger.warn(`platform model binding at ${this.#path} is not valid JSON; ignoring it`)
      return null
    }
    const result = StoredPlatformModelSchema.safeParse(parsed)
    if (!result.success) {
      this.#logger.warn(`platform model binding at ${this.#path} is unreadable; ignoring it`)
      return null
    }
    await this.#hardenPermissions()
    return result.data
  }

  async #hardenPermissions(): Promise<void> {
    const stats = await stat(this.#path).catch(() => null)
    if (stats === null || (stats.mode & 0o077) === 0) return
    this.#logger.warn(
      `platform model binding at ${this.#path} was group/world readable; tightening to 0600`,
    )
    await chmod(this.#path, 0o600).catch((error: unknown) => {
      this.#logger.warn(`cannot tighten permissions on ${this.#path}: ${errorMessage(error)}`)
    })
  }

  async save(input: {
    readonly baseUrl: string
    readonly newApiUserId: number
    readonly accessToken?: string
    readonly apiKey?: string
    readonly models?: readonly string[]
  }): Promise<StoredPlatformModel> {
    const previous = await this.load()
    const stored: StoredPlatformModel = {
      version: STORE_VERSION,
      baseUrl: input.baseUrl,
      newApiUserId: input.newApiUserId,
      accessToken: input.accessToken ?? previous?.accessToken,
      apiKey: input.apiKey ?? previous?.apiKey,
      models: [...(input.models ?? previous?.models ?? [])],
      updatedAt: new Date().toISOString(),
    }
    const directory = dirname(this.#path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = resolve(directory, `.${basename(this.#path)}.${process.pid}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporary, this.#path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw new PlatformModelError(
        `Cannot write platform model binding at ${this.#path}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    this.#logger.info(`platform model binding saved for user=${stored.newApiUserId}`)
    return stored
  }

  /** Removes the stored binding. Returns true when a file was actually deleted. */
  async clear(): Promise<boolean> {
    try {
      await rm(this.#path)
      this.#logger.info('platform model binding cleared')
      return true
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false
      throw new PlatformModelError(
        `Cannot remove platform model binding at ${this.#path}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined
}
