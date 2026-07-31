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
  it('uses the FFmpeg 8 frame sync option for raw-video decoding', () => {
    const args = buildDepthVideoDecoderArgs('/tmp/source.mp4', 24)
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
      createFrameProcessor: () => frameProcessor,
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
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    decoder.stdout.write(Buffer.from([0, 0]))
    decoder.stdout.end(Buffer.from([0, 0, 0, 0]))
    decoder.emit('close', 0)

    const result = await pending

    expect(Buffer.concat(encoded)).toEqual(Buffer.from([0, 255]))
    expect(frameProcessor.process).toHaveBeenCalledTimes(1)
    expect(frameProcessor.dispose).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ width: 2, height: 1, fps: 1, durationSec: 1 })
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
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
    controller.abort()

    await expect(pending).rejects.toThrow('cancelled')
    expect(decoder.kill).toHaveBeenCalled()
    expect(encoder.kill).toHaveBeenCalled()
    expect(removeOutput).toHaveBeenCalled()
  })
})
