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
  probeVideo: vi.fn(),
  extractKeyframes: vi.fn(),
  extractFramesAtTimes: vi.fn(),
  generateThumbnail: vi.fn(),
  trimVideo: vi.fn(),
  concatVideos: vi.fn(),
  segmentVideo: vi.fn(),
  transcodeVideo: mocks.transcodeVideo,
  adjustSpeed: vi.fn(),
  reverseVideo: vi.fn(),
  cropVideo: mocks.cropVideo,
  addWatermark: vi.fn(),
  burnSubtitle: vi.fn(),
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
})

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('handleVideoProcess', () => {
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
})
