/**
 * registerCanvasFrameExtractIpc — 画布「提取首尾帧」任务 IPC 注册
 *
 * 仿 registerCanvasAudioExtractIpc.ts 的流式任务模式（ffmpeg 已是基础能力，无模型下载）：
 *   - `canvas:task:extract-first-last-frames`        创建提取首尾帧任务（单并发）
 *   - `canvas:task:cancel-extract-first-last-frames` 取消运行中的任务
 *
 * 流程：probeVideo 取时长 → extractFramesAtTimes 抽 [0s, duration-0.1s] 两帧 →
 * rename 为语义化文件名（`{源名}_首帧.jpg` / `{源名}_尾帧.jpg`）→
 * 通过 `stream:canvas:media-task` 推送 `assets:[{type:'image', filePath, title}]`，
 * 前端 applyMediaTaskResult 会自动物化为两个图片节点 + generated 连线。
 *
 * 尾帧取 duration-0.1s 而非 duration：ffmpeg -ss 在 -i 前的 seek 模式下，
 * 越界时间点会 exit 0 但不产出文件（extractFramesAtTimes 内部以 existsSync 过滤），
 * 预留 0.1s 余量保证最后一帧可解码。
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { renameSync } from 'node:fs'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type {
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskStreamPayload,
} from '@spark/protocol'
import { probeVideo, extractFramesAtTimes } from '../services/FfmpegRunner.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

const log = createLogger('canvas-frame-extract')

type FrameExtractTaskResponse = CanvasMediaTaskCreateResponse & {
  status: NonNullable<CanvasMediaTaskCreateResponse['status']>
}

/** 尾帧距片尾的安全余量（秒），避免 seek 越界导致空产物 */
const TAIL_FRAME_EPSILON_SEC = 0.1

export type RegisterCanvasFrameExtractIpcOptions = {
  createRuntimeTaskId?: () => string
  createOutputDir?: (runtimeTaskId: string) => string
}

