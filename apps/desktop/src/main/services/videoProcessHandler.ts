/**
 * videoProcessHandler — 视频处理操作分派器
 *
 * 把通用的 VideoProcessRequest 按 operation 字段分派到 FfmpegRunner 的具体方法。
 * 从 ipc/index.ts 抽离，避免 IPC 注册文件过长（单文件 ≤3000 行规范）。
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { VideoProcessRequest, VideoProcessResponse } from '@spark/protocol'
import {
  probeVideo,
  extractKeyframes,
  extractFramesAtTimes,
  generateThumbnail,
  type FfmpegProgress,
  type KeyframeStrategy,
} from './FfmpegRunner.js'

/** 视频产物落盘根目录：{userData}/.spark-artifacts/media/video-workbench/ */
function getVideoArtifactDir(): string {
  return join(app.getPath('userData'), '.spark-artifacts', 'media', 'video-workbench')
}

/** 生成产物绝对路径（带 uuid + 扩展名） */
function makeOutputPath(ext: string): string {
  return join(getVideoArtifactDir(), `${randomUUID()}.${ext}`)
}

/**
 * 处理一个 VideoProcessRequest。
 *
 * @param req 操作请求
 * @param onProgress 可选进度回调（probe 操作不会触发）
 */
export async function handleVideoProcess(
  req: VideoProcessRequest,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<VideoProcessResponse> {
  try {
    const result = await dispatch(req, onProgress)
    return { success: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

async function dispatch(
  req: VideoProcessRequest,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<unknown> {
  const { operation, input, params } = req

  switch (operation) {
    // ── 探测（无进度）──────────────────────────────────────────────
    case 'probe': {
      return probeVideo(input)
    }

    // ── 关键帧提取 ──────────────────────────────────────────────────
    case 'extractKeyframes': {
      const strategy = (params.strategy as KeyframeStrategy) ?? 'scene'
      const outputDir = (params.outputDir as string) ?? join(getVideoArtifactDir(), `kf_${req.requestId}`)
      return extractKeyframes(input, {
        strategy,
        threshold: asNumber(params.threshold),
        intervalSec: asNumber(params.intervalSec),
        maxFrames: asNumber(params.maxFrames, 20),
        outputDir,
        format: (params.format as 'jpg' | 'png') ?? 'jpg',
        quality: asNumber(params.quality, 2),
        onProgress,
      })
    }

    // ── 指定时间点抽帧（手动标记）──────────────────────────────────
    case 'extractFramesAtTimes': {
      const times = (params.timesSec as number[]) ?? []
      const outputDir = (params.outputDir as string) ?? join(getVideoArtifactDir(), `manual_${req.requestId}`)
      return extractFramesAtTimes(input, times, outputDir, {
        format: (params.format as 'jpg' | 'png') ?? 'jpg',
        quality: asNumber(params.quality, 2),
        onProgress,
      })
    }

    // ── 缩略图生成 ──────────────────────────────────────────────────
    case 'generateThumbnail': {
      const outputPath = (params.outputPath as string) ?? makeOutputPath('jpg')
      return generateThumbnail(input, outputPath, {
        atSec: asNumber(params.atSec, 1),
        width: asNumber(params.width),
      })
    }

    // ── 以下剪辑/转码/画面处理在 P3/P4 实现 ────────────────────────
    case 'trim':
    case 'concat':
    case 'segment':
    case 'transcode':
    case 'adjustSpeed':
    case 'reverse':
    case 'crop':
    case 'watermark':
    case 'burnSubtitle':
      throw new Error(`操作 "${operation}" 尚未实现（计划在 P3/P4 阶段开发）`)

    default:
      throw new Error(`未知的视频处理操作: ${operation}`)
  }
}

/** 安全的数字参数解析：undefined → defaultValue */
function asNumber(val: unknown, defaultValue?: number): number | undefined {
  if (val == null) return defaultValue
  const n = typeof val === 'string' ? parseFloat(val) : (val as number)
  return Number.isFinite(n) ? n : defaultValue
}
