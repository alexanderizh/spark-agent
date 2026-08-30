import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'

const testRoot = '/tmp/spark-system-browser-service-test'
const electronMocks = vi.hoisted(() => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn((name: string) =>
      name === 'downloads'
        ? '/tmp/spark-system-browser-service-test/Downloads'
        : '/tmp/spark-system-browser-service-test',
    ),
  },
}))

vi.mock('electron', () => electronMocks)

import { SystemBrowserService } from '../SystemBrowserService.js'

type Listener = (...args: unknown[]) => void

describe('SystemBrowserService', () => {
  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('launches a persistent system Chrome profile, inspects page media, and downloads with the session', async () => {
    mkdirSync(`${testRoot}/Downloads`, { recursive: true })
    const listeners = new Map<string, Listener>()
    const response = {
      allHeaders: vi.fn(async () => ({ 'content-type': 'video/mp4' })),
      url: vi.fn(() => 'https://cdn.example/network.mp4'),
      request: vi.fn(() => ({ resourceType: vi.fn(() => 'media') })),
    }
    const page = {
      on: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      goto: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
      url: vi.fn(() => 'https://www.douyin.com/video/1'),
      title: vi.fn(async () => '测试视频'),
      evaluate: vi.fn(async (script: unknown) =>
        typeof script === 'function'
          ? 'Mozilla/5.0 Chrome/140'
          : {
              pageUrl: 'https://www.douyin.com/video/1',
              title: '测试视频',
              candidates: [
                {
                  value: 'https://cdn.example/video.mp4',
                  source: 'video',
                  visible: true,
                  width: 800,
                  height: 450,
                },
              ],
            },
      ),
    }
    const requestGet = vi.fn(async () => ({
      ok: () => true,
      status: () => 200,
      headers: () => ({ 'content-type': 'video/mp4' }),
      body: async () => Buffer.from('video-data'),
      dispose: vi.fn(async () => undefined),
    }))
    const context = {
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      on: vi.fn(),
      close: vi.fn(async () => undefined),
      request: { get: requestGet },
    }
    const launchPersistentContext = vi.fn(async () => context)
    const service = new SystemBrowserService({
      launchPersistentContext: launchPersistentContext as never,
      getBrowserChannel: () => 'chrome',
      getProfileRoot: () => `${testRoot}/profiles`,
    })

    const opened = await service.openWindow({ url: 'https://www.douyin.com/video/1' })
    expect(opened.windowId).toMatch(/^system-browser-/)
    expect(launchPersistentContext).toHaveBeenCalledWith(
      `${testRoot}/profiles/video-downloader-main`,
      expect.objectContaining({ channel: 'chrome', headless: false, acceptDownloads: true }),
    )

    listeners.get('response')?.(response as never)
    const inspection = await service.inspectMedia(opened.windowId)
    expect(inspection.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://cdn.example/video.mp4',
          source: 'video',
          kind: 'mp4',
        }),
      ]),
    )

    const downloaded = await service.downloadMedia(
      opened.windowId,
      'https://cdn.example/video.mp4',
      '测试视频',
    )
    expect(requestGet).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: 'https://www.douyin.com/video/1' }),
      }),
    )
    expect(downloaded).toMatchObject({ filename: '测试视频.mp4', size: 10 })
    await service.closeWindow(opened.windowId)
    expect(context.close).toHaveBeenCalledOnce()
  })
})
