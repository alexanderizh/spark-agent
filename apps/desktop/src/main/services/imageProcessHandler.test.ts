import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { handleImageProcess } from './imageProcessHandler.js'

const mocks = vi.hoisted(() => ({
  isSafeFilePathAllowed: vi.fn<(path: string) => boolean>(() => true),
}))

vi.mock('electron', async () => {
  const os = await import('node:os')
  return { app: { getPath: () => os.tmpdir() } }
})

vi.mock('./SafeFileProtocol.js', () => ({
  isSafeFilePathAllowed: mocks.isSafeFilePathAllowed,
}))

const cleanupPaths = new Set<string>()

async function createPng(width = 120, height = 80): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-image-process-test-'))
  cleanupPaths.add(directory)
  const inputPath = join(directory, 'source.png')
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 36, g: 128, b: 220, alpha: 0.8 },
    },
  })
    .png()
    .toFile(inputPath)
  return inputPath
}

async function createOrientedJpeg(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-image-process-orientation-test-'))
  cleanupPaths.add(directory)
  const inputPath = join(directory, 'oriented.jpg')
  await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: { r: 220, g: 120, b: 36 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(inputPath)
  return inputPath
}

async function createAnimatedGif(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-image-process-animation-test-'))
  cleanupPaths.add(directory)
  const inputPath = join(directory, 'animated.gif')
  await sharp({
    create: {
      width: 24,
      height: 32,
      pageHeight: 16,
      channels: 4,
      background: { r: 80, g: 180, b: 120, alpha: 1 },
    },
  })
    .gif({ delay: [100, 100], keepDuplicateFrames: true, loop: 0 })
    .toFile(inputPath)
  return inputPath
}

beforeEach(() => {
  mocks.isSafeFilePathAllowed.mockReset()
  mocks.isSafeFilePathAllowed.mockReturnValue(true)
})

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map((path) =>
      rm(path, { recursive: true, force: true }).catch(() => undefined),
    ),
  )
  cleanupPaths.clear()
})

describe('handleImageProcess', () => {
  it('probes dimensions, format and file size', async () => {
    const input = await createPng()
    const response = await handleImageProcess({
      operation: 'probe',
      input,
      params: {},
      requestId: 'probe-1',
    })

    expect(response.success).toBe(true)
    expect(response.result).toMatchObject({
      width: 120,
      height: 80,
      format: 'png',
      hasAlpha: true,
      pages: 1,
      animated: false,
    })
    expect((response.result as { fileSize: number }).fileSize).toBeGreaterThan(0)
  })

  it('scales, encodes and reports a completed output', async () => {
    const input = await createPng()
    const progress: Array<{ percent: number; stage: string }> = []
    const response = await handleImageProcess(
      {
        operation: 'scaleCompress',
        input,
        params: { scalePercent: 50, compressPercent: 50 },
        requestId: 'scale-1',
      },
      (next) => progress.push(next),
    )

    expect(response.success).toBe(true)
    const result = response.result as {
      path: string
      width: number
      height: number
      format: string
      sourceBytes: number
      outputBytes: number
      quality: number
    }
    cleanupPaths.add(result.path)
    expect(result).toMatchObject({ width: 60, height: 40, format: 'png' })
    expect(result.sourceBytes).toBeGreaterThan(0)
    expect(result.outputBytes).toBe((await stat(result.path)).size)
    expect(result.quality).toBeGreaterThanOrEqual(10)
    expect(result.quality).toBeLessThanOrEqual(95)
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ width: 60, height: 40 })
    expect(progress.at(-1)).toEqual({ percent: 100, stage: '处理完成' })
  })

  it('rejects invalid percentages before creating an output', async () => {
    const input = await createPng()
    const response = await handleImageProcess({
      operation: 'scaleCompress',
      input,
      params: { scalePercent: 0, compressPercent: 50 },
      requestId: 'invalid-percent',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('尺寸缩放比例超出允许范围')
  })

  it('uses display orientation when probing and scaling EXIF-rotated images', async () => {
    const input = await createOrientedJpeg()
    const probe = await handleImageProcess({
      operation: 'probe',
      input,
      params: {},
      requestId: 'oriented-probe',
    })
    expect(probe.result).toMatchObject({ width: 80, height: 120 })

    const response = await handleImageProcess({
      operation: 'scaleCompress',
      input,
      params: { scalePercent: 50, compressPercent: 50 },
      requestId: 'oriented-scale',
    })
    expect(response.success).toBe(true)
    const result = response.result as { path: string; width: number; height: number }
    cleanupPaths.add(result.path)
    expect(result).toMatchObject({ width: 40, height: 60 })
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ width: 40, height: 60 })
  })

  it('detects and rejects animated images instead of dropping frames', async () => {
    const input = await createAnimatedGif()
    const probe = await handleImageProcess({
      operation: 'probe',
      input,
      params: {},
      requestId: 'animated-probe',
    })
    expect(probe.result).toMatchObject({ pages: 2, animated: true })

    const response = await handleImageProcess({
      operation: 'scaleCompress',
      input,
      params: { scalePercent: 50, compressPercent: 50 },
      requestId: 'animated-scale',
    })
    expect(response.success).toBe(false)
    expect(response.error).toContain('暂不支持多页图片或动图尺寸压缩')
  })

  it('rejects files outside the safe-file allowlist', async () => {
    const input = await createPng()
    mocks.isSafeFilePathAllowed.mockReturnValue(false)
    const response = await handleImageProcess({
      operation: 'probe',
      input,
      params: {},
      requestId: 'unsafe-path',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('Path outside allowed roots')
  })
})
