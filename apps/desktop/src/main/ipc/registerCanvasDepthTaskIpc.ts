import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { createLogger, SparkError } from '@spark/shared'
import type {
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskStreamPayload,
  OptionalCapabilityProgress,
} from '@spark/protocol'
import { registerAppShutdownCleanup } from '../app-shutdown.js'
import { DEPTH_MODEL_PACKAGE_ID } from '../services/DepthModelIntegrityService.js'
import {
  DepthVideoRunner,
  type DepthVideoProgress,
} from '../services/depth-video/DepthVideoRunner.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { getOptionalCapabilityManager } from './registerOptionalCapabilityIpc.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

const log = createLogger('canvas-depth')
const DEPTH_RUNTIME_ENTRY = join(
  'node_modules',
  '@huggingface',
  'transformers',
  'src',
  'transformers.js',
)

type CapabilityManager = Pick<
  ReturnType<typeof getOptionalCapabilityManager>,
  | 'list'
  | 'install'
  | 'repair'
  | 'getArtifactDirectory'
  | 'subscribeProgress'
  | 'reportRuntimeFailure'
>
type Runner = Pick<DepthVideoRunner, 'run'>
type DepthTaskResponse = CanvasMediaTaskCreateResponse & {
  status: NonNullable<CanvasMediaTaskCreateResponse['status']>
}

export type RegisterCanvasDepthTaskIpcOptions = {
  capabilityManager?: CapabilityManager
  createRunner?: () => Runner
  createRuntimeTaskId?: () => string
  createOutputPath?: (runtimeTaskId: string) => string
}

