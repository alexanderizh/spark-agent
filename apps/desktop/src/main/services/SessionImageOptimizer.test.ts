import { createHash, randomFillSync } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_IMAGE_THRESHOLD_BYTES,
  SessionImageOptimizer,
  type SessionImageOptimizerLogger,
  type SharpFactory,
} from './SessionImageOptimizer.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'spark-session-image-test-'))
  roots.push(root)
  return root
}

function createLogger(): SessionImageOptimizerLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

async function createOversizedJpeg(filePath: string): Promise<void> {
  const width = 64
  const height = 64
  const pixels = Buffer.allocUnsafe(width * height * 3)
  randomFillSync(pixels)
  const encoded = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer()
  // JPEG decoders ignore trailing bytes. Padding keeps this fixture quick to create while
  // exercising the real >4 MiB stat gate and a real Sharp decode/encode pipeline.
  await writeFile(
    filePath,
    Buffer.concat([
      encoded,
      Buffer.alloc(Math.max(0, SESSION_IMAGE_THRESHOLD_BYTES + 1 - encoded.length)),
    ]),
  )
  expect((await stat(filePath)).size).toBeGreaterThan(SESSION_IMAGE_THRESHOLD_BYTES)
}

function fakeSharpFactory(options: {
  toBuffer: () => Promise<{ data: Buffer; info: { width: number; height: number; format: string } }>
}): SharpFactory {
  return (() => {
    const pipeline = {
      metadata: async () => ({
        format: 'jpeg',
        width: 4_000,
        height: 3_000,
        pages: 1,
        hasAlpha: false,
      }),
      rotate: () => pipeline,
      resize: () => pipeline,
      jpeg: () => pipeline,
      png: () => pipeline,
      webp: () => pipeline,
      timeout: () => pipeline,
      toBuffer: options.toBuffer,
    }
    return pipeline
  }) as unknown as SharpFactory
}

