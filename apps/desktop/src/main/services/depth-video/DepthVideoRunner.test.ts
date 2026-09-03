import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  buildDepthVideoDecoderArgs,
  buildDepthVideoEncoderArgs,
  DepthVideoRunner,
  resolveDepthVideoDimensions,
  terminateDepthProcess,
} from './DepthVideoRunner'

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => {
    this.stdout.destroy()
    this.stdin.destroy()
    this.emit('close', null)
    return true
  })
}

describe('DepthVideoRunner', () => {
  it('uses the legacy frame sync option on Windows', () => {
    const args = buildDepthVideoDecoderArgs('/tmp/source.mp4', 24, 'win32')
    expect(args).toContain('-vsync')
    expect(args).toContain('0')
    expect(args).toContain('fps=24')
    expect(args).not.toContain('-fps_mode')
  })

  it('uses the current frame sync option on macOS', () => {
    const args = buildDepthVideoDecoderArgs('/tmp/source.mp4', 24, 'darwin')
    expect(args).toContain('-fps_mode')
    expect(args).toContain('passthrough')
    expect(args).toContain('fps=24')
    expect(args).not.toContain('-vsync')
  })

  it('builds an H.264 gray-video encoder that preserves dimensions and drops audio', () => {
    const args = buildDepthVideoEncoderArgs({
      width: 640,
      height: 360,
      fps: 24,
      outputPath: '/tmp/depth.mp4',
    })
    expect(args).toContain('640x360')
    expect(args).toContain('24')
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
    expect(args).toContain('-an')
  })

  it('maps the source audio when audio preservation is enabled', () => {
    const args = buildDepthVideoEncoderArgs({
      inputPath: '/tmp/source.mp4',
      width: 640,
      height: 360,
      fps: 24,
      durationSec: 10,
      outputPath: '/tmp/depth.mp4',
      preserveAudio: true,
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/source.mp4',
        '-map',
        '1:v:0',
        '-map',
        '0:a:0?',
        '-c:a',
        'aac',
        '-t',
        '10',
      ]),
    )
    expect(args).not.toContain('-shortest')
    expect(args).not.toContain('-an')
  })

  it('preserves odd dimensions with an H.264-compatible non-subsampled pixel format', () => {
    const args = buildDepthVideoEncoderArgs({
      width: 641,
      height: 359,
      fps: 24,
      outputPath: '/tmp/depth.mp4',
    })
    expect(args).toContain('641x359')
    expect(args).toContain('yuv444p')
  })

  it('reads grayscale frames by default and RGB frames when a colormap is active', () => {
    const base = { width: 640, height: 360, fps: 24, outputPath: '/tmp/depth.mp4' }
    expect(buildDepthVideoEncoderArgs(base)).toContain('gray')
    expect(buildDepthVideoEncoderArgs(base)).not.toContain('rgb24')
    const rgbArgs = buildDepthVideoEncoderArgs({ ...base, sourcePixelFormat: 'rgb24' })
    expect(rgbArgs).toContain('rgb24')
    // rgb24 出现在 rawvideo 输入格式位，编码输出像素格式仍由尺寸决定。
    expect(rgbArgs.indexOf('rgb24')).toBeLessThan(rgbArgs.indexOf('libx264'))
  })

  it('uses display geometry for auto-rotated portrait videos', () => {
    expect(resolveDepthVideoDimensions({ width: 1920, height: 1080, rotation: 90 })).toEqual({
      width: 1080,
      height: 1920,
    })
  })

  it('escalates a stuck FFmpeg process from SIGTERM to SIGKILL', () => {
    vi.useFakeTimers()
    const process = new FakeProcess()
    process.kill.mockImplementation(() => true)

    terminateDepthProcess(process as never, 50)
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(50)
    expect(process.kill).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  it('processes chunked RGB frames with backpressure and reports source metadata', async () => {
    const decoder = new FakeProcess()
    const encoder = new FakeProcess()
    const spawnProcess = vi.fn().mockReturnValueOnce(decoder).mockReturnValueOnce(encoder)
    const frameProcessor = {
      process: vi.fn(async () => new Uint8Array([0, 255])),
      dispose: vi.fn(async () => undefined),
    }
    const createFrameProcessor = vi.fn(() => frameProcessor)
    const runner = new DepthVideoRunner({
      probe: async () => ({
        durationSec: 1,
        width: 2,
        height: 1,
        fps: 1,
        videoCodec: 'h264',
        audioCodec: 'aac',
        bitrate: 1000,
        hasAudio: true,
        fileSize: 6,
      }),
      resolveBins: async () => ({ ffmpeg: '/managed/ffmpeg', ffprobe: '/managed/ffprobe' }),
      spawnProcess,
      createFrameProcessor,
      finalizeOutput: vi.fn(async () => undefined),
      removeOutput: vi.fn(async () => undefined),
      ensureOutputDir: vi.fn(async () => undefined),
    })
    const encoded: Buffer[] = []
    encoder.stdin.on('data', (chunk) => encoded.push(Buffer.from(chunk)))
    encoder.stdin.on('finish', () => encoder.emit('close', 0))
    const pending = runner.run({
      inputPath: '/canvas/source.mp4',
      outputPath: '/canvas/depth.mp4',
      modelDir: '/managed/depth-model',
      runtimeEntryPath: '/managed/depth-runtime/transformers.js',
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    decoder.stdout.write(Buffer.from([0, 0]))
    decoder.stdout.end(Buffer.from([0, 0, 0, 0]))
    decoder.emit('close', 0)

    const result = await pending

    expect(Buffer.concat(encoded)).toEqual(Buffer.from([0, 255]))
    expect(frameProcessor.process).toHaveBeenCalledTimes(1)
    expect(createFrameProcessor).toHaveBeenCalledWith(
      '/managed/depth-model',
      '/managed/depth-runtime/transformers.js',
      {
        invert: false,
        colormap: 'none',
        smoothStrength: 0.25,
        contrast: 2,
      },
    )
    expect(frameProcessor.dispose).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ width: 2, height: 1, fps: 1, durationSec: 1 })
  })

  it('passes normalized render options to the frame processor and switches the encoder input format', async () => {
    const decoder = new FakeProcess()
    const encoder = new FakeProcess()
    const spawnProcess = vi.fn().mockReturnValueOnce(decoder).mockReturnValueOnce(encoder)
    const frameProcessor = {
      process: vi.fn(async () => new Uint8Array(6)),
      dispose: vi.fn(async () => undefined),
    }
    const createFrameProcessor = vi.fn(() => frameProcessor)
    const runner = new DepthVideoRunner({
      probe: async () => ({
        durationSec: 1,
        width: 2,
        height: 1,
        fps: 1,
        videoCodec: 'h264',
        audioCodec: null,
        bitrate: 1000,
        hasAudio: false,
        fileSize: 6,
      }),
      resolveBins: async () => ({ ffmpeg: '/managed/ffmpeg', ffprobe: '/managed/ffprobe' }),
      spawnProcess,
      createFrameProcessor,
      finalizeOutput: vi.fn(async () => undefined),
      removeOutput: vi.fn(async () => undefined),
      ensureOutputDir: vi.fn(async () => undefined),
    })
    encoder.stdin.on('finish', () => encoder.emit('close', 0))
    const pending = runner.run({
      inputPath: '/canvas/source.mp4',
      outputPath: '/canvas/depth.mp4',
      modelDir: '/managed/depth-model',
      runtimeEntryPath: '/managed/depth-runtime/transformers.js',
      renderOptions: { invert: true, colormap: 'turbo', smoothStrength: 0.8, contrast: 6 },
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    expect(spawnProcess.mock.calls[1]![1]).toContain('rgb24')
    expect(spawnProcess.mock.calls[1]![1]).not.toContain('gray')
    decoder.stdout.write(Buffer.alloc(6))
    decoder.stdout.end()
    decoder.emit('close', 0)

    await pending

    expect(createFrameProcessor).toHaveBeenCalledWith(
      '/managed/depth-model',
      '/managed/depth-runtime/transformers.js',
      { invert: true, colormap: 'turbo', smoothStrength: 0.8, contrast: 6 },
    )
  })

  it('kills decoder and encoder when cancelled', async () => {
    const decoder = new FakeProcess()
    const encoder = new FakeProcess()
    const removeOutput = vi.fn(async () => undefined)
    const spawnProcess = vi.fn().mockReturnValueOnce(decoder).mockReturnValueOnce(encoder)
    const runner = new DepthVideoRunner({
      probe: async () => ({
        durationSec: 10,
        width: 2,
        height: 1,
        fps: 1,
        videoCodec: 'h264',
        audioCodec: null,
        bitrate: 1000,
        hasAudio: false,
        fileSize: 6,
      }),
      resolveBins: async () => ({ ffmpeg: '/managed/ffmpeg', ffprobe: '/managed/ffprobe' }),
      spawnProcess,
      createFrameProcessor: () => ({
        process: vi.fn(),
        dispose: vi.fn(async () => undefined),
      }),
      finalizeOutput: vi.fn(async () => undefined),
      removeOutput,
      ensureOutputDir: vi.fn(async () => undefined),
    })
    const controller = new AbortController()
    const pending = runner.run({
      inputPath: '/canvas/source.mp4',
      outputPath: '/canvas/depth.mp4',
      modelDir: '/managed/depth-model',
      runtimeEntryPath: '/managed/depth-runtime/transformers.js',
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    controller.abort()

    await expect(pending).rejects.toThrow('cancelled')
    expect(decoder.kill).toHaveBeenCalled()
    expect(encoder.kill).toHaveBeenCalled()
    expect(removeOutput).toHaveBeenCalled()
  })

  it('converts encoder stdin stream errors into a task failure instead of an unhandled error', async () => {
    const decoder = new FakeProcess()
    const encoder = new FakeProcess()
    const removeOutput = vi.fn(async () => undefined)
    const spawnProcess = vi.fn().mockReturnValueOnce(decoder).mockReturnValueOnce(encoder)
    const runner = new DepthVideoRunner({
      probe: async () => ({
        durationSec: 1,
        width: 2,
        height: 1,
        fps: 1,
        videoCodec: 'h264',
        audioCodec: null,
        bitrate: 1000,
        hasAudio: false,
        fileSize: 6,
      }),
      resolveBins: async () => ({ ffmpeg: '/managed/ffmpeg', ffprobe: '/managed/ffprobe' }),
      spawnProcess,
      createFrameProcessor: () => ({
        process: vi.fn(async () => new Uint8Array([0, 255])),
        dispose: vi.fn(async () => undefined),
      }),
      finalizeOutput: vi.fn(async () => undefined),
      removeOutput,
      ensureOutputDir: vi.fn(async () => undefined),
    })
    const pending = runner.run({
      inputPath: '/canvas/source.mp4',
      outputPath: '/canvas/depth.mp4',
      modelDir: '/managed/depth-model',
      runtimeEntryPath: '/managed/depth-runtime/transformers.js',
    })

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    // 模拟真实取消竞态：编码进程已被杀、父进程侧 stdin 尚未感知，
    // EPIPE 由 libuv 异步上报（无监听器时会成为 uncaughtException）。
    encoder.stdin.emit('error', new Error('write EPIPE'))
    decoder.stdout.write(Buffer.alloc(6))
    decoder.stdout.end()
    decoder.emit('close', 0)

    await expect(pending).rejects.toThrow('视频编码输入流已中断')
    expect(removeOutput).toHaveBeenCalled()
  })
})
