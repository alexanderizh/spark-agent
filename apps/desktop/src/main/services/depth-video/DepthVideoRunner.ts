import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { once } from 'node:events'
import { probeVideo, type VideoProbeInfo } from '../FfmpegRunner.js'
import { resolveFfmpegBin } from '../FfmpegIntegrityService.js'
import { DepthInferenceWorker } from './DepthInferenceWorker.js'

type SpawnedProcess = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'on' | 'once' | 'off' | 'kill'
>

type FrameProcessor = {
  process(frame: { rgb: Uint8Array; width: number; height: number }): Promise<Uint8Array>
  dispose(): Promise<void> | void
}

export type DepthVideoProgressStage = 'decoding' | 'estimating_depth' | 'encoding'

export type DepthVideoProgress = {
  stage: DepthVideoProgressStage
  percent: number
  frame: number
  totalFrames: number
}

export type DepthVideoRunRequest = {
  inputPath: string
  outputPath: string
  modelDir: string
  runtimeEntryPath: string
  signal?: AbortSignal
  onProgress?: (progress: DepthVideoProgress) => void
}

export type DepthVideoRunResult = {
  path: string
  width: number
  height: number
  fps: number
  durationSec: number
  frameCount: number
}

type DepthVideoRunnerDependencies = {
  probe: typeof probeVideo
  resolveBins: typeof resolveFfmpegBin
  spawnProcess: (executable: string, args: string[]) => SpawnedProcess
  createFrameProcessor: (modelDir: string, runtimeEntryPath: string) => FrameProcessor
  ensureOutputDir: (directory: string) => Promise<void>
  finalizeOutput: (temporaryPath: string, outputPath: string) => Promise<void>
  removeOutput: (filePath: string) => Promise<void>
}

const DEFAULT_DEPENDENCIES: DepthVideoRunnerDependencies = {
  probe: probeVideo,
  resolveBins: resolveFfmpegBin,
  spawnProcess: (executable, args) =>
    spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  createFrameProcessor: (modelDir, runtimeEntryPath) =>
    new DepthInferenceWorker({ modelDir, runtimeEntryPath }),
  ensureOutputDir: async (directory) => {
    await mkdir(directory, { recursive: true })
  },
  finalizeOutput: rename,
  removeOutput: async (filePath) => rm(filePath, { force: true }),
}

export class DepthVideoRunner {
  private readonly dependencies: DepthVideoRunnerDependencies

  constructor(dependencies: Partial<DepthVideoRunnerDependencies> = {}) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  async run(request: DepthVideoRunRequest): Promise<DepthVideoRunResult> {
    const probe = await this.dependencies.probe(request.inputPath)
    validateProbe(probe)
    const dimensions = resolveDepthVideoDimensions(probe)
    const processingFps = probe.averageFps && probe.averageFps > 0 ? probe.averageFps : probe.fps
    await this.dependencies.ensureOutputDir(dirname(request.outputPath))
    const { ffmpeg } = await this.dependencies.resolveBins()
    const temporaryPath = temporaryOutputPath(request.outputPath)
    const decoder = this.dependencies.spawnProcess(
      ffmpeg,
      buildDepthVideoDecoderArgs(request.inputPath, processingFps),
    )
    const encoder = this.dependencies.spawnProcess(
      ffmpeg,
      buildDepthVideoEncoderArgs({
        width: dimensions.width,
        height: dimensions.height,
        fps: processingFps,
        outputPath: temporaryPath,
      }),
    )
    const decoderExit = waitForProcess(decoder, '视频解码')
    const encoderExit = waitForProcess(encoder, '视频编码')
    // Attach rejection handlers immediately: cancellation can terminate both processes at once,
    // while the main flow only awaits them sequentially.
    void Promise.allSettled([decoderExit, encoderExit])
    let frameProcessor: FrameProcessor | null = null
    const abort = () => {
      terminateDepthProcess(decoder)
      terminateDepthProcess(encoder)
      void frameProcessor?.dispose()
    }
    request.signal?.addEventListener('abort', abort, { once: true })

    try {
      if (request.signal?.aborted) throw new Error('cancelled')
      frameProcessor = this.dependencies.createFrameProcessor(
        request.modelDir,
        request.runtimeEntryPath,
      )
      const frameBytes = dimensions.width * dimensions.height * 3
      const totalFrames = Math.max(1, Math.round(probe.durationSec * processingFps))
      let frameCount = 0
      let pending = Buffer.alloc(0)
      request.onProgress?.({ stage: 'decoding', percent: 0, frame: 0, totalFrames })

      for await (const chunk of decoder.stdout) {
        if (request.signal?.aborted) throw new Error('cancelled')
        pending = Buffer.concat([pending, Buffer.from(chunk)])
        while (pending.length >= frameBytes) {
          const rgb = Uint8Array.from(pending.subarray(0, frameBytes))
          pending = pending.subarray(frameBytes)
          const depth = await frameProcessor.process({
            rgb,
            width: dimensions.width,
            height: dimensions.height,
          })
          await writeWithBackpressure(encoder, depth)
          frameCount += 1
          request.onProgress?.({
            stage: 'estimating_depth',
            percent: Math.min(98, Math.round((frameCount / totalFrames) * 98)),
            frame: frameCount,
            totalFrames,
          })
        }
      }

      await decoderExit
      if (pending.length > 0) throw new Error('视频解码返回了不完整的 RGB 帧')
      request.onProgress?.({
        stage: 'encoding',
        percent: 99,
        frame: frameCount,
        totalFrames,
      })
      encoder.stdin.end()
      await encoderExit
      if (request.signal?.aborted) throw new Error('cancelled')
      await this.dependencies.finalizeOutput(temporaryPath, request.outputPath)
      const outputProbe = await this.dependencies.probe(request.outputPath)
      validateProbe(outputProbe)
      return {
        path: request.outputPath,
        width: outputProbe.width,
        height: outputProbe.height,
        fps: outputProbe.fps,
        durationSec: outputProbe.durationSec,
        frameCount,
      }
    } catch (error) {
      abort()
      await this.dependencies.removeOutput(temporaryPath).catch(() => undefined)
      if (request.signal?.aborted) throw new Error('cancelled', { cause: error })
      throw error
    } finally {
      request.signal?.removeEventListener('abort', abort)
      await Promise.resolve(frameProcessor?.dispose()).catch(() => undefined)
    }
  }
}

