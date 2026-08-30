/**
 * videoScaleCompressMath — 「尺寸 / 压缩」百分比计算的纯函数模块
 *
 * 从 videoProcessHandler 的 scaleCompress 分支抽出，便于脱离 Electron 环境单测。
 *
 * 语义约定：
 * - 尺寸百分比 scalePercent（10~200）：按「有效显示宽高」（已换算旋转元数据）等比缩放，
 *   100% 表示不改尺寸；输出宽高取偶数（libx264 + yuv420p 要求），超过 FFmpeg 单边上限时整体回缩。
 * - 压缩百分比 compressPercent（10~90）：目标总体码率 ≈ 原始总码率 × N%
 *   （为音轨预留固定码率后，剩余给视频流；有下限保护防止画质塌陷）。
 *   探测不到原始码率时回退 CRF 质量模式（线性映射，10% 对应最高压缩）。
 */

/** 尺寸缩放允许的百分比范围 */
export const SCALE_MIN_PERCENT = 10
export const SCALE_MAX_PERCENT = 200

/** 压缩允许的百分比范围 */
export const COMPRESS_MIN_PERCENT = 10
export const COMPRESS_MAX_PERCENT = 90

/** FFmpeg/libx264 对 yuv420p 视频要求宽高均为偶数 */
const MIN_EVEN_DIMENSION = 2

/** FFmpeg 单边像素硬上限（AVCodecContext max dimensions） */
export const MAX_FFMPEG_DIMENSION = 16384

/** 音轨预留码率（bps）：aac 128k 足以覆盖常见立体声场景且可预估 */
export const RESERVED_AUDIO_BITRATE_BPS = 128_000

/** 与预留码率对应的 ffmpeg `-b:a` 参数值（保持两处同一来源） */
export const RESERVED_AUDIO_BITRATE_ARG = `${Math.round(RESERVED_AUDIO_BITRATE_BPS / 1000)}k`

/** 视频流码率下限（bps）：低于该值画面块效应不可接受，直接钳制 */
export const MIN_VIDEO_BITRATE_BPS = 100_000

/** CRF 质量回退映射区间：轻微压缩→高画质，极限压缩→低画质 */
export const QUALITY_CRF_MIN = 18
export const QUALITY_CRF_MAX = 34

export interface VideoFrameSize {
  width: number
  height: number
}

/**
 * probe 出的是编码尺寸（旋转元数据写入前）；FFmpeg 解码时会自动转正，
 * 因此缩放前要先按 rotation 换算有效显示宽高（±90/270 时宽高互换）。
 */
export function computeEffectiveDisplaySize(
  width: number,
  height: number,
  rotation?: number | null,
): VideoFrameSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  const normalized = ((Math.round(rotation ?? 0) % 360) + 360) % 360
  const swap = normalized === 90 || normalized === 270
  return swap ? { width: height, height: width } : { width, height }
}

/**
 * 按百分比等比缩放，返回 libx264 可用的偶数宽高。
 *
 * @returns 输入非法或算不出正数尺寸时返回 null；其余情况保证 2 ≤ w,h ≤ MAX_FFMPEG_DIMENSION 且为偶数
 */
export function computeScaledEvenSize(
  displayWidth: number,
  displayHeight: number,
  scalePercent: number,
): VideoFrameSize | null {
  if (!Number.isFinite(scalePercent) || scalePercent <= 0) return null
  if (
    !Number.isFinite(displayWidth) ||
    !Number.isFinite(displayHeight) ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    return null
  }

  let ratio = scalePercent / 100
  // 缩放后超上限 → 整体等比回缩到恰好贴合上限（保留比例感）
  const scaledW = displayWidth * ratio
  const scaledH = displayHeight * ratio
  const longest = Math.max(scaledW, scaledH)
  if (longest > MAX_FFMPEG_DIMENSION) {
    ratio *= MAX_FFMPEG_DIMENSION / longest
  }

  const width = clampToEven(displayWidth * ratio)
  const height = clampToEven(displayHeight * ratio)
  if (width < MIN_EVEN_DIMENSION || height < MIN_EVEN_DIMENSION) return null
  return { width, height }
}

