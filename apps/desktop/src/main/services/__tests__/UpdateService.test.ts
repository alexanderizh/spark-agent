import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const appListeners = new Map<string, Listener>()
  const powerListeners = new Map<string, Listener>()
  const state = { userDataPath: '' }
  return {
    state,
    appListeners,
    powerListeners,
    app: {
      isPackaged: false,
      getVersion: vi.fn(() => '0.5.1'),
      getPath: vi.fn(() => state.userDataPath),
      on: vi.fn((event: string, listener: Listener) => {
        appListeners.set(event, listener)
      }),
      removeListener: vi.fn((event: string) => {
        appListeners.delete(event)
      }),
      quit: vi.fn(),
    },
    powerMonitor: {
      on: vi.fn((event: string, listener: Listener) => {
        powerListeners.set(event, listener)
      }),
      removeListener: vi.fn((event: string) => {
        powerListeners.delete(event)
      }),
    },
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  powerMonitor: mocks.powerMonitor,
}))

import { UpdateService } from '../UpdateService.js'

const THIRTY_MINUTES_MS = 30 * 60 * 1000

function versionResponse(version: string = '0.5.1'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      code: 0,
      data: {
        version,
        channel: 'stable',
        platform: process.platform === 'win32' ? 'win' : 'mac',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        fileName: process.platform === 'win32' ? `SparkWork-${version}.exe` : `SparkWork-${version}.dmg`,
        fileSize: 1024,
        publicUrl: `https://example.test/SparkWork-${version}`,
        releaseNotes: null,
        publishedAt: '2026-07-16T00:00:00.000Z',
      },
    }),
  } as unknown as Response
}

describe('UpdateService automatic checks', () => {
  let service: UpdateService | null = null
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'))
    vi.clearAllMocks()
    mocks.appListeners.clear()
    mocks.powerListeners.clear()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.state.userDataPath = mkdtempSync(join(tmpdir(), 'spark-agent-update-test-'))
  })

  afterEach(() => {
    service?.destroy()
    service = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    rmSync(mocks.state.userDataPath, { recursive: true, force: true })
  })

  it('checks on startup and continues every 30 minutes when jitter is neutral', async () => {
    fetchMock.mockImplementation(async () => versionResponse())
    service = new UpdateService()
    service.initialize({ preferences: { autoCheck: true } })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps automatic failures silent and backs off before retrying', async () => {
    const onUpdateError = vi.fn()
    fetchMock.mockRejectedValue(new Error('network unavailable'))
    service = new UpdateService()
    service.initialize({
      preferences: { autoCheck: true },
      onUpdateError,
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(service.getStatus().state).toBe('error')
    expect(onUpdateError).not.toHaveBeenCalled()
    // 一次检查会先访问官网版本中心，失败后再回退 GitHub。
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(onUpdateError).not.toHaveBeenCalled()
  })

  it('reports a manual check failure through the user-facing error callback', async () => {
    const onUpdateError = vi.fn()
    fetchMock.mockRejectedValue(new Error('network unavailable'))
    service = new UpdateService()
    service.initialize({
      preferences: { autoCheck: false },
      onUpdateError,
    })

    await service.checkForUpdates('manual')

    expect(onUpdateError).toHaveBeenCalledOnce()
    expect(onUpdateError).toHaveBeenCalledWith(expect.stringContaining('network unavailable'))
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'keeps a download started by an automatic check silent on failure',
    async () => {
      const onUpdateError = vi.fn()
      let resolveAutomaticError: (() => void) | null = null
      const automaticError = new Promise<void>((resolve) => {
        resolveAutomaticError = resolve
      })
      fetchMock
        .mockResolvedValueOnce(versionResponse('0.5.2'))
        .mockRejectedValueOnce(new Error('download unavailable'))
      service = new UpdateService()
      service.initialize({
        preferences: { autoCheck: true, autoDownload: true },
        onUpdateError,
        handler: (status) => {
          if (status.state === 'error') resolveAutomaticError?.()
        },
      })

      await vi.advanceTimersByTimeAsync(5_000)
      await automaticError

      expect(service.getStatus().state).toBe('error')
      expect(onUpdateError).not.toHaveBeenCalled()
    },
  )

  it('checks immediately after resume when the last check is stale', async () => {
    fetchMock.mockImplementation(async () => versionResponse())
    service = new UpdateService()
    service.initialize({ preferences: { autoCheck: true } })

    await vi.advanceTimersByTimeAsync(5_000)
    service.stopAutoCheck()
    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES_MS)
    mocks.powerListeners.get('resume')?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