export function terminateDepthProcess(process: SpawnedProcess, graceMs = 2_000): void {
  if (!process.kill('SIGTERM')) return
  const timer = setTimeout(() => {
    process.kill('SIGKILL')
  }, graceMs)
  timer.unref()
  process.once('close', () => clearTimeout(timer))
}

export function buildDepthVideoDecoderArgs(
  inputPath: string,
  fps?: number,
  platform: NodeJS.Platform = process.platform,
): string[] {
  // FFmpeg 4.x on existing Windows installations does not support
  // `-fps_mode`, while the current macOS bundle no longer accepts `-vsync`.
  // Keep the platform-specific option here so both managed binary generations
  // can decode the filtered raw-video stream.
  const frameSyncArgs = platform === 'win32' ? ['-vsync', '0'] : ['-fps_mode', 'passthrough']
  return [
    '-i',
    inputPath,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    ...(fps && fps > 0 ? ['-vf', `fps=${fps}`] : []),
    ...frameSyncArgs,
    'pipe:1',
  ]
}

export function buildDepthVideoEncoderArgs(input: {
  width: number
  height: number
  fps: number
  outputPath: string
}): string[] {
  const pixelFormat = input.width % 2 === 0 && input.height % 2 === 0 ? 'yuv420p' : 'yuv444p'
  return [
    '-f',
    'rawvideo',
    '-pixel_format',
    'gray',
    '-video_size',
    `${input.width}x${input.height}`,
    '-framerate',
    String(input.fps),
    '-i',
    'pipe:0',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    pixelFormat,
    '-movflags',
    '+faststart',
    '-y',
    input.outputPath,
  ]
}

export function resolveDepthVideoDimensions(input: {
  width: number
  height: number
  rotation?: number
}): { width: number; height: number } {
  const normalizedRotation = Math.abs(input.rotation ?? 0) % 180
  return normalizedRotation === 90
    ? { width: input.height, height: input.width }
    : { width: input.width, height: input.height }
}

function validateProbe(probe: VideoProbeInfo): void {
  if (probe.width <= 0 || probe.height <= 0 || probe.fps <= 0 || probe.durationSec <= 0) {
    throw new Error('无法读取有效的视频尺寸、帧率或时长')
  }
}

function temporaryOutputPath(outputPath: string): string {
  const extension = extname(outputPath) || '.mp4'
  const stem = outputPath.slice(0, Math.max(0, outputPath.length - extension.length))
  return join(
    dirname(outputPath),
    `${stem.split(/[\\/]/).pop()}.partial-${randomUUID()}${extension}`,
  )
}

async function writeWithBackpressure(process: SpawnedProcess, frame: Uint8Array): Promise<void> {
  if (process.stdin.destroyed) throw new Error('视频编码输入流已关闭')
  if (!process.stdin.write(frame)) await once(process.stdin, 'drain')
}

function waitForProcess(process: SpawnedProcess, label: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const stderr: Buffer[] = []
    process.stderr.on('data', (chunk) => {
      stderr.push(Buffer.from(chunk))
      if (stderr.length > 32) stderr.shift()
    })
    process.once('error', reject)
    process.once('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${label}失败：${Buffer.concat(stderr).toString('utf8').slice(-500)}`))
    })
  })
}