/** 四舍五入到最近的偶数，并钳制在 [MIN_EVEN_DIMENSION, MAX_FFMPEG_DIMENSION] */
function clampToEven(value: number): number {
  const rounded = Math.round(value)
  const even = rounded % 2 === 0 ? rounded : rounded + (rounded > value ? -1 : 1)
  return Math.min(MAX_FFMPEG_DIMENSION, Math.max(MIN_EVEN_DIMENSION, even))
}

/**
 * 压缩规划结果。
 *
 * - mode 'bitrate'：按目标总码率倒推视频流码率（推荐路径）
 * - mode 'quality'：原始码率未知时的 CRF 回退
 */
export type CompressionPlan =
  | { mode: 'bitrate'; videoBitrateBps: number; audioBitrateBps: number }
  | { mode: 'quality'; crf: number }

export interface CompressionPlanInput {
  /** 原始总体码率（bits/s）；未知传 0/null/undefined */
  totalBitrateBps?: number | null
  /** 容器时长（秒）；用于在缺 bit_rate 字段时用 fileSize 反推 */
  durationSec?: number | null
  /** 文件大小（字节）；配合 durationSec 反推码率 */
  fileSizeBytes?: number | null
  /** 是否存在音轨（决定是否为音频预留码率） */
  hasAudio: boolean
  /** 压缩百分比 [COMPRESS_MIN_PERCENT, COMPRESS_MAX_PERCENT] */
  compressPercent: number
}

/**
 * 依据原始码率信息生成压缩计划：
 * 1) totalBitrateBps 有效则直接使用；
 * 2) 否则在 duration 与 fileSize 都有效时按 大小×8/时长 反推；
 * 3) 仍不可得 → CRF 质量回退。
 */
export function planCompression(input: CompressionPlanInput): CompressionPlan {
  const percent = input.compressPercent
  const resolvedBitrate =
    pickPositive(input.totalBitrateBps) ?? deriveBitrateFromFileSize(input.durationSec, input.fileSizeBytes)

  if (resolvedBitrate == null) {
    return { mode: 'quality', crf: compressPercentToCrf(percent) }
  }

  const targetTotalBps = (resolvedBitrate * percent) / 100
  const audioReserve = input.hasAudio ? RESERVED_AUDIO_BITRATE_BPS : 0
  const videoTarget = Math.max(
    MIN_VIDEO_BITRATE_BPS,
    Math.floor(targetTotalBps) - audioReserve,
  )
  return {
    mode: 'bitrate',
    videoBitrateBps: videoTarget,
    audioBitrateBps: audioReserve > 0 ? RESERVED_AUDIO_BITRATE_BPS : 0,
  }
}

/**
 * 压缩百分比 → CRF 的线性回退映射：
 * 90%（几乎不压）→ QUALITY_CRF_MIN；10%（压到最小）→ QUALITY_CRF_MAX。
 */
export function compressPercentToCrf(percent: number): number {
  const spanPercent = COMPRESS_MAX_PERCENT - COMPRESS_MIN_PERCENT
  const spanCrf = QUALITY_CRF_MAX - QUALITY_CRF_MIN
  const ratio = (COMPRESS_MAX_PERCENT - percent) / spanPercent
  const raw = QUALITY_CRF_MIN + ratio * spanCrf
  return Math.min(QUALITY_CRF_MAX, Math.max(QUALITY_CRF_MIN, Math.round(raw)))
}

function pickPositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function deriveBitrateFromFileSize(
  durationSec: number | null | undefined,
  fileSizeBytes: number | null | undefined,
): number | null {
  const duration = pickPositive(durationSec)
  const sizeBytes = pickPositive(fileSizeBytes)
  if (duration == null || sizeBytes == null) return null
  return (sizeBytes * 8) / duration
}
