import { execFile } from 'node:child_process'
import {
  VIDEO_WORKBENCH_FFMPEG_ENCODERS,
  VIDEO_WORKBENCH_FFMPEG_FILTERS,
  type VideoWorkbenchFfmpegCapabilities,
  type VideoWorkbenchFfmpegEncoder,
  type VideoWorkbenchFfmpegFilter,
} from '@spark/protocol'
import { detectFfmpegIntegrity, type FfmpegIntegrityState } from './FfmpegIntegrityService.js'

interface CapabilityCommandResult {
  stdout: string
  stderr: string
}

export type FfmpegCapabilityCommandRunner = (
  binaryPath: string,
  args: string[],
) => Promise<CapabilityCommandResult>

export interface FfmpegCapabilityServiceOptions {
  detectIntegrity?: () => Promise<FfmpegIntegrityState>
  runCommand?: FfmpegCapabilityCommandRunner
  now?: () => Date
}

interface CapabilityCacheEntry {
  key: string
  result: Promise<VideoWorkbenchFfmpegCapabilities>
}

export class FfmpegCapabilityService {
  private readonly detectIntegrity: () => Promise<FfmpegIntegrityState>
  private readonly runCommand: FfmpegCapabilityCommandRunner
  private readonly now: () => Date
  private cache: CapabilityCacheEntry | null = null

  constructor(options: FfmpegCapabilityServiceOptions = {}) {
    this.detectIntegrity = options.detectIntegrity ?? detectFfmpegIntegrity
    this.runCommand = options.runCommand ?? runCapabilityCommand
    this.now = options.now ?? (() => new Date())
  }

  async getCapabilities(
    options: { refresh?: boolean } = {},
  ): Promise<VideoWorkbenchFfmpegCapabilities> {
    const integrity = await this.detectIntegrity()
    const key = `${integrity.binaryPath ?? 'none'}:${integrity.ffmpegVersion ?? 'unknown'}`
    if (!options.refresh && this.cache?.key === key) return this.cache.result

    const result = this.detectCapabilities(integrity).catch((error) =>
      unavailableCapabilities(integrity, this.now(), readableError(error)),
    )
    this.cache = { key, result }
    return result
  }

  clearCache(): void {
    this.cache = null
  }

  private async detectCapabilities(
    integrity: FfmpegIntegrityState,
  ): Promise<VideoWorkbenchFfmpegCapabilities> {
    if (!integrity.ffmpegReady || !integrity.binaryPath) {
      return unavailableCapabilities(
        integrity,
        this.now(),
        integrity.lastError ?? 'FFmpeg is not available',
      )
    }

    const [filtersResult, encodersResult] = await Promise.allSettled([
      this.runCommand(integrity.binaryPath, ['-hide_banner', '-filters']),
      this.runCommand(integrity.binaryPath, ['-hide_banner', '-encoders']),
    ])
    const filters =
      filtersResult.status === 'fulfilled'
        ? parseFfmpegList(`${filtersResult.value.stdout}\n${filtersResult.value.stderr}`, 3)
        : new Set<string>()
    const encoders =
      encodersResult.status === 'fulfilled'
        ? parseFfmpegList(`${encodersResult.value.stdout}\n${encodersResult.value.stderr}`, 6)
        : new Set<string>()
    const errors = [filtersResult, encodersResult].flatMap((result) =>
      result.status === 'rejected' ? [readableError(result.reason)] : [],
    )
    return {
      available: true,
      source: integrity.ffmpegSource,
      version: integrity.ffmpegVersion,
      filters: createCapabilityRecord(VIDEO_WORKBENCH_FFMPEG_FILTERS, filters),
      encoders: createCapabilityRecord(VIDEO_WORKBENCH_FFMPEG_ENCODERS, encoders),
      checkedAt: this.now().toISOString(),
      ...(errors.length > 0 ? { error: errors.join('; ').slice(0, 1000) } : {}),
    }
  }
}

export function parseFfmpegList(output: string, flagWidth: 3 | 6): Set<string> {
  const flagPattern = new RegExp(`^[A-Za-z.]{${flagWidth}}$`)
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 2 || !flagPattern.test(fields[0] ?? '')) continue
    const name = fields[1]
    if (name && /^[A-Za-z0-9_-]+$/.test(name)) names.add(name)
  }
  return names
}

function createCapabilityRecord<T extends readonly string[]>(
  knownCapabilities: T,
  detectedCapabilities: ReadonlySet<string>,
): Record<T[number], boolean> {
  return Object.fromEntries(
    knownCapabilities.map((capability) => [capability, detectedCapabilities.has(capability)]),
  ) as Record<T[number], boolean>
}

function unavailableCapabilities(
  integrity: FfmpegIntegrityState,
  checkedAt: Date,
  error: string,
): VideoWorkbenchFfmpegCapabilities {
  return {
    available: false,
    source: integrity.ffmpegSource,
    version: integrity.ffmpegVersion,
    filters: createCapabilityRecord<readonly VideoWorkbenchFfmpegFilter[]>(
      VIDEO_WORKBENCH_FFMPEG_FILTERS,
      new Set(),
    ),
    encoders: createCapabilityRecord<readonly VideoWorkbenchFfmpegEncoder[]>(
      VIDEO_WORKBENCH_FFMPEG_ENCODERS,
      new Set(),
    ),
    checkedAt: checkedAt.toISOString(),
    error: error.slice(0, 1000),
  }
}

function runCapabilityCommand(
  binaryPath: string,
  args: string[],
): Promise<CapabilityCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown FFmpeg capability error')
}

export const ffmpegCapabilityService = new FfmpegCapabilityService()
