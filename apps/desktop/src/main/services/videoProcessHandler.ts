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
  trimVideo,
  concatVideos,
  segmentVideo,
  transcodeVideo,
  adjustSpeed,
  reverseVideo,
  cropVideo,
  addWatermark,
  burnSubtitle,
  type FfmpegProgress,
  type KeyframeStrategy,
  type TranscodeOpts,
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

    // ── 剪辑 ─────────────────────────────────────────────────────
    case 'trim': {
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return trimVideo(input, outputPath, {
        startSec: asNumber(params.startSec, 0)!,
        endSec: asNumber(params.endSec, 0)!,
        copy: params.copy !== false,
        onProgress,
      })
    }

    case 'concat': {
      const inputs = [input, ...(params.additionalInputs as string[] ?? [])]
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return concatVideos(inputs, outputPath, { onProgress })
    }

    case 'segment': {
      const segSec = asNumber(params.segmentSec, 10)!
      const pattern = join(getVideoArtifactDir(), `seg_${req.requestId}_%03d.mp4`)
      return segmentVideo(input, pattern, { segmentSec: segSec, onProgress })
    }

    // ── 转码 ─────────────────────────────────────────────────────
    case 'transcode': {
      const format = (params.format as string) ?? 'mp4'
      const outputPath = (params.outputPath as string) ?? makeOutputPath(format)
      const opts: TranscodeOpts = {
        ...(format ? { format: format as TranscodeOpts['format'] } : {}),
        ...(params.videoCodec ? { videoCodec: params.videoCodec as TranscodeOpts['videoCodec'] } : {}),
        ...(params.audioCodec ? { audioCodec: params.audioCodec as TranscodeOpts['audioCodec'] } : {}),
        ...(params.resolution ? { resolution: params.resolution as { w: number; h: number } } : {}),
        ...(params.bitrate ? { bitrate: params.bitrate as string } : {}),
        ...(params.crf != null ? { crf: asNumber(params.crf, 23) } : {}),
        ...(params.fps != null ? { fps: asNumber(params.fps) } : {}),
      }
      return transcodeVideo(input, outputPath, opts, onProgress)
    }

    // ── 画面处理 ─────────────────────────────────────────────────
    case 'adjustSpeed': {
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      const factor = asNumber(params.factor, 1)!
      return adjustSpeed(input, outputPath, factor, onProgress)
    }

    case 'reverse': {
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return reverseVideo(input, outputPath, {
        reverseAudio: params.reverseAudio === true,
        onProgress,
      })
    }

    case 'crop': {
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return cropVideo(input, outputPath, {
        w: asNumber(params.w, 0)!,
        h: asNumber(params.h, 0)!,
        x: asNumber(params.x, 0)!,
        y: asNumber(params.y, 0)!,
        onProgress,
      })
    }

    case 'watermark': {
      const logoPath = params.logoPath as string
      if (!logoPath) throw new Error('水印操作需要 logoPath 参数')
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return addWatermark(input, logoPath, outputPath, {
        position: (params.position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') ?? 'bottom-right',
        scale: asNumber(params.scale, 0.2),
        onProgress,
      })
    }

    case 'burnSubtitle': {
      const srtPath = params.srtPath as string
      if (!srtPath) throw new Error('烧录字幕需要 srtPath 参数')
      const outputPath = (params.outputPath as string) ?? makeOutputPath('mp4')
      return burnSubtitle(input, srtPath, outputPath, onProgress)
    }

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
