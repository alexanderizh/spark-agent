/**
 * registerCanvasAudioExtractIpc — 画布「分离音频」任务 IPC 注册
 *
 * 仿 registerCanvasDepthTaskIpc.ts 的流式任务模式，但无 capability manager / 模型下载
 * （ffmpeg 已是基础能力，无需额外安装）：
 *   - `canvas:task:extract-audio`        创建分离音频任务（单并发）
 *   - `canvas:task:cancel-extract-audio` 取消运行中的任务
 *
 * 产物落到 `{userData}/.spark-artifacts/media/canvas-audio/{runtimeTaskId}/{源名}_audio.{ext}`
 * （runtimeTaskId 子目录保证并发/重复任务互不覆盖；文件名语义化，不再是 uuid 乱码），
 * 成功后通过 `stream:canvas:media-task` 推送 `assets:[{type:'audio', filePath, mimeType, durationMs}]`，
 * 前端 applyMediaTaskResult 会自动物化为 audio 节点 + generated 连线。
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type {
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskStreamPayload,
} from '@spark/protocol'
import {
  extractAudio,
  probeVideo,
  audioExtForCodec,
  type AudioExtractFormat,
} from '../services/FfmpegRunner.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

const log = createLogger('canvas-audio-extract')

type AudioExtractTaskResponse = CanvasMediaTaskCreateResponse & {
  status: NonNullable<CanvasMediaTaskCreateResponse['status']>
}

export type RegisterCanvasAudioExtractIpcOptions = {
  createRuntimeTaskId?: () => string
  createOutputPath?: (runtimeTaskId: string, ext: string, sourceBaseName?: string) => string
}

export function registerCanvasAudioExtractIpc(
  options: RegisterCanvasAudioExtractIpcOptions = {},
): void {
  const createRuntimeTaskId = options.createRuntimeTaskId ?? (() => `audio-${randomUUID()}`)
  const createOutputPath =
    options.createOutputPath ??
    ((runtimeTaskId: string, ext: string, sourceBaseName?: string) => {
      const base = sanitizeAudioBaseName(sourceBaseName)
      const fileName = base === 'audio' ? `audio.${ext}` : `${base}_audio.${ext}`
      return join(
        app.getPath('userData'),
        '.spark-artifacts',
        'media',
        'canvas-audio',
        runtimeTaskId,
        fileName,
      )
    })
  const runningTasks = new Map<string, AbortController>()
  app.once('before-quit', () => {
    for (const controller of runningTasks.values()) controller.abort()
    runningTasks.clear()
  })

  typedIpcHandle('canvas:task:extract-audio', async (request) => {
    assertAllowedInputPath(request.inputPath)
    if (runningTasks.size >= 1) {
      throw new Error('已有音频分离任务正在运行，请等待完成或先取消当前任务')
    }
    const runtimeTaskId = createRuntimeTaskId()
    const controller = new AbortController()
    runningTasks.set(runtimeTaskId, controller)

    const pushResponse = (response: AudioExtractTaskResponse) => {
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
        log.info(`event=canvas_audio_extract task=${runtimeTaskId} stage=started status=running`)
        const format: AudioExtractFormat = request.audioFormat ?? 'mp3'
        const sourceBaseName = request.sourceFileName?.trim() || undefined
        // copy 模式扩展名取决于源音轨编码，先 probe 确认有音轨并定扩展名
        let outputPath: string
        if (format === 'copy') {
          const probe = await probeVideo(request.inputPath)
          if (controller.signal.aborted) throw new Error('cancelled')
          if (!probe.hasAudio) throw new Error('该视频没有音轨，无法分离音频')
          outputPath = createOutputPath(runtimeTaskId, audioExtForCodec(probe.audioCodec), sourceBaseName)
        } else {
          const ext = format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'm4a'
          outputPath = createOutputPath(runtimeTaskId, ext, sourceBaseName)
        }
        const result = await extractAudio(request.inputPath, outputPath, {
          format,
          signal: controller.signal,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            pushResponse(
              runningResponse(runtimeTaskId, {
                stage: 'extracting',
                progress: Math.max(1, Math.min(99, Math.round(progress.percent))),
                message: '任务执行中：正在分离音频',
              }),
            )
          },
        })
        pushResponse({
          runtimeTaskId,
          requestId: runtimeTaskId,
          status: 'succeeded',
          providerProfileId: '',
          provider: 'local_ffmpeg',
          model: 'ffmpeg-extract-audio',
          mode: 'async',
          progress: 100,
          stage: 'completed',
          message: '音频分离完成',
          assets: [
            {
              type: 'audio',
              filePath: result.path,
              mimeType: result.mimeType,
              durationMs: result.durationMs,
            },
          ],
        })
        log.info(`event=canvas_audio_extract task=${runtimeTaskId} stage=completed status=succeeded`)
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
          model: 'ffmpeg-extract-audio',
          mode: 'async',
          progress: 100,
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? '音频分离任务已取消' : '音频分离失败',
          assets: [],
          error: {
            code: cancelled ? 'cancelled' : 'audio_extract_failed',
            message: cancelled ? '任务已取消' : diagnostic,
          },
        })
        log.warn(
          `event=canvas_audio_extract task=${runtimeTaskId} stage=${
            cancelled ? 'cancelled' : 'failed'
          } status=${cancelled ? 'cancelled' : 'failed'} code=${
            cancelled ? 'cancelled' : 'audio_extract_failed'
          } error=${diagnostic}`,
        )
      } finally {
        runningTasks.delete(runtimeTaskId)
      }
    })()

    return runningResponse(runtimeTaskId, {
      stage: 'queued',
      progress: 0,
      message: '本地音频分离任务已创建',
    })
  })

  typedIpcHandle('canvas:task:cancel-extract-audio', async (request) => {
    const controller = runningTasks.get(request.runtimeTaskId)
    controller?.abort()
    return { cancelled: controller != null }
  })
}

function runningResponse(
  runtimeTaskId: string,
  progress: { stage: string; progress: number; message: string },
): AudioExtractTaskResponse {
  return {
    runtimeTaskId,
    requestId: runtimeTaskId,
    status: 'running',
    providerProfileId: '',
    provider: 'local_ffmpeg',
    model: 'ffmpeg-extract-audio',
    mode: 'async',
    assets: [],
    ...progress,
  }
}

function assertAllowedInputPath(inputPath: string): void {
  // 云产物/云端素材的 https:// URL：ffmpeg 直接拉流处理，不做本地目录限制
  if (/^https?:\/\//i.test(inputPath)) return
  if (!isSafeFilePathAllowed(inputPath)) {
    throw new Error('音频分离输入路径不在允许的画布或工作区目录内')
  }
}

/**
 * 产物文件名的源名净化：只去掉文件系统非法字符（含中文在内的正常字符全部保留），
 * 空值回退 'audio'。与 ipc/index.ts 的 sanitizeCanvasPathSegment 同规则，但不做 80 字符截断。
 */
function sanitizeAudioBaseName(value: string | undefined): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'audio'
}
