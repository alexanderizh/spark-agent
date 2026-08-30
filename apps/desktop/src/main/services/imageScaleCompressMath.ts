/**
 * imageScaleCompressMath — 图片「尺寸 / 压缩」计算的纯函数模块
 *
 * 从 imageProcessHandler 的 scaleCompress 分支抽出，便于脱离 Electron 环境单测。
 *
 * 语义约定（与视频侧 videoScaleCompressMath 保持一致的比例范围）：
 * - 尺寸百分比 scalePercent（10~200）：等比缩放，100% 表示不改尺寸；宽高四舍五入取整，
 *   单边超上限时整体等比回缩（保护内存）。
 * - 压缩百分比 compressPercent（10~90）：目标体积 ≈ 原始字节数 × N%。
 *   图片无码率概念，通过 sharp 的 quality 参数二分迭代逼近目标体积：
 *   quality 越低文件越小（jpeg/webp 直接映射；png 配合 palette 量化生效）。
 */

/** 尺寸缩放允许的百分比范围 */
export const SCALE_MIN_PERCENT = 10
export const SCALE_MAX_PERCENT = 200

/** 压缩允许的百分比范围 */
export const COMPRESS_MIN_PERCENT = 10
export const COMPRESS_MAX_PERCENT = 90

/** 单边像素上限（超过时整体等比回缩，与视频侧上限一致） */
export const MAX_IMAGE_DIMENSION = 16384

/** 输入/输出总像素上限（与 SessionImageOptimizer 一致，避免超大图造成内存峰值） */
export const MAX_IMAGE_PIXELS = 100_000_000

/** quality 二分搜索边界：低于 10 画质塌陷，高于 95 压缩空间不足 */
export const QUALITY_SEARCH_MIN = 10
export const QUALITY_SEARCH_MAX = 95

/** quality 二分最大轮次：范围约 86 档，log2(86)≈7 轮收敛，留 1 轮余量 */
export const MAX_QUALITY_SEARCH_ROUNDS = 8

/** sharp 可直接按 quality 迭代的输出格式；png 无损、靠 palette 量化压缩 */
export type ImageScaleCompressOutputFormat = 'jpeg' | 'png' | 'webp'

export interface ImageScaledSize {
  width: number
  height: number
}

/**
 * 按百分比等比缩放，宽高四舍五入取整。
 *
 * @returns 输入非法或算不出 ≥1px 尺寸时返回 null；其余保证 1 ≤ w,h ≤ MAX_IMAGE_DIMENSION
 */
export function computeScaledImageSize(
  sourceWidth: number,
  sourceHeight: number,
  scalePercent: number,
): ImageScaledSize | null {
  if (!Number.isFinite(scalePercent) || scalePercent <= 0) return null
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null
  }

  let ratio = scalePercent / 100
  // 缩放后超上限 → 整体等比回缩到恰好贴合上限（保留比例感）
  const longest = Math.max(sourceWidth, sourceHeight) * ratio
  if (longest > MAX_IMAGE_DIMENSION) {
    ratio *= MAX_IMAGE_DIMENSION / longest
  }

  const scaledPixels = sourceWidth * sourceHeight * ratio * ratio
  if (scaledPixels > MAX_IMAGE_PIXELS) {
    ratio *= Math.sqrt(MAX_IMAGE_PIXELS / scaledPixels)
  }

  let width = Math.max(1, Math.round(sourceWidth * ratio))
  let height = Math.max(1, Math.round(sourceHeight * ratio))
  // 四舍五入可能让最终乘积略超上限；再用一次向下取整收紧。
  if (width * height > MAX_IMAGE_PIXELS) {
    const correction = Math.sqrt(MAX_IMAGE_PIXELS / (width * height))
    width = Math.max(1, Math.floor(width * correction))
    height = Math.max(1, Math.floor(height * correction))
  }
  return { width, height }
}

/**
 * 源格式 → 输出格式映射。
 *
 * jpeg/webp/png 三大主流格式保持原样（用户对产物的格式预期不变）；
 * 其余格式（gif/bmp/tiff/avif/heic…）sharp 可解码但按 quality 迭代压缩不可控，
 * 统一输出 png（无损 + palette 量化兜底）。
 */
export function resolveOutputFormat(sourceFormat: string): ImageScaleCompressOutputFormat {
  switch (sourceFormat.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg'
    case 'webp':
      return 'webp'
    case 'png':
      return 'png'
    default:
      return 'png'
  }
}

/** 输出格式的文件扩展名（产物落盘与画布节点展示用） */
export function outputExtensionFor(format: ImageScaleCompressOutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** quality 二分搜索的当前区间（闭区间，两端均可取） */
export interface QualitySearchBounds {
  low: number
  high: number
}

/** 二分初始区间 */
export function initialQualityBounds(): QualitySearchBounds {
  return { low: QUALITY_SEARCH_MIN, high: QUALITY_SEARCH_MAX }
}

/** 当前区间内的下一个探测点（区间中点） */
export function nextQualityToProbe(bounds: QualitySearchBounds): number {
  return Math.round((bounds.low + bounds.high) / 2)
}

/** 区间是否已收敛（无新探测点） */
export function qualityBoundsExhausted(bounds: QualitySearchBounds): boolean {
  return bounds.low > bounds.high
}

/**
 * 依据一次探测结果收缩二分区间。
 *
 * 编码字节数随 quality 单调不减：偏大 → 上界左移（压更低质量）；
 * 偏小 → 下界右移（还有提高质量的空间）。
 */
export function refineQualityBounds(
  bounds: QualitySearchBounds,
  probedQuality: number,
  encodedBytes: number,
  targetBytes: number,
): QualitySearchBounds {
  if (encodedBytes > targetBytes) {
    return { low: bounds.low, high: probedQuality - 1 }
  }
  return { low: probedQuality + 1, high: bounds.high }
}

/** 已完成的编码候选：quality 与实际字节数 */
export interface EncodedCandidate {
  quality: number
  bytes: number
}

/**
 * 两个候选中保留更接近目标体积的一个（按相对误差比较）；
 * 误差相同时偏向更高质量（画质优先）。
 */
export function pickBetterCandidate(
  current: EncodedCandidate | null,
  next: EncodedCandidate,
  targetBytes: number,
): EncodedCandidate {
  if (current == null) return next
  const currentError = Math.abs(current.bytes - targetBytes)
  const nextError = Math.abs(next.bytes - targetBytes)
  if (nextError < currentError) return next
  if (nextError === currentError && next.quality > current.quality) return next
  return current
}

/** 压缩目标体积（字节） */
export function computeTargetBytes(fileSizeBytes: number, compressPercent: number): number {
  return Math.max(1, Math.round((fileSizeBytes * compressPercent) / 100))
}
