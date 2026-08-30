import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  SessionImageOptimizationReason,
  SessionImageOptimizationResult,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import sharp, { type Metadata, type Sharp, type SharpOptions } from 'sharp'

export const SESSION_IMAGE_THRESHOLD_BYTES = 4 * 1024 * 1024
export const SESSION_IMAGE_TARGET_BYTES = Math.floor(3.8 * 1024 * 1024)

const DEFAULT_PER_IMAGE_BUDGET_MS = 3_000
const DEFAULT_BATCH_BUDGET_MS = 8_000
const DEFAULT_MAX_CONCURRENT = 2
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const STRATEGY_VERSION = 'v1'
const MAX_INPUT_PIXELS = 100_000_000
const ATTEMPTS = [
  { maxEdge: 3072, quality: 85 },
  { maxEdge: 2560, quality: 80 },
  { maxEdge: 2048, quality: 75 },
] as const

const defaultLogger = createLogger('session-image-optimizer')

export interface SessionImageOptimizerLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export type SharpFactory = (input: string | Buffer, options?: SharpOptions) => Sharp

export interface SessionImageOptimizerOptions {
  outputRoot: string
  batchBudgetMs?: number
  logger?: SessionImageOptimizerLogger
  maxConcurrent?: number
  now?: () => number
  perImageBudgetMs?: number
  sharpFactory?: SharpFactory
}

type OutputFormat = 'jpeg' | 'png' | 'webp'

export class SessionImageOptimizer {
  private readonly outputRoot: string
  private readonly batchBudgetMs: number
  private readonly logger: SessionImageOptimizerLogger
  private readonly maxConcurrent: number
  private readonly now: () => number
  private readonly perImageBudgetMs: number
  private readonly sharpFactory: SharpFactory