export function registerCanvasDepthTaskIpc(options: RegisterCanvasDepthTaskIpcOptions = {}): void {
  const capabilityManager = options.capabilityManager ?? getOptionalCapabilityManager()
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
  registerAppShutdownCleanup('canvas depth tasks', () => {
    for (const controller of runningTasks.values()) controller.abort()
    runningTasks.clear()
  })

  typedIpcHandle('canvas:depth-model:status', async () => {
    const snapshot = await capabilityManager.list()
    const depth = snapshot.capabilities.find((item) => item.id === 'local-depth')
    // 主进程内存态是权威来源：渲染进程提交前据此即时提示，避免先建任务节点再失败。
    const runningDepthTaskCount = runningTasks.size
    if (depth?.installedVersion && depth.state !== 'damaged') {
      return { state: 'ready' as const, version: depth.installedVersion, runningDepthTaskCount }
    }
    if (depth?.state === 'error' || depth?.state === 'damaged') {
      return {
        state: 'error' as const,
        error: depth.error ?? '本地深度组件已损坏，请修复',
        runningDepthTaskCount,
      }
    }
    return { state: 'missing' as const, runningDepthTaskCount }
  })

  typedIpcHandle('canvas:depth-model:install', async () => {
    const result = await capabilityManager.install('local-depth')
    if (!result.success) {
      return {
        state: 'error' as const,
        error: result.message,
      }
    }
    const depth = result.snapshot.capabilities.find((item) => item.id === 'local-depth')
    if (!depth?.installedVersion) {
      return {
        state: 'error' as const,
        error: '本地深度组件安装结果缺少已安装版本，请在完整性页修复后重试',
      }
    }
    return { state: 'ready' as const, version: depth.installedVersion }
  })

  typedIpcHandle('canvas:task:create-depth-video', async (request) => {
    assertAllowedInputPath(request.inputPath)
    if (runningTasks.size >= 1) {
      // 必须用 SparkError：普通 Error 会被 typed-ipc 统一掩码成「操作未完成」，
      // 用户将无法得知失败原因是并发限制。
      throw new SparkError(
        'EXECUTION_FAILED',
        '已有深度视频转换任务正在运行，请等待完成或先取消当前任务',
      )
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
        log.info(`event=canvas_depth_task task=${runtimeTaskId} stage=started status=running`)
        const resources = await ensureDepthCapability(
          capabilityManager,
          controller.signal,
          (progress) => {
            if (controller.signal.aborted) return
            pushResponse(
              runningResponse(runtimeTaskId, {
                stage: 'installing_model',
                progress: Math.max(1, Math.round((progress.percent ?? 0) * 0.2)),
                message: '资源下载中：正在安装本地深度 Runtime 与模型',
              }),
            )
          },
        )
        if (controller.signal.aborted) throw new Error('cancelled')
        let lastStage = ''
        let lastProgress = -1
        const result = await createRunner().run({
          inputPath: request.inputPath,
          outputPath,
          modelDir: resources.modelDir,
          runtimeEntryPath: resources.runtimeEntryPath,
          preserveAudio: request.preserveAudio === true,
          ...(request.renderOptions ? { renderOptions: request.renderOptions } : {}),
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
          message: '深度视频转换已生成',
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
        log.info(`event=canvas_depth_task task=${runtimeTaskId} stage=completed status=succeeded`)
      } catch (error) {
        const cancelled =
          controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')
        const diagnostic = safeDepthDiagnostic(error)
        if (!cancelled && isDepthRuntimeLoadFailure(error)) {
          await capabilityManager
            .reportRuntimeFailure('local-depth', error)
            .catch((reportError) => {
              log.warn(
                `event=canvas_depth_task task=${runtimeTaskId} stage=runtime_health status=failed error=${safeDepthDiagnostic(reportError)}`,
              )
            })
        }
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
          message: cancelled ? '深度视频转换任务已取消' : '深度视频转换失败',
          assets: [],
          error: {
            code: cancelled ? 'cancelled' : 'local_depth_failed',
            message: cancelled ? '任务已取消' : diagnostic,
          },
        })
        log.warn(
          `event=canvas_depth_task task=${runtimeTaskId} stage=${
            cancelled ? 'cancelled' : 'failed'
          } status=${cancelled ? 'cancelled' : 'failed'} code=${
            cancelled ? 'cancelled' : 'local_depth_failed'
          } error=${diagnostic}`,
        )
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

async function ensureDepthCapability(
  manager: CapabilityManager,
  signal: AbortSignal,
  onProgress: (progress: OptionalCapabilityProgress) => void,
): Promise<{ modelDir: string; runtimeEntryPath: string }> {
  const unsubscribe = manager.subscribeProgress((progress) => {
    if (progress.capabilityId === 'local-depth') onProgress(progress)
  })
  try {
    throwIfDepthTaskAborted(signal)
    const snapshot = await manager.list()
    throwIfDepthTaskAborted(signal)
    const depth = snapshot.capabilities.find((item) => item.id === 'local-depth')
    const needsInstall =
      !depth?.installedVersion || depth.state === 'damaged' || depth.state === 'error'
    if (needsInstall) {
      const result = await waitForDepthTask(manager.install('local-depth'), signal)
      if (!result.success) throw new Error(result.message)
    }
    throwIfDepthTaskAborted(signal)
    let [runtimeDir, modelDir] = await Promise.all([
      manager.getArtifactDirectory('local-depth', 'runtime.optional-depth-'),
      manager.getArtifactDirectory('local-depth', 'model.depth-anything-v2-small-int8-'),
    ])
    if ((!runtimeDir || !modelDir) && !needsInstall) {
      const repaired = await waitForDepthTask(manager.repair('local-depth'), signal)
      if (!repaired.success) throw new Error(repaired.message)
      ;[runtimeDir, modelDir] = await Promise.all([
        manager.getArtifactDirectory('local-depth', 'runtime.optional-depth-'),
        manager.getArtifactDirectory('local-depth', 'model.depth-anything-v2-small-int8-'),
      ])
    }
    if (!runtimeDir || !modelDir) {
      throw new Error('本地深度组件安装完成但 Runtime 或模型目录缺失，请在完整性页修复')
    }
    return { modelDir, runtimeEntryPath: join(runtimeDir, DEPTH_RUNTIME_ENTRY) }
  } finally {
    unsubscribe()
  }
}

function waitForDepthTask<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('cancelled'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    void operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

function throwIfDepthTaskAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('cancelled')
}

function safeDepthDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown error')
  return raw
    .replace(/https?:\/\/[^\s]+/gi, (value) => {
      try {
        const url = new URL(value)
        url.search = ''
        url.hash = ''
        return url.toString()
      } catch {
        return '[redacted-url]'
      }
    })
    .slice(0, 500)
}

function isDepthRuntimeLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /dlopen|onnxruntime_binding|本地深度 Runtime/i.test(message)
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
  if (stage === 'encoding') return '任务执行中：正在编码深度视频转换结果'
  return '任务执行中：正在逐帧生成深度'
}

function assertAllowedInputPath(inputPath: string): void {
  if (!isSafeFilePathAllowed(inputPath)) {
    throw new Error('深度视频转换输入路径不在允许的画布或工作区目录内')
  }
}
