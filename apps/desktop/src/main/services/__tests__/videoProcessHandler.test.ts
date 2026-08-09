import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paths: {
    userData: '',
    temp: '',
  },
  transcodeVideo: vi.fn(),
  cropVideo: vi.fn(),
  trimVideo: vi.fn(),
  trimAudio: vi.fn(),
  adjustSpeed: vi.fn(),
  adjustAudioSpeed: vi.fn(),
  extractAudio: vi.fn(),
  extractKeyframes: vi.fn(),
  probeVideo: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mocks.paths.userData
      if (name === 'temp') return mocks.paths.temp
      return ''
    },
  },
}))

vi.mock('@spark/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../SafeFileProtocol.js', () => ({
  getSafeFileAllowedRoots: () => [mocks.paths.userData, mocks.paths.temp],
}))

vi.mock('../FfmpegRunner.js', () => ({
  ensureOutputDirectory: (outputPath: string) => {
    mkdirSync(dirname(outputPath), { recursive: true })
  },
  probeVideo: mocks.probeVideo,
  extractKeyframes: mocks.extractKeyframes,
  extractFramesAtTimes: vi.fn(),
  generateThumbnail: vi.fn(),
  trimVideo: mocks.trimVideo,
  trimAudio: mocks.trimAudio,
  concatVideos: vi.fn(),
  segmentVideo: vi.fn(),
  transcodeVideo: mocks.transcodeVideo,
  adjustSpeed: mocks.adjustSpeed,
  adjustAudioSpeed: mocks.adjustAudioSpeed,
  reverseVideo: vi.fn(),
  cropVideo: mocks.cropVideo,
  addWatermark: vi.fn(),
  burnSubtitle: vi.fn(),
  extractAudio: mocks.extractAudio,
  audioExtForCodec: (codec: string | null) => {
    if (codec === 'aac') return 'm4a'
    if (codec === 'mp3') return 'mp3'
    return 'mka'
  },
}))

import { handleVideoProcess } from '../videoProcessHandler.js'

const testRoot = mkdtempSync(join(tmpdir(), 'spark-video-handler-'))
mocks.paths.userData = join(testRoot, 'user-data')
mocks.paths.temp = join(testRoot, 'temp')
mkdirSync(mocks.paths.userData, { recursive: true })
mkdirSync(mocks.paths.temp, { recursive: true })

