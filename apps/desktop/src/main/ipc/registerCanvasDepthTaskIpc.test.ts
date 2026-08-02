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
    let progressListener: ((progress: any) => void) | undefined
    const capabilityManager = {
      list: vi.fn(async () => ({
        capabilities: [
          {
            id: 'local-depth',
            state: 'missing',
            installedVersion: null,
            targetVersion: '4.2.0-1.24.3-1+1.0.0',
          },
        ],
      })),
      install: vi.fn(async () => {
        progressListener?.({
          capabilityId: 'local-depth',
          percent: 50,
          message: '正在下载 Runtime',
        })
        return { success: true, message: 'ok', snapshot: { capabilities: [] } }
      }),
      subscribeProgress: vi.fn((listener: (progress: any) => void) => {
        progressListener = listener
        return () => {
          progressListener = undefined
        }
      }),
      getArtifactDirectory: vi.fn(async (_id: string, prefix: string) =>
        prefix.startsWith('runtime.') ? '/managed/runtime' : '/managed/model',
      ),
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
      capabilityManager: capabilityManager as never,
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
      installing_model: '资源下载中：正在安装本地深度 Runtime 与模型',
      decoding: '任务执行中：正在解析输入视频',
      estimating_depth: '任务执行中：正在逐帧生成深度',
      encoding: '任务执行中：正在编码深度视频',
    })
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        modelDir: '/managed/model',
        runtimeEntryPath:
          '/managed/runtime/node_modules/@huggingface/transformers/src/transformers.js',
      }),
    )
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
      capabilityManager: {
        list: vi.fn(),
        install: vi.fn(),
        subscribeProgress: vi.fn(),
        getArtifactDirectory: vi.fn(),
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
      capabilityManager: {
        list: vi.fn(),
        install: vi.fn(),
        subscribeProgress: vi.fn(),
        getArtifactDirectory: vi.fn(),
      } as never,
    })

    expect(harness.beforeQuit).toBeTypeOf('function')
  })

  it('reports an integrity error when install succeeds without an installed version', async () => {
    registerCanvasDepthTaskIpc({
      capabilityManager: {
        list: vi.fn(),
        install: vi.fn(async () => ({
          success: true,
          message: 'ok',
          snapshot: {
            capabilities: [{ id: 'local-depth', state: 'missing', installedVersion: null }],
          },
        })),
        subscribeProgress: vi.fn(),
        getArtifactDirectory: vi.fn(),
      } as never,
    })

    await expect(harness.handlers.get('canvas:depth-model:install')!({})).resolves.toEqual({
      state: 'error',
      error: '本地深度组件安装结果缺少已安装版本，请在完整性页修复后重试',
    })
  })

  it('returns a clear failed task when the managed depth capability cannot be installed', async () => {
    registerCanvasDepthTaskIpc({
      capabilityManager: {
        list: vi.fn(async () => ({
          capabilities: [{ id: 'local-depth', state: 'missing', installedVersion: null }],
        })),
        install: vi.fn(async () => ({
          success: false,
          message: '本地深度处理安装失败：当前平台暂无可用制品',
          snapshot: { capabilities: [] },
        })),
        subscribeProgress: vi.fn(() => () => undefined),
        getArtifactDirectory: vi.fn(),
      } as never,
      createRuntimeTaskId: () => 'depth-runtime-missing',
      createOutputPath: () => '/tmp/depth-output.mp4',
    })

    await harness.handlers.get('canvas:task:create-depth-video')!({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      inputPath: '/canvas/input.mp4',
    })

    await vi.waitFor(() =>
      expect(
        harness.events.some(
          (event) =>
            event.payload.response.status === 'failed' &&
            event.payload.response.error.message.includes('当前平台暂无可用制品'),
        ),
      ).toBe(true),
    )
  })

  it('marks the capability damaged when the installed native runtime cannot be loaded', async () => {
    const reportRuntimeFailure = vi.fn(async () => ({ capabilities: [] }))
    registerCanvasDepthTaskIpc({
      capabilityManager: {
        list: vi.fn(async () => ({
          capabilities: [
            { id: 'local-depth', state: 'ready', installedVersion: '4.2.0-1.24.3-1+1.0.0' },
          ],
        })),
        install: vi.fn(),
        repair: vi.fn(),
        subscribeProgress: vi.fn(() => () => undefined),
        getArtifactDirectory: vi.fn(async (_id: string, prefix: string) =>
          prefix.startsWith('runtime.') ? '/managed/runtime' : '/managed/model',
        ),
        reportRuntimeFailure,
      } as never,
      createRunner: () => ({
        run: vi.fn(async () => {
          throw new Error('dlopen onnxruntime_binding.node: code signature rejected')
        }),
      }),
      createRuntimeTaskId: () => 'depth-runtime-invalid',
      createOutputPath: () => '/tmp/depth-output.mp4',
    })

    await harness.handlers.get('canvas:task:create-depth-video')!({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      inputPath: '/canvas/input.mp4',
    })

    await vi.waitFor(() =>
      expect(reportRuntimeFailure).toHaveBeenCalledWith(
        'local-depth',
        expect.objectContaining({ message: expect.stringContaining('dlopen') }),
      ),
    )
  })

  it('cancels only the task wait without cancelling a shared capability install', async () => {
    let resolveInstall!: (value: any) => void
    let markInstallStarted!: () => void
    const installStarted = new Promise<void>((resolve) => {
      markInstallStarted = resolve
    })
    const installResult = new Promise<any>((resolve) => {
      resolveInstall = resolve
    })
    const cancelCapability = vi.fn(async () => ({ success: true }))
    registerCanvasDepthTaskIpc({
      capabilityManager: {
        list: vi.fn(async () => ({
          capabilities: [{ id: 'local-depth', state: 'missing', installedVersion: null }],
        })),
        install: vi.fn(() => {
          markInstallStarted()
          return installResult
        }),
        repair: vi.fn(),
        cancel: cancelCapability,
        subscribeProgress: vi.fn(() => () => undefined),
        getArtifactDirectory: vi.fn(),
      } as never,
      createRuntimeTaskId: () => 'depth-runtime-cancelled',
      createOutputPath: () => '/tmp/depth-output.mp4',
    })

    await harness.handlers.get('canvas:task:create-depth-video')!({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      inputPath: '/canvas/input.mp4',
    })
    await installStarted
    await harness.handlers.get('canvas:task:cancel-depth-video')!({
      runtimeTaskId: 'depth-runtime-cancelled',
    })
    resolveInstall({ success: true, message: 'ok', snapshot: { capabilities: [] } })

    await vi.waitFor(() =>
      expect(
        harness.events.some(
          (event) =>
            event.payload.response.runtimeTaskId === 'depth-runtime-cancelled' &&
            event.payload.response.status === 'cancelled',
        ),
      ).toBe(true),
    )
    expect(cancelCapability).not.toHaveBeenCalled()
  })
})