  constructor(options: SessionImageOptimizerOptions) {
    this.outputRoot = options.outputRoot
    this.batchBudgetMs = options.batchBudgetMs ?? DEFAULT_BATCH_BUDGET_MS
    this.logger = options.logger ?? defaultLogger
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)
    this.now = options.now ?? Date.now
    this.perImageBudgetMs = options.perImageBudgetMs ?? DEFAULT_PER_IMAGE_BUDGET_MS
    this.sharpFactory = options.sharpFactory ?? (sharp as SharpFactory)
  }

  async optimizeBatch(sourcePaths: string[]): Promise<SessionImageOptimizationResult[]> {
    if (sourcePaths.length === 0) return []
    const batchStartedAt = this.now()
    const batchDeadline = batchStartedAt + this.batchBudgetMs
    const results = new Array<SessionImageOptimizationResult>(sourcePaths.length)
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (nextIndex < sourcePaths.length) {
        const index = nextIndex++
        const sourcePath = sourcePaths[index]
        if (sourcePath == null) continue
        if (this.now() - batchStartedAt >= this.batchBudgetMs) {
          results[index] = await this.fallbackForBatchTimeout(sourcePath, index)
          continue
        }
        const imageStartedAt = this.now()
        try {
          results[index] = await this.optimizeOne(sourcePath, index, batchDeadline)
        } catch (error) {
          const inputBytes = await stat(sourcePath)
            .then((value) => value.size)
            .catch(() => 0)
          results[index] = this.fallback(
            sourcePath,
            index,
            inputBytes,
            imageStartedAt,
            'write_error',
            error,
          )
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(this.maxConcurrent, sourcePaths.length) }, () => worker()),
    )
    return results
  }

  async cleanupExpiredFiles(): Promise<void> {
    let entries
    try {
      entries = await readdir(this.outputRoot, { withFileTypes: true })
    } catch (error) {
      if (isMissingFileError(error)) return
      this.logger.warn(`event=session_image_cleanup status=failed error=${safeError(error)}`)
      return
    }

    const cutoff = this.now() - CACHE_MAX_AGE_MS
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return
        const filePath = path.join(this.outputRoot, entry.name)
        try {
          const fileStat = await stat(filePath)
          if (fileStat.mtimeMs < cutoff || entry.name.endsWith('.tmp')) await unlink(filePath)
        } catch (error) {
          this.logger.warn(
            `event=session_image_cleanup status=failed file_hash=${shortHash(entry.name)} error=${safeError(error)}`,
          )
        }
      }),
    )
  }

  private async optimizeOne(
    sourcePath: string,
    attachmentIndex: number,
    batchDeadline: number,
  ): Promise<SessionImageOptimizationResult> {
    const startedAt = this.now()
    let inputBytes = 0
    let sourceMtimeMs: number
    try {
      const sourceStat = await stat(sourcePath)
      inputBytes = sourceStat.size
      sourceMtimeMs = sourceStat.mtimeMs
    } catch (error) {
      return this.fallback(
        sourcePath,
        attachmentIndex,
        inputBytes,
        startedAt,
        'decode_error',
        error,
      )
    }

    if (inputBytes <= SESSION_IMAGE_THRESHOLD_BYTES) {
      return {
        sourcePath,
        outputPath: sourcePath,
        status: 'original',
        reason: 'below_threshold',
        inputBytes,
        outputBytes: inputBytes,
        durationMs: elapsed(this.now(), startedAt),
      }
    }

    let metadata: Metadata
    try {
      metadata = await this.sharpFactory(sourcePath, {
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      }).metadata()
    } catch (error) {
      return this.fallback(
        sourcePath,
        attachmentIndex,
        inputBytes,
        startedAt,
        'decode_error',
        error,
      )
    }

    if (metadata.format === 'gif' && (metadata.pages ?? 1) > 1) {
      return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, 'animated')
    }

    const outputFormat = selectOutputFormat(metadata)
    if (outputFormat == null) {
      return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, 'unsupported')
    }

    const cacheKey = shortHash(
      `${path.resolve(sourcePath)}:${inputBytes}:${sourceMtimeMs}:${STRATEGY_VERSION}`,
    )
    const outputFileName = buildOutputFileName(sourcePath, cacheKey, outputFormat)
    const cached = await this.findCachedResult(outputFileName)
    if (cached != null) {
      this.logSuccess(attachmentIndex, cacheKey, inputBytes, cached.bytes, startedAt, 0, metadata)
      return {
        sourcePath,
        outputPath: cached.path,
        status: 'optimized',
        inputBytes,
        outputBytes: cached.bytes,
        durationMs: elapsed(this.now(), startedAt),
      }
    }

    await mkdir(this.outputRoot, { recursive: true })
    let lastBuffer: Buffer | null = null
    let lastInfo: { width: number; height: number; format: string } | null = null
    let attempts = 0

    try {
      for (const attempt of ATTEMPTS) {
        const now = this.now()
        const remainingMs = Math.min(
          this.perImageBudgetMs - elapsed(now, startedAt),
          batchDeadline - now,
        )
        if (remainingMs < 1_000) {
          const reason: SessionImageOptimizationReason =
            now >= batchDeadline - 1_000 ? 'batch_timeout' : 'timeout'
          return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, reason)
        }
        attempts += 1
        let pipeline = this.sharpFactory(sourcePath, {
          limitInputPixels: MAX_INPUT_PIXELS,
          sequentialRead: true,
        })
          .rotate()
          .resize({
            width: attempt.maxEdge,
            height: attempt.maxEdge,
            fit: 'inside',
            withoutEnlargement: true,
          })
        pipeline = encodePipeline(pipeline, outputFormat, attempt.quality)
        const encoded = await pipeline
          .timeout({ seconds: Math.max(1, Math.floor(remainingMs / 1000)) })
          .toBuffer({ resolveWithObject: true })
        lastBuffer = encoded.data
        lastInfo = encoded.info
        if (encoded.data.length <= SESSION_IMAGE_TARGET_BYTES) break
      }
    } catch (error) {
      const reason: SessionImageOptimizationReason = isTimeoutError(error)
        ? 'timeout'
        : 'encode_error'
      return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, reason, error)
    }

    if (
      lastBuffer == null ||
      lastInfo == null ||
      lastBuffer.length > SESSION_IMAGE_THRESHOLD_BYTES
    ) {
      return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, 'encode_error')
    }

    const finalPath = path.join(this.outputRoot, outputFileName)
    const tempPath = `${finalPath}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, lastBuffer)
      await rename(tempPath, finalPath)
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, 'write_error', error)
    }

    this.logSuccess(
      attachmentIndex,
      cacheKey,
      inputBytes,
      lastBuffer.length,
      startedAt,
      attempts,
      metadata,
    )
    return {
      sourcePath,
      outputPath: finalPath,
      status: 'optimized',
      inputBytes,
      outputBytes: lastBuffer.length,
      durationMs: elapsed(this.now(), startedAt),
    }
  }

  private async findCachedResult(
    outputFileName: string,
  ): Promise<{ path: string; bytes: number } | null> {
    const filePath = path.join(this.outputRoot, outputFileName)
    try {
      const fileStat = await stat(filePath)
      if (fileStat.size > 0 && fileStat.size <= SESSION_IMAGE_THRESHOLD_BYTES) {
        return { path: filePath, bytes: fileStat.size }
      }
    } catch {
      // A cache miss is expected on the first send.
    }
    return null
  }

  private async fallbackForBatchTimeout(
    sourcePath: string,
    attachmentIndex: number,
  ): Promise<SessionImageOptimizationResult> {
    const startedAt = this.now()
    const inputBytes = await stat(sourcePath)
      .then((value) => value.size)
      .catch(() => 0)
    return this.fallback(sourcePath, attachmentIndex, inputBytes, startedAt, 'batch_timeout')
  }

  private fallback(
    sourcePath: string,
    attachmentIndex: number,
    inputBytes: number,
    startedAt: number,
    reason: SessionImageOptimizationReason,
    error?: unknown,
  ): SessionImageOptimizationResult {
    const durationMs = elapsed(this.now(), startedAt)
    const level =
      reason === 'decode_error' || reason === 'encode_error' || reason === 'write_error'
        ? 'error'
        : 'warn'
    this.logger[level](
      `event=session_image_optimize status=fallback reason=${reason} attachment=${attachmentIndex + 1} hash=${shortHash(sourcePath)} input_bytes=${inputBytes} duration_ms=${durationMs}${error == null ? '' : ` error=${safeError(error, sourcePath)}`}`,
    )
    return {
      sourcePath,
      outputPath: sourcePath,
      status: 'fallback',
      reason,
      inputBytes,
      outputBytes: inputBytes,
      durationMs,
    }
  }

  private logSuccess(
    attachmentIndex: number,
    cacheKey: string,
    inputBytes: number,
    outputBytes: number,
    startedAt: number,
    attempts: number,
    metadata: Metadata,
  ): void {
    this.logger.info(
      `event=session_image_optimize status=optimized attachment=${attachmentIndex + 1} hash=${cacheKey} input_bytes=${inputBytes} output_bytes=${outputBytes} duration_ms=${elapsed(this.now(), startedAt)} attempts=${attempts} width=${metadata.width ?? 0} height=${metadata.height ?? 0} format=${metadata.format ?? 'unknown'}`,
    )
  }
}

function selectOutputFormat(metadata: Metadata): OutputFormat | null {
  if (metadata.format === 'png') return 'png'
  if (metadata.format === 'webp') return 'webp'
  if (metadata.format === 'gif') return 'png'
  if (metadata.format === 'jpeg' || metadata.format === 'heif') return 'jpeg'
  if (metadata.format === 'tiff' || metadata.format === 'raw') {
    return metadata.hasAlpha === true ? 'png' : 'jpeg'
  }
  return null
}

function encodePipeline(pipeline: Sharp, format: OutputFormat, quality: number): Sharp {
  if (format === 'png') return pipeline.png({ compressionLevel: 9 })
  if (format === 'webp') return pipeline.webp({ quality })
  return pipeline.jpeg({ quality, mozjpeg: true })
}

function buildOutputFileName(
  sourcePath: string,
  cacheKey: string,
  outputFormat: OutputFormat,
): string {
  const sourceExtension = path.extname(sourcePath)
  const sourceBaseName = path.basename(sourcePath, sourceExtension)
  const safeBaseName =
    sourceBaseName
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'image'
  return `${safeBaseName}-${cacheKey}-${STRATEGY_VERSION}.${outputFormat}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt))
}

function isTimeoutError(error: unknown): boolean {
  return safeError(error).toLowerCase().includes('timeout')
}

function safeError(error: unknown, sensitivePath?: string): string {
  let message = error instanceof Error ? error.message : String(error)
  if (sensitivePath != null && sensitivePath.length > 0) {
    message = message.split(sensitivePath).join('<source>')
  }
  return JSON.stringify(message.replace(/[\r\n]+/g, ' ').slice(0, 300))
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}