export function registerCanvasFrameExtractIpc(
  options: RegisterCanvasFrameExtractIpcOptions = {},
): void {
  const createRuntimeTaskId = options.createRuntimeTaskId ?? (() => `frames-${randomUUID()}`)
  const createOutputDir =
    options.createOutputDir ??
    ((runtimeTaskId: string) =>
      join(app.getPath('userData'), '.spark-artifacts', 'media', 'canvas-frames', runtimeTaskId))
  const runningTasks = new Map<string, AbortController>()
  app.once('before-quit', () => {
    for (const controller of runningTasks.values()) controller.abort()
    runningTasks.clear()
  })

  typedIpcHandle('canvas:task:extract-first-last-frames', async (request) => {
    assertAllowedInputPath(request.inputPath)
    if (runningTasks.size >= 1) {
      throw new Error('已有提取首尾帧任务正在运行，请等待完成或先取消当前任务')
    }
    const runtimeTaskId = createRuntimeTaskId()
    const controller = new AbortController()
    runningTasks.set(runtimeTaskId, controller)

    const pushResponse = (response: FrameExtractTaskResponse) => {
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
        log.info(`event=canvas_frame_extract task=${runtimeTaskId} stage=started status=running`)
        const sourceBaseName = request.sourceFileName?.trim() || undefined
        const outputDir = createOutputDir(runtimeTaskId)
        const probe = await probeVideo(request.inputPath)
        if (controller.signal.aborted) throw new Error('cancelled')
        if (probe.durationSec == null || probe.durationSec <= 0) {
          throw new Error('无法读取视频时长，可能不是有效视频文件')
        }
        pushResponse(
          runningResponse(runtimeTaskId, {
            stage: 'probing',
            progress: 20,
            message: `任务执行中：已读取视频时长 ${probe.durationSec.toFixed(2)}s`,
          }),
        )
        const firstSec = 0
        const lastSec = Math.max(0, probe.durationSec - TAIL_FRAME_EPSILON_SEC)
        const frames = await extractFramesAtTimes(request.inputPath, [firstSec, lastSec], outputDir, {
          format: 'jpg',
          quality: 2,
        })
        if (controller.signal.aborted) throw new Error('cancelled')
        if (frames.length === 0) throw new Error('未能从视频中提取出任何帧')

        const assets: Array<{
          type: 'image'
          filePath: string
          mimeType: string
          title: string
        }> = []
        const base = sanitizeFrameBaseName(sourceBaseName)
        // frames 顺序与传入时间点一致：[0] = 首帧，[1] = 尾帧；尾帧提取失败时只有 1 项
        const namedFrames: Array<{
          frame: (typeof frames)[number] | undefined
          suffix: string
          title: string
        }> = [
          { frame: frames[0], suffix: '首帧', title: '首帧' },
          ...(frames.length > 1 ? [{ frame: frames[1], suffix: '尾帧', title: '尾帧' }] : []),
        ]
        for (const item of namedFrames) {
          if (!item.frame) continue
          const semanticPath = join(outputDir, `${base}_${item.suffix}.jpg`)
          renameSync(item.frame.path, semanticPath)
          assets.push({
            type: 'image',
            filePath: semanticPath,
            mimeType: 'image/jpeg',
            title: item.title,
          })
        }
        if (assets.length === 0) throw new Error('提取的帧产物文件缺失')
        pushResponse({
          runtimeTaskId,
          requestId: runtimeTaskId,
          status: 'succeeded',
          providerProfileId: '',
          provider: 'local_ffmpeg',
          model: 'ffmpeg-extract-frames',
          mode: 'async',
          progress: 100,
          stage: 'completed',
          message: `提取首尾帧完成（${assets.length} 张）`,
          assets,
        })
        log.info(
          `event=canvas_frame_extract task=${runtimeTaskId} stage=completed status=succeeded assets=${assets.length}`,
        )
      } catch (error) {
        const cancelled =
          controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')
        const diagnostic = error instanceof Error ? error.message : String(error ?? 'unknown error')
        pushResponse({
          runtimeTaskId,
          requestId: runtimeTaskId,
          status: cancelled ? 'cancelled' : 'failed',
          providerProfileId: '',
          provider: 'local_ffmpeg',
          model: 'ffmpeg-extract-frames',
          mode: 'async',
          progress: 100,
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? '提取首尾帧任务已取消' : '提取首尾帧失败',
          assets: [],
          error: {
            code: cancelled ? 'cancelled' : 'frame_extract_failed',
            message: cancelled ? '任务已取消' : diagnostic,
          },
        })
        log.warn(
          `event=canvas_frame_extract task=${runtimeTaskId} stage=${
            cancelled ? 'cancelled' : 'failed'
          } status=${cancelled ? 'cancelled' : 'failed'} code=${
            cancelled ? 'cancelled' : 'frame_extract_failed'
          } error=${diagnostic}`,
        )
      } finally {
        runningTasks.delete(runtimeTaskId)
      }
    })()

    return runningResponse(runtimeTaskId, {
      stage: 'queued',
      progress: 0,
      message: '本地提取首尾帧任务已创建',
    })
  })

  typedIpcHandle('canvas:task:cancel-extract-first-last-frames', async (request) => {
    const controller = runningTasks.get(request.runtimeTaskId)
    controller?.abort()
    return { cancelled: controller != null }
  })
}

function runningResponse(
  runtimeTaskId: string,
  progress: { stage: string; progress: number; message: string },
): FrameExtractTaskResponse {
  return {
    runtimeTaskId,
    requestId: runtimeTaskId,
    status: 'running',
    providerProfileId: '',
    provider: 'local_ffmpeg',
    model: 'ffmpeg-extract-frames',
    mode: 'async',
    assets: [],
    ...progress,
  }
}

function assertAllowedInputPath(inputPath: string): void {
  // 云产物/云端素材的 https:// URL：ffmpeg 直接拉流处理，不做本地目录限制
  if (/^https?:\/\//i.test(inputPath)) return
  if (!isSafeFilePathAllowed(inputPath)) {
    throw new Error('提取首尾帧输入路径不在允许的画布或工作区目录内')
  }
}

/**
 * 产物文件名的源名净化：只去掉文件系统非法字符（含中文在内的正常字符全部保留），
 * 空值回退 'frames'。与 registerCanvasAudioExtractIpc 的 sanitizeAudioBaseName 同规则。
 */
function sanitizeFrameBaseName(value: string | undefined): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'frames'
}
