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
  createFrameProcessor: (modelDir: string) => FrameProcessor
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
  createFrameProcessor: (modelDir) => new DepthInferenceWorker({ modelDir }),
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
    await this.dependencies.ensureOutputDir(dirname(request.outputPath))
    const { ffmpeg } = await this.dependencies.resolveBins()
    const temporaryPath = temporaryOutputPath(request.outputPath)
    const decoder = this.dependencies.spawnProcess(
      ffmpeg,
      buildDepthVideoDecoderArgs(request.inputPath),
    )
    const encoder = this.dependencies.spawnProcess(
      ffmpeg,
      buildDepthVideoEncoderArgs({
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
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
      decoder.kill('SIGTERM')
      encoder.kill('SIGTERM')
      void frameProcessor?.dispose()
    }
    request.signal?.addEventListener('abort', abort, { once: true })

    try {
      if (request.signal?.aborted) throw new Error('cancelled')
      frameProcessor = this.dependencies.createFrameProcessor(request.modelDir)
      const frameBytes = probe.width * probe.height * 3
      const totalFrames = Math.max(1, Math.round(probe.durationSec * probe.fps))
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
            width: probe.width,
            height: probe.height,
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
      return {
        path: request.outputPath,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        durationSec: probe.durationSec,
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

export function buildDepthVideoDecoderArgs(inputPath: string): string[] {
  return [
    '-i',
    inputPath,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-fps_mode',
    'passthrough',
    'pipe:1',
  ]
}

export function buildDepthVideoEncoderArgs(input: {
  width: number
  height: number
  fps: number
  outputPath: string
}): string[] {
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
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    input.outputPath,
  ]
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
