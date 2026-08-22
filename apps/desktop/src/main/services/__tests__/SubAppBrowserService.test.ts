import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn(), getPath: vi.fn(() => '/tmp/spark-sub-app-browser-test') },
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn() },
}))

import { SubAppBrowserService } from '../SubAppBrowserService.js'
import { SystemBrowserError } from '../SystemBrowserService.js'

function meta(windowId: string) {
  return {
    windowId,
    profileId: 'video-downloader-main',
    visible: true,
    url: 'https://example.com',
    title: null,
    injectedScriptCount: 0,
    networkRuleCount: 0,
    consoleEventCount: 0,
  }
}

describe('SubAppBrowserService', () => {
  it('prefers the system browser and falls back to the embedded browser when launch is unavailable', async () => {
    const system = {
      openWindow: vi
        .fn()
        .mockRejectedValue(
          new SystemBrowserError('SYSTEM_BROWSER_UNAVAILABLE', '未检测到本机 Chrome 或 Edge。'),
        ),
      inspectMedia: vi.fn(),
      downloadMedia: vi.fn(),
      closeWindow: vi.fn(),
    }
    const internal = {
      openWindow: vi.fn().mockResolvedValue(meta('browser-1')),
      inspectMedia: vi.fn().mockResolvedValue({ pageUrl: null, title: null, candidates: [] }),
      downloadMedia: vi.fn(),
      closeWindow: vi.fn().mockReturnValue({ ok: true }),
    }
    const service = new SubAppBrowserService(internal, system)

    const opened = await service.openWindow({ url: 'https://example.com', backend: 'auto' })
    expect(opened).toMatchObject({ windowId: 'browser-1', backend: 'internal' })
    expect(system.openWindow).toHaveBeenCalledOnce()
    expect(internal.openWindow).toHaveBeenCalledOnce()

    await service.inspectMedia('browser-1')
    expect(internal.inspectMedia).toHaveBeenCalledWith('browser-1')
  })
})
