/**
 * videoProcessHandler — 视频处理操作分派器
 *
 * 把通用的 VideoProcessRequest 按 operation 字段分派到 FfmpegRunner 的具体方法。
 * 从 ipc/index.ts 抽离，避免 IPC 注册文件过长（单文件 ≤3000 行规范）。
 *
 * 安全：所有从渲染进程传入的文件路径（input/outputPath/logoPath/srtPath/additionalInputs）
 * 在 dispatch 入口处经过 assertPathAllowed 白名单校验，防止任意文件读写。
 * 白名单复用 SafeFileProtocol.getSafeFileAllowedRoots()（userData/temp/workspace/canvas）。
 */

import { randomUUID } from 'node:crypto'
import { join, resolve, isAbsolute, sep } from 'node:path'
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
import { getSafeFileAllowedRoots } from './SafeFileProtocol.js'

/** 视频产物落盘根目录：{userData}/.spark-artifacts/media/video-workbench/ */
function getVideoArtifactDir(): string {
  return join(app.getPath('userData'), '.spark-artifacts', 'media', 'video-workbench')
}

/** 缓存白名单根目录（启动后基本不变，避免每次 IPC 都查 DB） */
let cachedAllowedRoots: string[] | null = null
function getAllowedRoots(): string[] {
  if (cachedAllowedRoots == null) {
    cachedAllowedRoots = getSafeFileAllowedRoots()
  }
  return cachedAllowedRoots
}

/**
 * 校验路径在白名单根目录内，防止任意文件读写。
 *
 * @param p 待校验的路径（绝对路径；相对路径拒绝）
 * @param mode 'read' 读路径需在白名单内；'write' 写路径强制限定在视频产物目录内
 * @throws 若路径不在允许范围内
 */
function assertPathAllowed(p: string, mode: 'read' | 'write'): void {
  if (!p || typeof p !== 'string') {
    throw new Error(`Invalid path: ${String(p)}`)
  }
  const abs = resolve(p)
  if (!isAbsolute(abs)) {
    throw new Error(`Path must be absolute: ${p}`)
  }
  // 写路径额外收紧：只允许写视频产物目录（防止覆盖用户文件）
  if (mode === 'write') {
    const artifactDir = resolve(getVideoArtifactDir())
    // outputPath 可能是产物目录里的文件，检查前缀
    const tempDir = resolve(app.getPath('temp'))
    if (!abs.startsWith(artifactDir + sep) && !abs.startsWith(tempDir + sep)) {
      throw new Error(`Write path outside allowed artifact directory: ${abs}`)
    }
    return
  }
  // 读路径：必须在任一白名单根目录下
  const roots = getAllowedRoots()
  const allowed = roots.some((root) => abs.startsWith(resolve(root) + sep) || abs === resolve(root))
  if (!allowed) {
    throw new Error(`Path outside allowed roots: ${abs}`)
  }
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
    console.error('[video-workbench] handleVideoProcess error:', message, err instanceof Error ? err.stack : '')
    return { success: false, error: message }
  }
}

async function dispatch(
  req: VideoProcessRequest,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<unknown> {
  const { operation, input, params } = req
  console.log('[video-workbench] dispatch:', { operation, input: input.slice(0, 100), paramKeys: Object.keys(params) })

  // ── 统一输入校验：路径白名单 + 数值范围 ──────────────────────────
  assertPathAllowed(input, 'read')

  // 校验所有可能的路径参数
  const pathParams = ['outputPath', 'outputDir', 'logoPath', 'srtPath']
  for (const key of pathParams) {
    const v = params[key]
    if (typeof v === 'string' && v.length > 0) {
      assertPathAllowed(v, key === 'outputPath' || key === 'outputDir' ? 'write' : 'read')
    }
  }
  // concat 的 additionalInputs 数组
  if (operation === 'concat') {
    const additional = params.additionalInputs
    if (Array.isArray(additional)) {
      if (additional.length > 50) {
        throw new Error('concat 最多支持 50 个视频')
      }
      for (const f of additional) {
        if (typeof f === 'string') assertPathAllowed(f, 'read')
      }
    }
  }
  // 数值范围校验
  assertNumRange(params.startSec, 0, Number.MAX_SAFE_INTEGER, 'startSec')
  assertNumRange(params.endSec, 0, Number.MAX_SAFE_INTEGER, 'endSec')
  assertNumRange(params.segmentSec, 1, 86400, 'segmentSec')
  assertNumRange(params.factor, 0.0625, 64, 'factor') // 1/16 ~ 64x
  assertNumRange(params.threshold, 0.01, 0.99, 'threshold')
  assertNumRange(params.maxFrames, 1, 200, 'maxFrames')
  assertNumRange(params.intervalSec, 0.1, 3600, 'intervalSec')
  assertNumRange(params.crf, 0, 51, 'crf')
  assertNumRange(params.fps, 1, 120, 'fps')
  assertNumRange(params.w, 1, 16384, 'crop w')
  assertNumRange(params.h, 1, 16384, 'crop h')

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
        startSec: asNumber(params.startSec, 0),
        endSec: asNumber(params.endSec, 0),
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
      const segSec = asNumber(params.segmentSec, 10)
      const pattern = join(getVideoArtifactDir(), `seg_${req.requestId}_%03d.mp4`)
      return segmentVideo(input, pattern, { segmentSec: segSec, onProgress })
    }

    // ── 转码 ─────────────────────────────────────────────────────
    case 'transcode': {
      const format = (params.format as TranscodeOpts['format']) ?? 'mp4'
      const outputPath = (params.outputPath as string) ?? makeOutputPath(format)
      const opts: TranscodeOpts = {
        format,
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
      const factor = asNumber(params.factor, 1)
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
        w: asNumber(params.w, 0),
        h: asNumber(params.h, 0),
        x: asNumber(params.x, 0),
        y: asNumber(params.y, 0),
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
function asNumber(val: unknown, defaultValue: number): number
function asNumber(val: unknown, defaultValue?: undefined): number | undefined
function asNumber(val: unknown, defaultValue?: number): number | undefined {
  if (val == null) return defaultValue
  const n = typeof val === 'string' ? parseFloat(val) : (val as number)
  return Number.isFinite(n) ? n : defaultValue
}

/**
 * 数值范围校验：值存在时必须在 [min, max] 内，否则抛错。
 * undefined / null 跳过（由 asNumber 的 defaultValue 兜底）。
 */
function assertNumRange(val: unknown, min: number, max: number, label: string): void {
  if (val == null) return
  const n = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`参数 ${label} 超出允许范围 [${min}, ${max}]: ${String(val)}`)
  }
}