describe('SessionImageOptimizer', () => {
  it('returns the original path at or below 4 MiB without loading Sharp', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'small.png')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES))
    const sharpFactory = vi.fn() as unknown as SharpFactory
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      sharpFactory,
      logger: createLogger(),
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])

    expect(result).toMatchObject({
      sourcePath,
      outputPath: sourcePath,
      status: 'original',
      reason: 'below_threshold',
      inputBytes: SESSION_IMAGE_THRESHOLD_BYTES,
      outputBytes: SESSION_IMAGE_THRESHOLD_BYTES,
    })
    expect(sharpFactory).not.toHaveBeenCalled()
  })

  it('optimizes an oversized JPEG without changing its source bytes', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'large.jpg')
    await createOversizedJpeg(sourcePath)
    const originalHash = createHash('sha256')
      .update(await readFile(sourcePath))
      .digest('hex')
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger: createLogger(),
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])
    expect(result).toBeDefined()
    if (result == null) throw new Error('missing optimization result')

    expect(result.status).toBe('optimized')
    expect(result.outputPath).not.toBe(sourcePath)
    expect(path.basename(result.outputPath)).toMatch(/^large-[a-f0-9]{12}-v1\.jpeg$/)
    expect(result.outputBytes).toBeLessThan(SESSION_IMAGE_THRESHOLD_BYTES)
    expect(result.durationMs).toBeLessThanOrEqual(3_000)
    expect(
      createHash('sha256')
        .update(await readFile(sourcePath))
        .digest('hex'),
    ).toBe(originalHash)
    expect((await sharp(result.outputPath).metadata()).format).toBe('jpeg')
  }, 20_000)

  it('logs a timeout and falls back to the source image', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'slow.jpg')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
    const logger = createLogger()
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger,
      sharpFactory: fakeSharpFactory({
        toBuffer: async () => {
          throw new Error('timeout: 42% complete')
        },
      }),
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])

    expect(result).toMatchObject({ outputPath: sourcePath, status: 'fallback', reason: 'timeout' })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reason=timeout'))
  })

  it('does not expose the source path in error logs', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'private-name.jpg')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
    const logger = createLogger()
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger,
      sharpFactory: fakeSharpFactory({
        toBuffer: async () => {
          throw new Error(`failed to decode ${sourcePath}`)
        },
      }),
    })

    await optimizer.optimizeBatch([sourcePath])

    expect(logger.error).toHaveBeenCalled()
    expect(logger.error.mock.calls.flat().join('\n')).not.toContain(sourcePath)
  })

  it('keeps transparent PNG output as PNG with alpha', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'transparent.png')
    const encoded = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer()
    await writeFile(
      sourcePath,
      Buffer.concat([
        encoded,
        Buffer.alloc(Math.max(0, SESSION_IMAGE_THRESHOLD_BYTES + 1 - encoded.length)),
      ]),
    )
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger: createLogger(),
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])
    expect(result?.status).toBe('optimized')
    const metadata = await sharp(result?.outputPath).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.hasAlpha).toBe(true)
  })

  it('reuses an optimized cache entry on resend', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'cached.jpg')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
    const toBuffer = vi.fn(async () => ({
      data: Buffer.alloc(1024),
      info: { width: 100, height: 100, format: 'jpeg' },
    }))
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger: createLogger(),
      sharpFactory: fakeSharpFactory({ toBuffer }),
    })

    const [first] = await optimizer.optimizeBatch([sourcePath])
    const [second] = await optimizer.optimizeBatch([sourcePath])

    expect(first?.status).toBe('optimized')
    expect(second?.outputPath).toBe(first?.outputPath)
    expect(toBuffer).toHaveBeenCalledTimes(1)
  })

  it('falls back and logs when the output directory cannot be created', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'source.jpg')
    const outputRoot = path.join(root, 'not-a-directory')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
    await writeFile(outputRoot, 'occupied')
    const logger = createLogger()
    const optimizer = new SessionImageOptimizer({
      outputRoot,
      logger,
      sharpFactory: fakeSharpFactory({
        toBuffer: async () => ({
          data: Buffer.alloc(1024),
          info: { width: 100, height: 100, format: 'jpeg' },
        }),
      }),
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])

    expect(result).toMatchObject({ status: 'fallback', outputPath: sourcePath })
    expect(logger.error).toHaveBeenCalled()
  })

  it('never runs more than two encoders concurrently', async () => {
    const root = await createRoot()
    const sourcePaths = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const filePath = path.join(root, `${index}.jpg`)
        await writeFile(filePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
        return filePath
      }),
    )
    let active = 0
    let maxActive = 0
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger: createLogger(),
      sharpFactory: fakeSharpFactory({
        toBuffer: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 15))
          active -= 1
          return { data: Buffer.alloc(1024), info: { width: 100, height: 100, format: 'jpeg' } }
        },
      }),
    })

    const results = await optimizer.optimizeBatch(sourcePaths)

    expect(results.every((result) => result.status === 'optimized')).toBe(true)
    expect(maxActive).toBe(2)
  })

  it('falls back without starting encoders when the batch budget is exhausted', async () => {
    const root = await createRoot()
    const sourcePath = path.join(root, 'late.jpg')
    await writeFile(sourcePath, Buffer.alloc(SESSION_IMAGE_THRESHOLD_BYTES + 1))
    const sharpFactory = vi.fn() as unknown as SharpFactory
    const optimizer = new SessionImageOptimizer({
      outputRoot: path.join(root, 'output'),
      logger: createLogger(),
      sharpFactory,
      batchBudgetMs: 0,
    })

    const [result] = await optimizer.optimizeBatch([sourcePath])

    expect(result).toMatchObject({
      outputPath: sourcePath,
      status: 'fallback',
      reason: 'batch_timeout',
    })
    expect(sharpFactory).not.toHaveBeenCalled()
  })

  it('cleans expired cache files and abandoned temporary files', async () => {
    const root = await createRoot()
    const outputRoot = path.join(root, 'output')
    await mkdir(outputRoot)
    const oldPath = path.join(outputRoot, 'old.jpeg')
    const freshPath = path.join(outputRoot, 'fresh.jpeg')
    const temporaryPath = path.join(outputRoot, 'abandoned.tmp')
    await Promise.all([
      writeFile(oldPath, 'old'),
      writeFile(freshPath, 'fresh'),
      writeFile(temporaryPath, 'temporary'),
    ])
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(oldPath, oldDate, oldDate)
    const optimizer = new SessionImageOptimizer({ outputRoot, logger: createLogger() })

    await optimizer.cleanupExpiredFiles()

    await expect(access(oldPath)).rejects.toThrow()
    await expect(access(temporaryPath)).rejects.toThrow()
    await expect(access(freshPath)).resolves.toBeUndefined()
  })
})
