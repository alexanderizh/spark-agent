import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paths: {
    userData: '',
    temp: '',
  },
  transcodeVideo: vi.fn(),
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
  cropVideo: vi.fn(),
  addWatermark: vi.fn(),
  burnSubtitle: vi.fn(),
}))

import { handleVideoProcess } from '../videoProcessHandler.js'

let testRoot = ''

afterEach(() => {
  if (testRoot) rmSync(testRoot, { recursive: true, force: true })
  testRoot = ''
  mocks.transcodeVideo.mockReset()
})

describe('handleVideoProcess', () => {
  it('creates the artifact parent and accepts Windows path casing differences', async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'spark-video-handler-'))
    mocks.paths.userData = join(testRoot, 'user-data')
    mocks.paths.temp = join(testRoot, 'temp')
    mkdirSync(mocks.paths.userData, { recursive: true })
    mkdirSync(mocks.paths.temp, { recursive: true })

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
})