afterEach(() => {
  mocks.transcodeVideo.mockReset()
  mocks.cropVideo.mockReset()
  mocks.trimVideo.mockReset()
  mocks.trimAudio.mockReset()
  mocks.adjustSpeed.mockReset()
  mocks.adjustAudioSpeed.mockReset()
  mocks.extractAudio.mockReset()
  mocks.extractKeyframes.mockReset()
  mocks.probeVideo.mockReset()
})

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('handleVideoProcess', () => {
  it('enforces a 0.2 second minimum for uniform keyframe sampling', async () => {
    const input = join(mocks.paths.userData, 'source.mp4')

    const rejected = await handleVideoProcess({
      operation: 'extractKeyframes',
      input,
      params: { strategy: 'uniform', intervalSec: 0.1 },
      requestId: 'uniform-too-fast',
    })

    expect(rejected.success).toBe(false)
    expect(rejected.error).toContain('参数 intervalSec 超出允许范围 [0.2, 3600]: 0.1')
    expect(mocks.extractKeyframes).not.toHaveBeenCalled()

    mocks.extractKeyframes.mockResolvedValue({ frames: [], effectiveStrategy: 'uniform' })
    const accepted = await handleVideoProcess({
      operation: 'extractKeyframes',
      input,
      params: { strategy: 'uniform', intervalSec: 0.2 },
      requestId: 'uniform-minimum',
    })

    expect(accepted.success).toBe(true)
    expect(mocks.extractKeyframes).toHaveBeenCalledOnce()
    expect(mocks.extractKeyframes.mock.calls[0]?.[1]).toMatchObject({ intervalSec: 0.2 })
  })

  it('creates the artifact parent and accepts Windows path casing differences', async () => {
    mocks.transcodeVideo.mockImplementation(async (_input: string, outputPath: string) => {
      expect(existsSync(dirname(outputPath))).toBe(true)
      return { path: outputPath }
    })

    const inputRoot =
      process.platform === 'win32' ? mocks.paths.userData.toUpperCase() : mocks.paths.userData
    const response = await handleVideoProcess({
      operation: 'transcode',
      input: join(inputRoot, 'source.mp4'),
      params: { format: 'mp4' },
      requestId: 'test-request',
    })

    expect(response.success).toBe(true)
    expect(mocks.transcodeVideo).toHaveBeenCalledOnce()
  })

  it('rejects negative crop coordinates before invoking ffmpeg', async () => {
    const response = await handleVideoProcess({
      operation: 'crop',
      input: join(mocks.paths.userData, 'source.mp4'),
      params: { w: 640, h: 360, x: -1, y: 0 },
      requestId: 'crop-invalid-coordinate',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('crop x')
    expect(mocks.cropVideo).not.toHaveBeenCalled()
  })

  it('forwards extractAudio copy mode with extension derived from the source audio codec', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 10,
      hasAudio: true,
      audioCodec: 'aac',
    })
    mocks.extractAudio.mockImplementation(async (_input: string, outputPath: string) => ({
      path: outputPath,
      mimeType: 'audio/mp4',
      durationMs: 10_000,
      audioCodec: 'aac',
    }))

    const response = await handleVideoProcess({
      operation: 'extractAudio',
      input: join(mocks.paths.userData, 'source.mp4'),
      params: { audioFormat: 'copy' },
      requestId: 'extract-copy',
    })

    expect(response.success).toBe(true)
    expect(mocks.probeVideo).toHaveBeenCalledOnce()
    expect(mocks.extractAudio).toHaveBeenCalledOnce()
    const [, outputPath, opts] = mocks.extractAudio.mock.calls[0] as [
      string,
      string,
      { format: string },
    ]
    expect(opts.format).toBe('copy')
    expect(outputPath).toMatch(/\.m4a$/)
  })

  it('defaults extractAudio to mp3 re-encode without probing', async () => {
    mocks.extractAudio.mockImplementation(async (_input: string, outputPath: string) => ({
      path: outputPath,
      mimeType: 'audio/mpeg',
      durationMs: 10_000,
      audioCodec: 'mp3',
    }))

    const response = await handleVideoProcess({
      operation: 'extractAudio',
      input: join(mocks.paths.userData, 'source.mp4'),
      params: {},
      requestId: 'extract-default',
    })

    expect(response.success).toBe(true)
    expect(mocks.probeVideo).not.toHaveBeenCalled()
    const [, outputPath, opts] = mocks.extractAudio.mock.calls[0] as [
      string,
      string,
      { format: string },
    ]
    expect(opts.format).toBe('mp3')
    expect(outputPath).toMatch(/\.mp3$/)
  })

  it('reports a friendly error when the source video has no audio track', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 10,
      hasAudio: false,
      audioCodec: null,
    })

    const response = await handleVideoProcess({
      operation: 'extractAudio',
      input: join(mocks.paths.userData, 'silent.mp4'),
      params: { audioFormat: 'copy' },
      requestId: 'extract-silent',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('该视频没有音轨，无法分离音频')
    expect(mocks.extractAudio).not.toHaveBeenCalled()
  })

  it('rejects an unknown audio format before invoking ffmpeg', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 10,
      hasAudio: true,
      audioCodec: 'aac',
    })

    const response = await handleVideoProcess({
      operation: 'extractAudio',
      input: join(mocks.paths.userData, 'source.mp4'),
      params: { audioFormat: 'flac' },
      requestId: 'extract-bad-format',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('未知的音频输出格式')
    expect(mocks.extractAudio).not.toHaveBeenCalled()
  })

  // ── kind:'audio' 模式：纯音频截取 / 变速 / 探测 ──────────────────
  it('trims an audio-only file via the kind=audio dispatcher branch', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 27,
      hasAudio: true,
      audioCodec: 'mp3',
    })
    mocks.trimAudio.mockImplementation(async (_input: string, outputPath: string) => ({
      path: outputPath,
      mimeType: 'audio/mpeg',
      durationMs: 9_160,
      audioCodec: 'mp3',
    }))

    const response = await handleVideoProcess({
      kind: 'audio',
      operation: 'trim',
      input: join(mocks.paths.userData, 'song.mp3'),
      params: { startSec: 0, endSec: 9.16 },
      requestId: 'audio-trim',
    })

    expect(response.success).toBe(true)
    expect(mocks.probeVideo).toHaveBeenCalledOnce()
    expect(mocks.trimAudio).toHaveBeenCalledOnce()
    expect(mocks.trimVideo).not.toHaveBeenCalled()
    const [, outputPath, opts] = mocks.trimAudio.mock.calls[0] as [
      string,
      string,
      { startSec: number; endSec: number },
    ]
    expect(opts.startSec).toBe(0)
    expect(opts.endSec).toBe(9.16)
    expect(outputPath).toMatch(/\.mp3$/)
  })

  it('rejects audio trim when endSec exceeds the probed duration', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 27,
      hasAudio: true,
      audioCodec: 'mp3',
    })

    const response = await handleVideoProcess({
      kind: 'audio',
      operation: 'trim',
      input: join(mocks.paths.userData, 'song.mp3'),
      params: { startSec: 5, endSec: 60 },
      requestId: 'audio-trim-overflow',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('超出音频时长')
    expect(mocks.trimAudio).not.toHaveBeenCalled()
  })

  it('adjusts audio speed within the 0.1x–4.0x UI bounds', async () => {
    mocks.probeVideo.mockResolvedValue({
      durationSec: 30,
      hasAudio: true,
      audioCodec: 'aac',
    })
    mocks.adjustAudioSpeed.mockImplementation(async (_input: string, outputPath: string) => ({
      path: outputPath,
      mimeType: 'audio/mp4',
      durationMs: 20_000,
      audioCodec: 'aac',
    }))

    const response = await handleVideoProcess({
      kind: 'audio',
      operation: 'adjustSpeed',
      input: join(mocks.paths.userData, 'song.m4a'),
      params: { factor: 1.5 },
      requestId: 'audio-speed',
    })

    expect(response.success).toBe(true)
    expect(mocks.adjustAudioSpeed).toHaveBeenCalledOnce()
    expect(mocks.adjustSpeed).not.toHaveBeenCalled()
    const [, outputPath, factor, opts] = mocks.adjustAudioSpeed.mock.calls[0] as [
      string,
      string,
      number,
      { audioCodec: string },
    ]
    expect(factor).toBe(1.5)
    expect(opts.audioCodec).toBe('aac')
    expect(outputPath).toMatch(/\.m4a$/)
  })

  it('refuses audio speed outside the 0.1x–4.0x bounds without invoking ffmpeg', async () => {
    const response = await handleVideoProcess({
      kind: 'audio',
      operation: 'adjustSpeed',
      input: join(mocks.paths.userData, 'song.mp3'),
      params: { factor: 5 },
      requestId: 'audio-speed-overflow',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('音频变速 factor=5 超出允许范围')
    expect(mocks.probeVideo).not.toHaveBeenCalled()
    expect(mocks.adjustAudioSpeed).not.toHaveBeenCalled()
  })

  it('refuses video-only operations when kind=audio is set', async () => {
    const response = await handleVideoProcess({
      kind: 'audio',
      operation: 'crop',
      input: join(mocks.paths.userData, 'song.mp3'),
      params: { w: 100, h: 100, x: 0, y: 0 },
      requestId: 'audio-mismatch-crop',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('音频模式不支持该操作')
    expect(mocks.cropVideo).not.toHaveBeenCalled()
  })
})
