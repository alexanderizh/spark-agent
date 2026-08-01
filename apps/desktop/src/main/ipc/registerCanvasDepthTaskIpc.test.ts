import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
  events: [] as Array<{ channel: string; payload: any }>,
  inputPathAllowed: true,
  beforeQuit: undefined as (() => void) | undefined,
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
  pushStreamEvent: (channel: string, payload: any) => harness.events.push({ channel, payload }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/spark-user-data',
    once: (event: string, callback: () => void) => {
      if (event === 'before-quit') harness.beforeQuit = callback
    },
  },
}))

vi.mock('../services/SafeFileProtocol.js', () => ({
  isSafeFilePathAllowed: () => harness.inputPathAllowed,
}))

import { registerCanvasDepthTaskIpc } from './registerCanvasDepthTaskIpc.js'

describe('registerCanvasDepthTaskIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.events.length = 0
    harness.inputPathAllowed = true
    harness.beforeQuit = undefined
  })

  it('installs the model, runs local depth inference, and streams a media result', async () => {
    const integrityService = {
      inspect: vi.fn(async () => ({ state: 'missing', modelDir: '/managed/depth' })),
      install: vi.fn(async (onProgress?: (downloaded: number, total: number) => void) => {
        onProgress?.(50, 100)
        return { state: 'ready', version: '1.0.0', modelDir: '/managed/depth' }
      }),
    }
    const runner = {
      run: vi.fn(async (request: any) => {
        request.onProgress?.({
          stage: 'decoding',
          percent: 5,
          frame: 0,
          totalFrames: 10,
        })
        request.onProgress?.({
          stage: 'estimating_depth',
          percent: 60,
          frame: 6,
          totalFrames: 10,
        })
        request.onProgress?.({
          stage: 'encoding',
          percent: 100,
          frame: 10,
          totalFrames: 10,
        })
        return {
          path: '/tmp/depth-output.mp4',
          width: 1280,
          height: 720,
          fps: 25,
          durationSec: 4,
          frameCount: 100,
        }
      }),
    }
    registerCanvasDepthTaskIpc({
      integrityService: integrityService as never,
      createRunner: () => runner as never,
      createRuntimeTaskId: () => 'depth-runtime-1',
      createOutputPath: () => '/tmp/depth-output.mp4',
    })

    const response = await harness.handlers.get('canvas:task:create-depth-video')!({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      inputPath: '/canvas/input.mp4',
    })

    expect(response).toMatchObject({ status: 'running', runtimeTaskId: 'depth-runtime-1' })
    await vi.waitFor(() =>
      expect(
        harness.events.some(
          (event) =>
            event.channel === 'stream:canvas:media-task' &&
            event.payload.response.status === 'succeeded',
        ),
      ).toBe(true),
    )
    const runningStages = harness.events
      .filter((event) => event.payload.response.status === 'running')
      .map((event) => event.payload.response.stage)
    expect(runningStages).toEqual(
      expect.arrayContaining(['installing_model', 'decoding', 'estimating_depth', 'encoding']),
    )
    const runningMessages = Object.fromEntries(
      harness.events
        .filter((event) => event.payload.response.status === 'running')
        .map((event) => [event.payload.response.stage, event.payload.response.message]),
    )
    expect(runningMessages).toMatchObject({
      installing_model: '资源下载中：正在下载本地深度模型',
      decoding: '任务执行中：正在解析输入视频',
      estimating_depth: '任务执行中：正在逐帧生成深度',
      encoding: '任务执行中：正在编码深度视频',
    })
    const success = harness.events.find((event) => event.payload.response.status === 'succeeded')!
    expect(success.payload.response.assets).toEqual([
      expect.objectContaining({
        type: 'video',
        filePath: '/tmp/depth-output.mp4',
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationMs: 4000,
      }),
    ])
  })

  it('rejects input paths outside the canonical safe-file roots', async () => {
    harness.inputPathAllowed = false
    registerCanvasDepthTaskIpc({
      integrityService: {
        inspect: vi.fn(),
        install: vi.fn(),
      } as never,
    })

    await expect(
      harness.handlers.get('canvas:task:create-depth-video')!({
        projectId: 'project-1',
        clientTaskId: 'canvas-task-1',
        inputPath: '/canvas/link-to-private-video.mp4',
      }),
    ).rejects.toThrow('不在允许的画布或工作区目录内')
  })

  it('registers cleanup for application shutdown', () => {
    registerCanvasDepthTaskIpc({
      integrityService: { inspect: vi.fn(), install: vi.fn() } as never,
    })

    expect(harness.beforeQuit).toBeTypeOf('function')
  })
})
