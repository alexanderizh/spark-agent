import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { once } from 'node:events'
import { probeVideo, type VideoProbeInfo } from '../FfmpegRunner.js'
import { resolveFfmpegBin } from '../FfmpegIntegrityService.js'
import { DepthInferenceWorker } from './DepthInferenceWorker.js'
import {
  depthEncoderInputPixelFormat,
  resolveDepthVideoRenderOptions,
  type DepthVideoRenderOptions,
} from './depthRenderOptions.js'

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
  preserveAudio?: boolean
  renderOptions?: Partial<DepthVideoRenderOptions>
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
  createFrameProcessor: (
    modelDir: string,
    runtimeEntryPath: string,
    renderOptions: DepthVideoRenderOptions,
  ) => FrameProcessor
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
  createFrameProcessor: (modelDir, runtimeEntryPath, renderOptions) =>
    new DepthInferenceWorker({ modelDir, runtimeEntryPath, renderOptions }),
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
    const renderOptions = resolveDepthVideoRenderOptions(request.renderOptions)
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
        inputPath: request.inputPath,
        width: dimensions.width,
        height: dimensions.height,
        fps: processingFps,
        durationSec: probe.durationSec,
        outputPath: temporaryPath,
        preserveAudio: request.preserveAudio === true,
        sourcePixelFormat: depthEncoderInputPixelFormat(renderOptions),
      }),
    )
    const decoderExit = waitForProcess(decoder, '视频解码')
    const encoderExit = waitForProcess(encoder, '视频编码')
    // Attach rejection handlers immediately: cancellation can terminate both processes at once,
    // while the main flow only awaits them sequentially.
    void Promise.allSettled([decoderExit, encoderExit])
    // 取消会先 kill ffmpeg，但父进程侧的 stdin 要到下一次写入才异步收到 EPIPE：
    // 没有 'error' 监听时该错误会升级为 uncaughtException，触发 Electron 崩溃弹窗
    // 并退出整个应用。这里捕获首个流错误，由主循环把它转成普通的任务失败。
    let encoderInputFailure: Error | null = null
    encoder.stdin.on('error', (error) => {
      encoderInputFailure ??= error instanceof Error ? error : new Error(String(error))
    })
    let frameProcessor: FrameProcessor | null = null
    const abort = () => {
      terminateDepthProcess(decoder)
      terminateDepthProcess(encoder)
      // dispose 可能异步失败（如 worker 终止异常），不能留成 unhandledRejection。
      void Promise.resolve(frameProcessor?.dispose()).catch(() => undefined)
    }
    request.signal?.addEventListener('abort', abort, { once: true })

    try {
      if (request.signal?.aborted) throw new Error('cancelled')
      frameProcessor = this.dependencies.createFrameProcessor(
        request.modelDir,
        request.runtimeEntryPath,
        renderOptions,
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
          if (request.signal?.aborted) throw new Error('cancelled')
          if (encoderInputFailure) {
            throw new Error('视频编码输入流已中断', { cause: encoderInputFailure })
          }
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
      if (!encoder.stdin.destroyed) encoder.stdin.end()
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
  inputPath?: string
  width: number
  height: number
  fps: number
  durationSec?: number
  outputPath: string
  preserveAudio?: boolean
  /** 编码进程 stdin 上深度帧的像素格式：灰度（默认）或伪彩色 RGB。 */
  sourcePixelFormat?: 'gray' | 'rgb24'
}): string[] {
  const pixelFormat = input.width % 2 === 0 && input.height % 2 === 0 ? 'yuv420p' : 'yuv444p'
  const args = [
    '-f',
    'rawvideo',
    '-pixel_format',
    input.sourcePixelFormat ?? 'gray',
    '-video_size',
    `${input.width}x${input.height}`,
    '-framerate',
    String(input.fps),
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-pix_fmt',
    pixelFormat,
    '-movflags',
    '+faststart',
    '-y',
    input.outputPath,
  ]
  if (!input.preserveAudio) {
    return [...args.slice(0, 10), '-an', ...args.slice(10)]
  }
  if (!input.inputPath) throw new Error('保留音频时缺少源视频路径')
  if (!input.durationSec || input.durationSec <= 0) throw new Error('保留音频时缺少源视频时长')
  return [
    '-i',
    input.inputPath,
    ...args.slice(0, 10),
    '-map',
    '1:v:0',
    '-map',
    '0:a:0?',
    '-c:a',
    'aac',
    '-t',
    String(input.durationSec),
    ...args.slice(10),
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
