import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/spark-user-data' } }))

import { FfmpegCapabilityService, parseFfmpegList } from './FfmpegCapabilityService'

const readyState = {
  ffmpegReady: true,
  ffmpegSource: 'managed' as const,
  ffmpegVersion: '8.1.1',
  ffprobeReady: true,
  binaryPath: '/runtime/ffmpeg',
  ffprobePath: '/runtime/ffprobe',
  lastError: null,
}

describe('FfmpegCapabilityService', () => {
  it('parses filter and encoder tables without matching legend rows', () => {
    expect([
      ...parseFfmpegList(' TSC overlay VV->V Overlay a video source.\n ... scale V->V Scale.', 3),
    ]).toEqual(['overlay', 'scale'])
    expect([
      ...parseFfmpegList(' V..... libx264 H.264 encoder\n A..... aac AAC encoder', 6),
    ]).toEqual(['libx264', 'aac'])
  })

  it('detects known gates and caches concurrent and repeated requests', async () => {
    const runCommand = vi.fn(async (_binaryPath: string, args: string[]) => ({
      stdout: args.includes('-filters')
        ? ' ... overlay VV->V\n ... scale V->V\n ... amix N->A'
        : ' V..... libx264 H.264\n A..... aac AAC',
      stderr: '',
    }))
    const service = new FfmpegCapabilityService({
      detectIntegrity: async () => readyState,
      runCommand,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    })

    const [left, right] = await Promise.all([service.getCapabilities(), service.getCapabilities()])
    expect(left).toEqual(right)
    expect(left).toEqual(
      expect.objectContaining({
        available: true,
        source: 'managed',
        version: '8.1.1',
        checkedAt: '2026-08-25T00:00:00.000Z',
      }),
    )
    expect(left.filters).toEqual(
      expect.objectContaining({ overlay: true, scale: true, crop: false }),
    )
    expect(left.encoders).toEqual(
      expect.objectContaining({ libx264: true, aac: true, libx265: false }),
    )
    expect(runCommand).toHaveBeenCalledTimes(2)

    await service.getCapabilities()
    expect(runCommand).toHaveBeenCalledTimes(2)
    await service.getCapabilities({ refresh: true })
    expect(runCommand).toHaveBeenCalledTimes(4)
  })

  it('returns explicit unavailable gates without starting a process', async () => {
    const runCommand = vi.fn()
    const service = new FfmpegCapabilityService({
      detectIntegrity: async () => ({
        ...readyState,
        ffmpegReady: false,
        ffmpegSource: 'none',
        ffmpegVersion: null,
        binaryPath: null,
        ffprobeReady: false,
        ffprobePath: null,
      }),
      runCommand,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    })
    const result = await service.getCapabilities()
    expect(result.available).toBe(false)
    expect(result.filters.overlay).toBe(false)
    expect(result.encoders.libx264).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
  })
})
