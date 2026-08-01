import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { CanvasMediaTaskCreateResponse, CanvasMediaTaskStreamPayload } from '@spark/protocol'
import {
  DepthModelIntegrityService,
  DEPTH_MODEL_PACKAGE_ID,
} from '../services/DepthModelIntegrityService.js'
import {
  DepthVideoRunner,
  type DepthVideoProgress,
} from '../services/depth-video/DepthVideoRunner.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

type IntegrityService = Pick<DepthModelIntegrityService, 'inspect' | 'install'>
type Runner = Pick<DepthVideoRunner, 'run'>
type DepthTaskResponse = CanvasMediaTaskCreateResponse & {
  status: NonNullable<CanvasMediaTaskCreateResponse['status']>
}

export type RegisterCanvasDepthTaskIpcOptions = {
  integrityService?: IntegrityService
  createRunner?: () => Runner
  createRuntimeTaskId?: () => string
  createOutputPath?: (runtimeTaskId: string) => string
}

export function registerCanvasDepthTaskIpc(options: RegisterCanvasDepthTaskIpcOptions = {}): void {
  const integrityService =
    options.integrityService ??
    new DepthModelIntegrityService({ userDataDir: app.getPath('userData') })
  const createRunner = options.createRunner ?? (() => new DepthVideoRunner())
  const createRuntimeTaskId = options.createRuntimeTaskId ?? (() => `depth-${randomUUID()}`)
  const createOutputPath =
    options.createOutputPath ??
    ((runtimeTaskId: string) =>
      join(
        app.getPath('userData'),
        '.spark-artifacts',
        'media',
        'canvas-depth',
        `${runtimeTaskId}.mp4`,
      ))
  const runningTasks = new Map<string, AbortController>()
  app.once('before-quit', () => {
    for (const controller of runningTasks.values()) controller.abort()
    runningTasks.clear()
  })

  typedIpcHandle('canvas:depth-model:status', async () => {
    const state = await integrityService.inspect()
    if (state.state === 'ready') return { state: 'ready' as const, version: state.version }
    if (state.state === 'error') return { state: 'error' as const, error: state.error }
    return { state: 'missing' as const }
  })

  typedIpcHandle('canvas:depth-model:install', async () => {
    try {
      const state = await integrityService.install()
      return { state: 'ready' as const, version: state.version }
    } catch (error) {
      return {
        state: 'error' as const,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  typedIpcHandle('canvas:task:create-depth-video', async (request) => {
    assertAllowedInputPath(request.inputPath)
    if (runningTasks.size >= 1) {
      throw new Error('已有深度视频任务正在运行，请等待完成或先取消当前任务')
    }
    const runtimeTaskId = createRuntimeTaskId()
    const outputPath = createOutputPath(runtimeTaskId)
    const controller = new AbortController()
    runningTasks.set(runtimeTaskId, controller)

    const pushResponse = (response: DepthTaskResponse) => {
      const payload: CanvasMediaTaskStreamPayload = {
        projectId: request.projectId,
        clientTaskId: request.clientTaskId,
        runtimeTaskId,
        status: response.status,
        response,
      }
      pushStreamEvent('stream:canvas:media-task', payload)
    }

    void (async () => {
      try {
        const model = await integrityService.install((downloaded, total) => {
          if (controller.signal.aborted) return
          pushResponse(
            runningResponse(runtimeTaskId, {
              stage: 'installing_model',
              progress: total > 0 ? Math.round((downloaded / total) * 20) : 5,
              message: '资源下载中：正在下载本地深度模型',
            }),
          )
        })
        if (controller.signal.aborted) throw new Error('cancelled')
        let lastStage = ''
        let lastProgress = -1
        const result = await createRunner().run({
          inputPath: request.inputPath,
          outputPath,
          modelDir: model.modelDir,
          signal: controller.signal,
          onProgress: (progress: DepthVideoProgress) => {
            const mappedProgress = 20 + Math.round(progress.percent * 0.8)
            if (progress.stage === lastStage && mappedProgress - lastProgress < 2) return
            lastStage = progress.stage
            lastProgress = mappedProgress
            pushResponse(
              runningResponse(runtimeTaskId, {
                stage: progress.stage,
                progress: mappedProgress,
                message: depthStageMessage(progress.stage),
              }),
            )
          },
        })
        pushResponse({
          runtimeTaskId,
          requestId: runtimeTaskId,
          status: 'succeeded',
          providerProfileId: '',
          provider: 'local_depth',
          model: DEPTH_MODEL_PACKAGE_ID,
          mode: 'async',
          progress: 100,
          stage: 'completed',
          message: '深度视频已生成',
          assets: [
            {
              type: 'video',
              filePath: result.path,
              mimeType: 'video/mp4',
              width: result.width,
              height: result.height,
              durationMs: Math.round(result.durationSec * 1000),
            },
          ],
        })
      } catch (error) {
        const cancelled =
          controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')
        pushResponse({
          runtimeTaskId,
          requestId: runtimeTaskId,
          status: cancelled ? 'cancelled' : 'failed',
          providerProfileId: '',
          provider: 'local_depth',
          model: DEPTH_MODEL_PACKAGE_ID,
          mode: 'async',
          progress: 100,
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? '深度视频任务已取消' : '深度视频生成失败',
          assets: [],
          error: {
            code: cancelled ? 'cancelled' : 'local_depth_failed',
            message: cancelled
              ? '任务已取消'
              : error instanceof Error
                ? error.message
                : String(error),
          },
        })
      } finally {
        runningTasks.delete(runtimeTaskId)
      }
    })()

    return runningResponse(runtimeTaskId, {
      stage: 'queued',
      progress: 0,
      message: '本地深度任务已创建',
    })
  })

  typedIpcHandle('canvas:task:cancel-depth-video', async (request) => {
    const controller = runningTasks.get(request.runtimeTaskId)
    controller?.abort()
    return { cancelled: controller != null }
  })
}

function runningResponse(
  runtimeTaskId: string,
  progress: { stage: string; progress: number; message: string },
): DepthTaskResponse {
  return {
    runtimeTaskId,
    requestId: runtimeTaskId,
    status: 'running',
    providerProfileId: '',
    provider: 'local_depth',
    model: DEPTH_MODEL_PACKAGE_ID,
    mode: 'async',
    assets: [],
    ...progress,
  }
}

function depthStageMessage(stage: DepthVideoProgress['stage']): string {
  if (stage === 'decoding') return '任务执行中：正在解析输入视频'
  if (stage === 'encoding') return '任务执行中：正在编码深度视频'
  return '任务执行中：正在逐帧生成深度'
}

function assertAllowedInputPath(inputPath: string): void {
  if (!isSafeFilePathAllowed(inputPath)) {
    throw new Error('深度视频输入路径不在允许的画布或工作区目录内')
  }
}
